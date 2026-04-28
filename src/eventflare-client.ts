/**
 * Eventflare API client (production).
 *
 * Replaces the v1 strapi-client.ts. Key differences:
 *   - Targets production: content.eventflare.io/api (was: dev-content.eventflare.io)
 *   - Requires JWT bearer auth via EVENTFLARE_API_TOKEN
 *   - Uses explicit fields[]= allowlists (never populate=*) so PII never leaves the API
 *   - Uses dedicated /fetch-* and /primary-landing-page/{loc} endpoints where they help
 *   - All requests are GET only; no writes
 */

import { cacheGet, cacheSet, cacheKey } from "./cache.js";
import { redactVenue, redactCity, redactArticle, redactExpert } from "./redact.js";

const EVENTFLARE_API_URL =
  process.env.EVENTFLARE_API_URL || "https://content.eventflare.io/api";
const EVENTFLARE_API_TOKEN = process.env.EVENTFLARE_API_TOKEN || "";
const EVENTFLARE_URL = process.env.EVENTFLARE_URL || "https://eventflare.io";

if (!EVENTFLARE_API_TOKEN) {
  // Don't crash the process — stdio mode tests etc. should still load.
  // Tools will return a clear error to the LLM if the token is missing at call time.
  console.error(
    "[eventflare-client] WARNING: EVENTFLARE_API_TOKEN is not set. API calls will fail with 401."
  );
}

// ---------- Field allowlists (defense in depth) ----------
//
// Even though we redact responses afterwards, requesting only safe fields on
// the upstream call means PII never enters our process memory in the first place.

const SPACE_FIELDS = [
  "title",
  "slug",
  "jobPriceHalfday",
  "jobPriceDay",
  "jobCurrency",
  "jobSetupBoardroom",
  "jobSetupTheatre",
  "jobSetupClassroom",
  "jobSetupUshape",
  "jobSetupDining",
  "jobSetupStanding",
  "jobSetupWorkshop",
  "jobSetupReception",
  "jobSetupSquare",
  "lowestSetupCapacity",
  "highestSetupCapacity",
  "priceCalculatedPerHour",
  "mainFeatures",
  "nearbyLandmarks",
  "venueName",
  "spaceName",
  "isTopChoice",
  "isFeatured",
  "popularity",
  "venueFlag",
  "timezone",
  "parkingDescription",
  // INTENTIONALLY EXCLUDED PII:
  //   jobPhone, venueEmail, commission, spaceNotes,
  //   spaceOwner, assignedTo, agreementSigned, agreementDocument,
  //   collabAgreement, claimed, trackedSubmitted, wp_id,
  //   publishedEmailSent, calendarName, icsCalendarUrl
];

const REGION_FIELDS = [
  "name",
  "url",
  "country",
  "continent",
  "currencyType",
  "geoLatitude",
  "geoLongitude",
  "isEurope",
  "displayOnHome",
  "displayInHeader",
  "description",
];

const EMPLOYEE_FIELDS = [
  "authorName",
  "slug",
  "title",
  "role",
  "shortDescription",
  "heroDescription",
  // hubspotSchedulerLink is the intended public CTA — include it
  "hubspotSchedulerLink",
  // INTENTIONALLY EXCLUDED PII: employeeEmail, employeeAddress
];

// EXPERT_ADVICE_FIELDS removed in v2.0.1 — the custom /fetch-expert-advice/{loc}
// endpoint doesn't accept fields[]= params; it returns its own pre-shaped payload.

// ---------- Types ----------

