/**
 * PII redaction layer.
 *
 * The eventflare-client.ts already restricts what fields it requests from the
 * API (defense in depth — fields[]= allowlists). This module is the second
 * line of defense: it explicitly removes any field on a response that isn't
 * on the allowlist, so even if the upstream API ever starts returning extra
 * fields, they never leak to the LLM.
 *
 * Rule of thumb: anything that could identify a specific person, expose
 * internal commercial info, or reveal operational data goes here.
 */

import type {
  VenueSummary,
  CityInfo,
  ExpertArticle,
  LocalExpert,
} from "./eventflare-client.js";

// Known PII / internal field names to strip if they ever appear in an object.
const VENUE_BLOCKLIST = new Set([
  "jobPhone",
  "venueEmail",
  "commission",
  "spaceNotes",
  "spaceOwner",
  "assignedTo",
  "agreementSigned",
  "agreementDocument",
  "collabAgreement",
  "claimed",
  "trackedSubmitted",
  "wp_id",
  "publishedEmailSent",
  "calendarName",
  "icsCalendarUrl",
  // raw geo address — exact street stays internal; neighborhood is enough
  "geoAddressData",
]);

const EMPLOYEE_BLOCKLIST = new Set([
  "employeeEmail",
  "employeeAddress",
  // mapMarker / mapIcon are non-PII visual assets but unused by the MCP
  "mapMarker",
  "mapIcon",
]);

const PARTNER_BLOCKLIST = new Set([
  "partnerFirstName",
  "partnerLastName",
  "contactEmail",
  "venueEmail",
  "geoAddressData",
]);

const PROVIDER_BLOCKLIST = new Set(["costRange"]);

/**
 * Strip any blocklisted key from an object (shallow). Defensive only —
 * the mappers in eventflare-client.ts shouldn't be putting these on the
 * output in the first place.
 */
function stripKeys<T extends Record<string, any>>(obj: T, blocklist: Set<string>): T {
  if (!obj || typeof obj !== "object") return obj;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (blocklist.has(k)) continue;
    out[k] = v;
  }
  return out as T;
}

export function redactVenue(v: VenueSummary): VenueSummary {
  // Nothing in our mapped VenueSummary keys is on the blocklist by design —
  // this is a tripwire if someone adds an unsafe field later.
  const cleaned = stripKeys(v as Record<string, any>, VENUE_BLOCKLIST) as VenueSummary;
  // Also clamp description length defensively.
  if (cleaned.description && cleaned.description.length > 500) {
    cleaned.description = cleaned.description.slice(0, 500);
  }
  return cleaned;
}

export function redactCity(c: CityInfo): CityInfo {
  return c; // Cities are public info — no redaction needed.
}

export function redactArticle(a: ExpertArticle): ExpertArticle {
  return a; // Editorial content is public — no PII expected.
}

export function redactExpert(e: LocalExpert): LocalExpert {
  return stripKeys(e as Record<string, any>, EMPLOYEE_BLOCKLIST) as LocalExpert;
}

/**
 * Generic deep-strip helper for any future tools that surface raw objects.
 * Walks nested objects/arrays and removes blocklisted keys at every level.
 */
export function deepRedact(obj: any, blocklists: Set<string>[] = [VENUE_BLOCKLIST, EMPLOYEE_BLOCKLIST, PARTNER_BLOCKLIST, PROVIDER_BLOCKLIST]): any {
  const all = new Set<string>();
  for (const bl of blocklists) for (const k of bl) all.add(k);
  return walk(obj, all);
}

function walk(v: any, blocked: Set<string>): any {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return v.map((item) => walk(item, blocked));
  if (typeof v !== "object") return v;
  const out: Record<string, any> = {};
  for (const [k, val] of Object.entries(v)) {
    if (blocked.has(k)) continue;
    out[k] = walk(val, blocked);
  }
  return out;
}
