/**
 * Strapi API client for Eventflare venue data.
 * Calls dev-content.eventflare.io/api directly — no auth required for GET.
 * When migrating off Strapi, swap STRAPI_API_URL and update response mapping.
 */

const STRAPI_API_URL = process.env.STRAPI_API_URL || "https://dev-content.eventflare.io/api";
const EVENTFLARE_URL = process.env.EVENTFLARE_URL || "https://eventflare.io";

// ---------- Types ----------

export interface VenueSummary {
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
  address: string | null;
  rating: number | null;
  ratingsCount: number | null;
  popularity: number | null;
  isTopChoice: boolean;
  isFeatured: boolean;
  description: string;
  imageUrl: string | null;
  url: string;
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

export interface PaginationMeta {
  total: number;
  start: number;
  limit: number;
}

// ---------- Field Mapping ----------

function mapVenue(item: any): VenueSummary {
  const a = item.attributes || item;

  // Region (city) — first region
  const region = a.regions?.data?.[0]?.attributes || {};
  const citySlug = region.url || "";
  const cityName = region.name || "";
  const country = region.country || "";

  // Categories
  const categories = (a.categories?.data || []).map((c: any) => c.attributes?.name).filter(Boolean);

  // Labels (style tags)
  const labels = (a.labels?.data || []).map((l: any) => l.attributes?.name).filter(Boolean);

  // Amenities
  const amenities = (a.amenities?.data || []).map((am: any) => am.attributes?.name).filter(Boolean);

  // Activities (event types)
  const activities = (a.activities?.data || []).map((ac: any) => ac.attributes?.title).filter(Boolean);

  // Setup capacities — only non-zero
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

  // Image
  const imgData = a.featuredImg?.data?.attributes;
  const imageUrl = imgData?.formats?.large?.url || imgData?.url || null;

  // Geo
  const geo = a.geoAddressData || {};

  // Description — use SEO metaDescription (clean, no HTML)
  const seo = a.seo || {};
  const description = seo.metaDescription || "";

  // Features string → array
  const features = a.mainFeatures
    ? a.mainFeatures.split(",").map((f: string) => f.trim()).filter(Boolean)
    : [];

  return {
    name: a.title || "",
    slug: a.slug || "",
    city: cityName,
    citySlug,
    country,
    category: categories,
    capacity: {
      min: a.lowestSetupCapacity || 0,
      max: a.highestSetupCapacity || 0,
    },
    setupTypes,
    pricePerHour: a.priceCalculatedPerHour || null,
    pricePerDay: a.jobPriceDay || null,
    priceHalfDay: a.jobPriceHalfday || null,
    currency: a.jobCurrency || "€",
    features,
    labels,
    amenities,
    activities,
    neighborhood: geo.geolocationNeighborhood || null,
    address: geo.geolocationAddress || null,
    rating: geo.rating || null,
    ratingsCount: geo.ratingsCount || null,
    popularity: a.popularity || null,
    isTopChoice: a.isTopChoice || false,
    isFeatured: a.isFeatured || false,
    description,
    imageUrl,
    url: `${EVENTFLARE_URL}/spaces/${citySlug}/${a.slug}`,
  };
}

function mapCity(item: any): CityInfo {
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

// ---------- API Calls ----------

async function strapiGet(path: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${STRAPI_API_URL}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString(), {
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Strapi API error: ${res.status} ${res.statusText} — ${url.pathname}`);
  }

  return res.json();
}

/**
 * Search venues with filters.
 */
export async function searchVenues(opts: {
  city?: string;
  capacityMin?: number;
  capacityMax?: number;
  category?: string;
  eventType?: string;
  limit?: number;
}): Promise<{ venues: VenueSummary[]; total: number; cityUrl: string }> {
  const params: Record<string, string> = {
    "populate": "*",
    "pagination[limit]": String(Math.min(opts.limit || 10, 25)),
    "sort": "popularity:desc",
  };

  // City filter — match region URL slug
  if (opts.city) {
    params["filters[regions][url][$eq]"] = opts.city.toLowerCase();
  }

  // Capacity filter
  if (opts.capacityMin) {
    params["filters[highestSetupCapacity][$gte]"] = String(opts.capacityMin);
  }
  if (opts.capacityMax) {
    params["filters[lowestSetupCapacity][$lte]"] = String(opts.capacityMax);
  }

  // Category filter — match category slug
  if (opts.category) {
    params["filters[categories][slug][$eq]"] = opts.category;
  }

  // Event type — match activity slug
  if (opts.eventType) {
    params["filters[activities][slug][$containsi]"] = opts.eventType;
  }

  const data = await strapiGet("/spaces", params);
  const venues = (data.data || []).map(mapVenue);
  const total = data.meta?.pagination?.total || venues.length;
  const citySlug = opts.city?.toLowerCase() || "";

  return {
    venues,
    total,
    cityUrl: citySlug ? `${EVENTFLARE_URL}/venues/${citySlug}` : `${EVENTFLARE_URL}/venues`,
  };
}

/**
 * Get details for a single venue.
 */
export async function getVenueDetails(city: string, venueSlug: string): Promise<VenueSummary | null> {
  const params: Record<string, string> = {
    "populate": "*",
    "filters[slug][$eq]": venueSlug,
    "filters[regions][url][$eq]": city.toLowerCase(),
    "pagination[limit]": "1",
  };

  const data = await strapiGet("/spaces", params);
  if (!data.data?.length) return null;
  return mapVenue(data.data[0]);
}

/**
 * List all cities (regions) with venue counts.
 */
export async function listCities(region?: string): Promise<CityInfo[]> {
  const params: Record<string, string> = {
    "pagination[limit]": "100",
    "sort": "name:asc",
  };

  if (region && region !== "all") {
    params["filters[continent][$containsi]"] = region;
  }

  const data = await strapiGet("/regions", params);
  return (data.data || []).map(mapCity);
}

/**
 * Get info about a specific city.
 */
export async function getCityInfo(citySlug: string): Promise<{
  city: CityInfo | null;
  venueCount: number;
  categories: { name: string; slug: string; count: number }[];
  priceRange: { min: number; max: number; currency: string };
}> {
  // Get city details
  const cityData = await strapiGet("/regions", {
    "filters[url][$eq]": citySlug.toLowerCase(),
    "pagination[limit]": "1",
  });

  const city = cityData.data?.[0] ? mapCity(cityData.data[0]) : null;

  // Get venue count and sample for stats
  const venueData = await strapiGet("/spaces", {
    "filters[regions][url][$eq]": citySlug.toLowerCase(),
    "populate": "categories",
    "pagination[limit]": "100",
    "sort": "popularity:desc",
  });

  const total = venueData.meta?.pagination?.total || 0;

  // Aggregate categories from sample
  const catCounts = new Map<string, { name: string; slug: string; count: number }>();
  for (const space of venueData.data || []) {
    for (const cat of space.attributes?.categories?.data || []) {
      const slug = cat.attributes?.slug || "";
      const name = cat.attributes?.name || "";
      const existing = catCounts.get(slug);
      if (existing) {
        existing.count++;
      } else {
        catCounts.set(slug, { name, slug, count: 1 });
      }
    }
  }

  // Get price range from sample
  const prices = (venueData.data || [])
    .map((s: any) => s.attributes?.priceCalculatedPerHour)
    .filter((p: any) => p && p > 0);

  const currency = city?.currency || "€";

  return {
    city,
    venueCount: total,
    categories: [...catCounts.values()].sort((a, b) => b.count - a.count),
    priceRange: {
      min: prices.length ? Math.min(...prices) : 0,
      max: prices.length ? Math.max(...prices) : 0,
      currency,
    },
  };
}

/**
 * Get pricing guide for a city.
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
    "populate": "categories,regions",
    "pagination[limit]": "100",
    "sort": "popularity:desc",
  };

  if (opts.capacity) {
    params["filters[highestSetupCapacity][$gte]"] = String(opts.capacity);
  }

  const data = await strapiGet("/spaces", params);
  const spaces = data.data || [];

  const hourlyPrices = spaces
    .map((s: any) => s.attributes?.priceCalculatedPerHour)
    .filter((p: any) => p && p > 0);

  const dayPrices = spaces
    .map((s: any) => parseFloat(s.attributes?.jobPriceDay))
    .filter((p: number) => !isNaN(p) && p > 0);

  const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

  // By category
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
  const currency = regionAttrs?.currencyType || "€";

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
    currency,
    byCategory: [...catPrices.entries()]
      .map(([category, prices]) => ({
        category,
        avgPerHour: avg(prices),
        count: prices.length,
      }))
      .sort((a, b) => b.count - a.count),
  };
}