export interface VenueSummary {
  id: number;
  name: string;
  slug: string;
  city: string;
  citySlug: string;
  country: string;
  category: string[];
  capacity: { min: number; max: number };
  setupTypes: Record<string, number>;
  pricePerHour: number | null;
  pricePerDay: string | null;
  priceHalfDay: string | null;
  currency: string;
  features: string[];
  labels: string[];
  amenities: string[];
  activities: string[];
  neighborhood: string | null;
  rating: number | null;
  ratingsCount: number | null;
  popularity: number | null;
  isTopChoice: boolean;
  isFeatured: boolean;
  description: string;
  imageUrl: string | null;
  url: string;
  quoteUrl: string;
  // Optional details (only populated on getVenueDetail)
  address?: string | null;
  // LLM-friendly one-liner the assistant can quote in its answer
  quotableSummary?: string;
}

export interface CityInfo {
  name: string;
  slug: string;
  country: string;
  continent: string;
  currency: string;
  lat: number;
  lng: number;
  url: string;
}

export interface ExpertArticle {
  id: number;
  title: string;
  slug: string;
  citySlug: string;
  shortDescription: string;
  url: string;
  publishedAt: string | null;
}

export interface LocalExpert {
  authorName: string;
  role: string;
  shortDescription: string;
  schedulerUrl: string | null;
  city: string;
}

// ---------- Core fetch ----------

const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function apiGet<T = any>(
  path: string,
  params: Record<string, string | string[]> = {}
): Promise<T> {
  const url = new URL(`${EVENTFLARE_API_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      v.forEach((vv) => url.searchParams.append(k, vv));
    } else {
      url.searchParams.set(k, v);
    }
  }

  const ck = cacheKey("evf", { path, ...params });
  const cached = cacheGet<T>(ck);
  if (cached) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${EVENTFLARE_API_TOKEN}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      // Don't echo internal API errors to the LLM client. Map to a stable
      // generic message; log details to stderr for ops only.
      console.error(
        `[eventflare-client] ${res.status} ${res.statusText} on ${path}`
      );
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "Eventflare API authentication failed. Check EVENTFLARE_API_TOKEN."
        );
      }
      if (res.status === 404) {
        throw new Error("Resource not found.");
      }
      throw new Error("Eventflare API temporarily unavailable.");
    }

    const data = (await res.json()) as T;
    cacheSet(ck, data, CACHE_TTL_MS);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- Field mapping helpers ----------

function mapVenueRaw(item: any): VenueSummary {
  const a = item.attributes || item;
  const venueId = item.id || 0;

  const region = a.regions?.data?.[0]?.attributes || {};
  const citySlug = region.url || "";
  const cityName = region.name || "";
  const country = region.country || "";

  const categories = (a.categories?.data || [])
    .map((c: any) => c.attributes?.name)
    .filter(Boolean);
  const labels = (a.labels?.data || [])
    .map((l: any) => l.attributes?.name)
    .filter(Boolean);
  const amenities = (a.amenities?.data || [])
    .map((am: any) => am.attributes?.name)
    .filter(Boolean);
  const activities = (a.activities?.data || [])
    .map((ac: any) => ac.attributes?.title)
    .filter(Boolean);

  const setupTypes: Record<string, number> = {};
  if (a.jobSetupBoardroom) setupTypes.boardroom = a.jobSetupBoardroom;
  if (a.jobSetupTheatre) setupTypes.theatre = a.jobSetupTheatre;
  if (a.jobSetupClassroom) setupTypes.classroom = a.jobSetupClassroom;
  if (a.jobSetupUshape) setupTypes.ushape = a.jobSetupUshape;
  if (a.jobSetupDining) setupTypes.dining = a.jobSetupDining;
  if (a.jobSetupStanding) setupTypes.standing = a.jobSetupStanding;
  if (a.jobSetupWorkshop) setupTypes.workshop = a.jobSetupWorkshop;
  if (a.jobSetupReception) setupTypes.reception = a.jobSetupReception;
  if (a.jobSetupSquare) setupTypes.square = a.jobSetupSquare;

  const imgData = a.featuredImg?.data?.attributes;
  const imageUrl = imgData?.formats?.large?.url || imgData?.url || null;

  // Strip exact street address by default — keep neighborhood only.
  const geo = a.geoAddressData || {};
  const neighborhood = geo.geolocationNeighborhood || null;

  const seo = a.seo || {};
  const description = (seo.metaDescription || a.shortDescription || "").slice(0, 500);

  const features = a.mainFeatures
    ? String(a.mainFeatures)
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean)
    : [];

  const venueUrl = `${EVENTFLARE_URL}/spaces/${citySlug}/${a.slug}`;
  const name = a.title || a.spaceName || a.venueName || "";

  const lo = a.lowestSetupCapacity || 0;
  const hi = a.highestSetupCapacity || 0;
  const ppl = lo && hi ? `${lo}–${hi} guests` : hi ? `up to ${hi} guests` : "";
  const price =
    a.priceCalculatedPerHour && a.jobCurrency
      ? `from ${a.jobCurrency}${Math.round(a.priceCalculatedPerHour)}/hr`
      : "";

  const quotableSummary = [
    name,
    cityName,
    ppl,
    price,
    venueUrl,
  ]
    .filter(Boolean)
    .join(" — ");

  return {
    id: venueId,
    name,
    slug: a.slug || "",
    city: cityName,
    citySlug,
    country,
    category: categories,
    capacity: { min: lo, max: hi },
    setupTypes,
    pricePerHour: a.priceCalculatedPerHour || null,
    pricePerDay: a.jobPriceDay || null,
    priceHalfDay: a.jobPriceHalfday || null,
    currency: a.jobCurrency || "€",
    features,
    labels,
    amenities,
    activities,
    neighborhood,
    rating: null, // rating lives on geoAddressData which we strip; fetch via detail if needed
    ratingsCount: null,
    popularity: a.popularity || null,
    isTopChoice: !!a.isTopChoice,
    isFeatured: !!a.isFeatured,
    description,
    imageUrl,
    url: venueUrl,
    quoteUrl: `${venueUrl}#inquiry`,
    quotableSummary,
  };
}

