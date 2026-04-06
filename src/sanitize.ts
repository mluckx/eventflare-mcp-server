/**
 * Input sanitization for MCP tool parameters.
 * Validates and cleans all inputs before they reach Strapi.
 */

// Max string length for any input
const MAX_STRING_LENGTH = 100;

// Allowed characters for slugs (city names, venue slugs, categories)
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

// Allowed characters for event type strings
const EVENT_TYPE_REGEX = /^[a-z0-9][a-z0-9- ]*[a-z0-9]$/;

/**
 * Sanitize a slug parameter (city, venue, category).
 * Returns cleaned slug or throws if invalid.
 */
export function sanitizeSlug(value: string, fieldName: string): string {
  if (!value || typeof value !== "string") {
    throw new Error(`${fieldName} is required`);
  }

  const cleaned = value.trim().toLowerCase().slice(0, MAX_STRING_LENGTH);

  if (cleaned.length < 1) {
    throw new Error(`${fieldName} cannot be empty`);
  }

  // Allow simple slugs — letters, numbers, hyphens
  if (!SLUG_REGEX.test(cleaned) && cleaned.length > 1) {
    // Try to fix by removing invalid chars
    const fixed = cleaned.replace(/[^a-z0-9-]/g, "").replace(/--+/g, "-");
    if (fixed.length < 1) {
      throw new Error(`${fieldName} contains invalid characters`);
    }
    return fixed;
  }

  return cleaned;
}

/**
 * Sanitize an event type string.
 */
export function sanitizeEventType(value: string): string {
  if (!value || typeof value !== "string") return "";
  const cleaned = value.trim().toLowerCase().slice(0, MAX_STRING_LENGTH);
  return cleaned.replace(/[^a-z0-9- ]/g, "").replace(/--+/g, "-");
}

/**
 * Sanitize a number parameter (capacity, limit).
 * Returns clamped number within allowed range.
 */
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

/**
 * Sanitize a date string (ISO format).
 */
export function sanitizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // Basic ISO date format validation: YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(value)) return undefined;
  // Verify it's a real date
  const date = new Date(value);
  if (isNaN(date.getTime())) return undefined;
  return value;
}

/**
 * Sanitize a region filter.
 */
export function sanitizeRegion(value: string | undefined): string {
  const allowed = ["europe", "asia", "middle-east", "americas", "all"];
  if (!value) return "all";
  const cleaned = value.trim().toLowerCase();
  return allowed.includes(cleaned) ? cleaned : "all";
}
