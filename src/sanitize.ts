/**
 * Input sanitization for MCP tool parameters.
 * Validates and cleans every input before it reaches the API.
 *
 * v2 additions:
 *   - sanitizeCategory: stricter list of allowed venue category slugs
 *   - sanitizeContinent: continent filter for list_cities
 *   - sanitizeArticleSlug: looser than sanitizeSlug for article slugs (which can contain digits/hyphens)
 */

const MAX_STRING_LENGTH = 100;

// Slug = lowercase letters, digits, hyphens. Must start/end with alphanum.
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

const ALLOWED_CATEGORIES = new Set([
  "conference-venues",
  "meeting-rooms",
  "workshop-spaces",
  "event-spaces",
  "outdoor-venues",
  "private-dining-venues",
  "rooftop-venues",
  "unique-venues",
]);

const ALLOWED_CONTINENTS = new Set([
  "europe",
  "asia",
  "middle-east",
  "americas",
  "all",
]);

export function sanitizeSlug(value: string, fieldName: string): string {
  if (!value || typeof value !== "string") {
    throw new Error(`${fieldName} is required`);
  }
  const cleaned = value.trim().toLowerCase().slice(0, MAX_STRING_LENGTH);
  if (cleaned.length < 1) throw new Error(`${fieldName} cannot be empty`);
  if (!SLUG_REGEX.test(cleaned)) {
    const fixed = cleaned.replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (fixed.length < 1) throw new Error(`${fieldName} contains invalid characters`);
    return fixed;
  }
  return cleaned;
}

export function sanitizeEventType(value: string): string {
  if (!value || typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .slice(0, MAX_STRING_LENGTH)
    .replace(/[^a-z0-9- ]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function sanitizeNumber(
  value: number | undefined,
  min: number,
  max: number,
  defaultValue?: number
): number | undefined {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "number" || isNaN(value)) return defaultValue;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function sanitizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(value);
  if (isNaN(date.getTime())) return undefined;
  return value;
}

export function sanitizeContinent(value: string | undefined): "europe" | "asia" | "middle-east" | "americas" | "all" {
  if (!value) return "all";
  const cleaned = value.trim().toLowerCase();
  return ALLOWED_CONTINENTS.has(cleaned) ? (cleaned as any) : "all";
}

export function sanitizeCategory(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().toLowerCase();
  return ALLOWED_CATEGORIES.has(cleaned) ? cleaned : undefined;
}