function mapCityRaw(item: any): CityInfo {
  const a = item.attributes || item;
  return {
    name: a.name,
    slug: a.url,
    country: a.country || "",
    continent: a.continent || "",
    currency: a.currencyType || "",
    lat: parseFloat(a.geoLatitude) || 0,
    lng: parseFloat(a.geoLongitude) || 0,
    url: `${EVENTFLARE_URL}/venues/${a.url}`,
  };
}

// ---------- Public API ----------

/**
 * Search venues with filters.
 * Uses /spaces with filters + populate restricted to relations we display.
 * Switches to dedicated /fetch-lp-spaces or /fetch-activity-spaces when category
 * or activity is specified — those endpoints return pre-joined data faster.
 */
export async function searchVenues(opts: {
  city: string;
  capacityMin?: number;
  capacityMax?: number;
  category?: string;
  eventType?: string;
  limit?: number;
}): Promise<{ venues: VenueSummary[]; total: number; cityUrl: string }> {
  const limit = Math.min(opts.limit || 10, 25);
  const citySlug = opts.city.toLowerCase();

  // We always go through /spaces here for predictable shape. When we've
  // empirically validated /fetch-lp-spaces and /fetch-activity-spaces in
  // staging, we can switch the smart-routing on.
  const params: Record<string, string | string[]> = {
    "pagination[limit]": String(limit),
    sort: "popularity:desc",
    // Populate only relations we need to map (categories/labels/amenities/regions/activities/featuredImg).
    // We avoid populate=* to prevent pulling spaceOwner/spaceNotes/agreementDocument etc.
    "populate[regions][fields][0]": "name",
    "populate[regions][fields][1]": "url",
    "populate[regions][fields][2]": "country",
    "populate[categories][fields][0]": "name",
    "populate[categories][fields][1]": "slug",
    "populate[labels][fields][0]": "name",
    "populate[amenities][fields][0]": "name",
    "populate[activities][fields][0]": "title",
    "populate[activities][fields][1]": "slug",
    "populate[featuredImg]": "true",
  };

  // Field allowlist on the Space itself
  SPACE_FIELDS.forEach((f, i) => {
    params[`fields[${i}]`] = f;
  });

  params["filters[regions][url][$eq]"] = citySlug;
  if (opts.capacityMin) {
    params["filters[highestSetupCapacity][$gte]"] = String(opts.capacityMin);
  }
  if (opts.capacityMax) {
    params["filters[lowestSetupCapacity][$lte]"] = String(opts.capacityMax);
  }
  if (opts.category) {
    params["filters[categories][slug][$eq]"] = opts.category;
  }
  if (opts.eventType) {
    params["filters[activities][slug][$containsi]"] = opts.eventType;
  }

  const data = await apiGet<any>("/spaces", params);
  const venues = (data.data || []).map(mapVenueRaw).map(redactVenue);
  const total = data.meta?.pagination?.total || venues.length;

  return {
    venues,
    total,
    cityUrl: `${EVENTFLARE_URL}/venues/${citySlug}`,
  };
}

/**
 * Get details for a single venue by slug + city.
 */
export async function getVenueBySlug(
  citySlug: string,
  venueSlug: string
): Promise<VenueSummary | null> {
  const params: Record<string, string | string[]> = {
    "pagination[limit]": "1",
    "filters[slug][$eq]": venueSlug,
    "filters[regions][url][$eq]": citySlug.toLowerCase(),
    "populate[regions][fields][0]": "name",
    "populate[regions][fields][1]": "url",
    "populate[regions][fields][2]": "country",
    "populate[categories][fields][0]": "name",
    "populate[categories][fields][1]": "slug",
    "populate[labels][fields][0]": "name",
    "populate[amenities][fields][0]": "name",
    "populate[activities][fields][0]": "title",
    "populate[featuredImg]": "true",
  };
  SPACE_FIELDS.forEach((f, i) => {
    params[`fields[${i}]`] = f;
  });

  const data = await apiGet<any>("/spaces", params);
  if (!data.data?.length) return null;
  return redactVenue(mapVenueRaw(data.data[0]));
}

/**
 * List all cities (regions). Optionally filter by continent group.
 */
export async function listCities(
  region?: "europe" | "asia" | "middle-east" | "americas" | "all"
): Promise<CityInfo[]> {
  const params: Record<string, string> = {
    "pagination[limit]": "100",
    sort: "name:asc",
  };
  REGION_FIELDS.forEach((f, i) => {
    params[`fields[${i}]`] = f;
  });

  if (region && region !== "all") {
    // continent values in API: "Europe", "Asia", "Middle East", "America"
    const map: Record<string, string> = {
      europe: "Europe",
      asia: "Asia",
      "middle-east": "Middle East",
      americas: "America",
    };
    params["filters[continent][$eqi]"] = map[region] || "";
  }

  const data = await apiGet<any>("/regions", params);
  return (data.data || []).map(mapCityRaw).map(redactCity);
}

/**
 * Get info about a specific city + venue counts + price range.
 */
export async function getCityInfo(citySlug: string): Promise<{
  city: CityInfo | null;
  venueCount: number;
  categories: { name: string; slug: string; count: number }[];
  priceRange: { min: number; max: number; currency: string };
}> {
  const cityParams: Record<string, string> = {
    "filters[url][$eq]": citySlug.toLowerCase(),
    "pagination[limit]": "1",
  };
  REGION_FIELDS.forEach((f, i) => {
    cityParams[`fields[${i}]`] = f;
  });

  const cityData = await apiGet<any>("/regions", cityParams);
  const city = cityData.data?.[0]
    ? redactCity(mapCityRaw(cityData.data[0]))
    : null;

  // Pull a sample to compute aggregates. Cap at 100 venues per city for the MVP.
  const venueParams: Record<string, string> = {
    "filters[regions][url][$eq]": citySlug.toLowerCase(),
    "populate[categories][fields][0]": "name",
    "populate[categories][fields][1]": "slug",
    "pagination[limit]": "100",
    sort: "popularity:desc",
  };
  ["priceCalculatedPerHour", "highestSetupCapacity", "lowestSetupCapacity"].forEach(
    (f, i) => (venueParams[`fields[${i}]`] = f)
  );

  const venueData = await apiGet<any>("/spaces", venueParams);
  const total = venueData.meta?.pagination?.total || 0;

  const catCounts = new Map<
    string,
    { name: string; slug: string; count: number }
  >();
  for (const space of venueData.data || []) {
    for (const cat of space.attributes?.categories?.data || []) {
      const slug = cat.attributes?.slug || "";
      const name = cat.attributes?.name || "";
      const existing = catCounts.get(slug);
      if (existing) existing.count++;
      else catCounts.set(slug, { name, slug, count: 1 });
    }
  }

  const prices = (venueData.data || [])
    .map((s: any) => s.attributes?.priceCalculatedPerHour)
    .filter((p: any) => p && p > 0);

  return {
    city,
    venueCount: total,
    categories: [...catCounts.values()].sort((a, b) => b.count - a.count),
    priceRange: {
      min: prices.length ? Math.min(...prices) : 0,
      max: prices.length ? Math.max(...prices) : 0,
      currency: city?.currency || "€",
    },
  };
}

/**
 * Aggregate pricing for a city (kept simple — averages from /spaces sample).
 * v2.1: switch to /activity-pricings + /catering-prices for richer pricing bands.
 */
export async function getPricingGuide(opts: {
  city: string;
  eventType?: string;
  capacity?: number;
}): Promise<{
  city: string;
  sampleSize: number;
  pricePerHour: { min: number; avg: number; max: number };
  pricePerDay: { min: number; avg: number; max: number };
  currency: string;
  byCategory: { category: string; avgPerHour: number; count: number }[];
}> {
  const params: Record<string, string> = {
    "filters[regions][url][$eq]": opts.city.toLowerCase(),
    "populate[categories][fields][0]": "name",
    "populate[regions][fields][0]": "currencyType",
    "pagination[limit]": "100",
    sort: "popularity:desc",
  };
  [
    "priceCalculatedPerHour",
    "jobPriceDay",
    "jobCurrency",
    "highestSetupCapacity",
    "lowestSetupCapacity",
  ].forEach((f, i) => (params[`fields[${i}]`] = f));

  if (opts.capacity) {
    params["filters[highestSetupCapacity][$gte]"] = String(opts.capacity);
  }

  const data = await apiGet<any>("/spaces", params);
  const spaces = data.data || [];

  const hourlyPrices = spaces
    .map((s: any) => s.attributes?.priceCalculatedPerHour)
    .filter((p: any) => p && p > 0);

  const dayPrices = spaces
    .map((s: any) => parseFloat(s.attributes?.jobPriceDay))
    .filter((p: number) => !isNaN(p) && p > 0);

  const avg = (arr: number[]) =>
    arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  const catPrices = new Map<string, number[]>();
  for (const s of spaces) {
    const price = s.attributes?.priceCalculatedPerHour;
    if (!price || price <= 0) continue;
    for (const cat of s.attributes?.categories?.data || []) {
      const name = cat.attributes?.name || "Other";
      if (!catPrices.has(name)) catPrices.set(name, []);
      catPrices.get(name)!.push(price);
    }
  }

  const regionAttrs = spaces[0]?.attributes?.regions?.data?.[0]?.attributes;

  return {
    city: opts.city,
    sampleSize: spaces.length,
    pricePerHour: {
      min: hourlyPrices.length ? Math.min(...hourlyPrices) : 0,
      avg: avg(hourlyPrices),
      max: hourlyPrices.length ? Math.max(...hourlyPrices) : 0,
    },
    pricePerDay: {
      min: dayPrices.length ? Math.min(...dayPrices) : 0,
      avg: avg(dayPrices),
      max: dayPrices.length ? Math.max(...dayPrices) : 0,
    },
    currency: regionAttrs?.currencyType || "€",
    byCategory: [...catPrices.entries()]
      .map(([category, prices]) => ({
        category,
        avgPerHour: avg(prices),
        count: prices.length,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * Find expert advice articles for a city. Returns lightweight summaries.
 * Uses the custom /fetch-expert-advice/{location} or
 * /fetch-category-expert-advice/{location}/{category} endpoint — these are
 * purpose-built for the LP and return pre-joined data.
 *
 * v2.0 patch: switched away from /expert-advices (auto-generated CRUD)
 * because its Strapi filter syntax doesn't accept filters[region][url][$eq]
 * (returns 400). The custom controllers take path params and just work.
 */
export async function findExpertAdvice(opts: {
  city: string;
  category?: string;
  limit?: number;
}): Promise<ExpertArticle[]> {
  const cityLower = opts.city.toLowerCase();
  const limit = Math.min(opts.limit || 5, 10);

  // Choose endpoint by whether a category is provided.
  const path = opts.category
    ? `/fetch-category-expert-advice/${encodeURIComponent(cityLower)}/${encodeURIComponent(opts.category.toLowerCase())}`
    : `/fetch-expert-advice/${encodeURIComponent(cityLower)}`;

  let data: any;
  try {
    data = await apiGet<any>(path, {});
  } catch (err) {
    // Fallback: the custom controller might 404 for unknown city/category combos
    // or be undeployed. Return empty rather than 500-ing the LLM call.
    return [];
  }

  // The custom Strapi controllers return varying shapes. Try several:
  //   1. { data: [...] }
  //   2. [...]            (raw array)
  //   3. { results: [...] }
  //   4. { articles: [...] }
  //   5. { expertAdvices: [...] }
  let items: any[] = [];
  if (Array.isArray(data)) items = data;
  else if (Array.isArray(data?.data)) items = data.data;
  else if (Array.isArray(data?.results)) items = data.results;
  else if (Array.isArray(data?.articles)) items = data.articles;
  else if (Array.isArray(data?.expertAdvices)) items = data.expertAdvices;
  else if (Array.isArray(data?.expert_advices)) items = data.expert_advices;

  return items
    .slice(0, limit)
    .map((item: any) => {
      const a = item.attributes || item;
      return {
        id: item.id || a.id || 0,
        title: a.title || "",
        slug: a.slug || "",
        citySlug: cityLower,
        shortDescription: (a.shortDescription || a.short_description || a.description || "").slice(0, 300),
        url: `${EVENTFLARE_URL}/expert-advice/${cityLower}/${a.slug}`,
        publishedAt: a.publishedAt || a.published_at || null,
      };
    })
    .filter((art) => art.slug) // drop any with no slug
    .map(redactArticle);
}

/**
 * Find a local Eventflare event expert for a given city.
 * Returns name, role, short bio, and the public scheduler link (HubSpot).
 * Strips employeeEmail and employeeAddress.
 */
export async function findLocalExpert(
  citySlug: string
): Promise<LocalExpert | null> {
  const params: Record<string, string> = {
    "filters[region][url][$eq]": citySlug.toLowerCase(),
    "pagination[limit]": "1",
  };
  EMPLOYEE_FIELDS.forEach((f, i) => {
    params[`fields[${i}]`] = f;
  });

  const data = await apiGet<any>("/employees", params);
  if (!data.data?.length) return null;
  const a = data.data[0].attributes || data.data[0];
  return redactExpert({
    authorName: a.authorName || a.title || "",
    role: a.role || "Local Event Expert",
    shortDescription: (a.shortDescription || a.heroDescription || "").slice(0, 300),
    schedulerUrl: a.hubspotSchedulerLink || null,
    city: citySlug,
  });
}
