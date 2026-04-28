/**
 * Analytics logger and summary generator.
 *
 * v2 changes:
 *   - Added: mcp_session_id, client_class, query_hour_utc, budget_band, language
 *   - Added: result_clicked_through tracking (does a follow-up reference a search result?)
 *   - Mirrors every event to remote sink via analytics-sink.ts (OpenPanel etc.) — fire and forget
 *   - All fields strictly non-PII. No user identity, no message content.
 */

import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sendToSink } from "./analytics-sink.js";

const LOG_DIR = process.env.LOG_DIR || join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "queries.jsonl");

try {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
} catch {}

const recentQueries: QueryLog[] = [];
const MAX_MEMORY = 1000;

// Track which venues were returned in a session so we can detect click-through
// when a follow-up tool call references one of them.
const sessionVenueIds = new Map<string, Set<number>>();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const sessionLastSeen = new Map<string, number>();

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [sid, ts] of sessionLastSeen) {
    if (ts < cutoff) {
      sessionVenueIds.delete(sid);
      sessionLastSeen.delete(sid);
    }
  }
}, 5 * 60 * 1000);

export interface QueryLog {
  timestamp: string;
  tool: string;
  city?: string;
  capacity?: number;
  eventType?: string;
  category?: string;
  region?: string;
  resultCount?: number;
  // v2 additions
  sessionId?: string;
  clientClass?: string; // "claude_desktop" | "chatgpt" | "perplexity" | ...
  queryHourUtc?: number;
  budgetBand?: string; // "low" | "mid" | "high" — derived
  language?: string;
  resultClickedThrough?: boolean; // for get_venue_details / request_quote follow-ups
  landmarkSlug?: string;
  neighborhood?: string;
  activitySlug?: string;
  venueId?: number; // for detail / quote calls
}

/**
 * Record venue IDs returned by a search so we can detect click-through later.
 */
export function trackSearchResults(sessionId: string | undefined, venueIds: number[]): void {
  if (!sessionId) return;
  const set = sessionVenueIds.get(sessionId) || new Set();
  for (const id of venueIds) set.add(id);
  sessionVenueIds.set(sessionId, set);
  sessionLastSeen.set(sessionId, Date.now());
}

/**
 * Returns true if this venue was previously surfaced in this MCP session
 * (and thus the current call is a click-through from a search result).
 */
export function wasSearchResult(sessionId: string | undefined, venueId: number): boolean {
  if (!sessionId) return false;
  return sessionVenueIds.get(sessionId)?.has(venueId) || false;
}

/** Coarse budget band from capacity hint (rough — refine with city-specific pricing later). */
export function deriveBudgetBand(capacity?: number): string | undefined {
  if (!capacity) return undefined;
  if (capacity <= 20) return "intimate"; // 1-20
  if (capacity <= 75) return "small"; // 21-75
  if (capacity <= 200) return "mid"; // 76-200
  if (capacity <= 500) return "large"; // 201-500
  return "xlarge"; // 500+
}

export function logQuery(entry: QueryLog): void {
  const enriched: QueryLog = {
    ...entry,
    queryHourUtc: new Date(entry.timestamp).getUTCHours(),
    budgetBand: entry.budgetBand || deriveBudgetBand(entry.capacity),
  };

  recentQueries.push(enriched);
  if (recentQueries.length > MAX_MEMORY) recentQueries.shift();

  try {
    appendFileSync(LOG_FILE, JSON.stringify(enriched) + "\n");
  } catch {}

  // Fire-and-forget remote sink. Never blocks. Never throws.
  sendToSink(enriched).catch(() => {});
}

export function readAllQueries(): QueryLog[] {
  const fromFile: QueryLog[] = [];
  try {
    if (existsSync(LOG_FILE)) {
      const content = readFileSync(LOG_FILE, "utf-8");
      for (const line of content.split("\n")) {
        if (line.trim()) {
          try {
            fromFile.push(JSON.parse(line));
          } catch {}
        }
      }
    }
  } catch {}
  return fromFile.length > 0 ? fromFile : recentQueries;
}

export function getAnalyticsSummary(): {
  total: number;
  last24h: number;
  last7d: number;
  last30d: number;
  byTool: Record<string, number>;
  byClient: Record<string, number>;
  topCities: { city: string; count: number }[];
  topEventTypes: { eventType: string; count: number }[];
  topCategories: { category: string; count: number }[];
  capacityDistribution: { range: string; count: number }[];
  budgetBands: { band: string; count: number }[];
  dailyTimeline: { date: string; count: number }[];
  hourlyDistribution: { hour: number; count: number }[];
  clickThroughRate: number;
  recentQueries: QueryLog[];
} {
  const queries = readAllQueries();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const last24h = queries.filter((q) => now - new Date(q.timestamp).getTime() < day).length;
  const last7d = queries.filter((q) => now - new Date(q.timestamp).getTime() < 7 * day).length;
  const last30d = queries.filter((q) => now - new Date(q.timestamp).getTime() < 30 * day).length;

  const byTool: Record<string, number> = {};
  const byClient: Record<string, number> = {};
  const cityCounts = new Map<string, number>();
  const eventCounts = new Map<string, number>();
  const catCounts = new Map<string, number>();
  const bandCounts = new Map<string, number>();
  const dailyCounts = new Map<string, number>();
  const hourlyCounts = new Array(24).fill(0);

  let searches = 0;
  let clickThroughs = 0;

  for (const q of queries) {
    byTool[q.tool] = (byTool[q.tool] || 0) + 1;
    if (q.clientClass) byClient[q.clientClass] = (byClient[q.clientClass] || 0) + 1;
    if (q.city) cityCounts.set(q.city, (cityCounts.get(q.city) || 0) + 1);
    if (q.eventType) eventCounts.set(q.eventType, (eventCounts.get(q.eventType) || 0) + 1);
    if (q.category) catCounts.set(q.category, (catCounts.get(q.category) || 0) + 1);
    if (q.budgetBand) bandCounts.set(q.budgetBand, (bandCounts.get(q.budgetBand) || 0) + 1);

    const date = q.timestamp.split("T")[0];
    if (date) dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1);
    const hour = new Date(q.timestamp).getUTCHours();
    if (!isNaN(hour)) hourlyCounts[hour]++;

    if (q.tool === "search_venues") searches++;
    if (q.resultClickedThrough) clickThroughs++;
  }

  const topCities = [...cityCounts.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
  const topEventTypes = [...eventCounts.entries()]
    .map(([eventType, count]) => ({ eventType, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const topCategories = [...catCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const budgetBands = [...bandCounts.entries()]
    .map(([band, count]) => ({ band, count }))
    .sort((a, b) => b.count - a.count);

  const capacityBuckets = [
    { range: "1-20", min: 1, max: 20, count: 0 },
    { range: "21-75", min: 21, max: 75, count: 0 },
    { range: "76-200", min: 76, max: 200, count: 0 },
    { range: "201-500", min: 201, max: 500, count: 0 },
    { range: "500+", min: 501, max: 99999, count: 0 },
  ];
  for (const q of queries) {
    if (!q.capacity) continue;
    for (const b of capacityBuckets) {
      if (q.capacity >= b.min && q.capacity <= b.max) {
        b.count++;
        break;
      }
    }
  }

  const dailyTimeline = [...dailyCounts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);
  const hourlyDistribution = hourlyCounts.map((count, hour) => ({ hour, count }));

  return {
    total: queries.length,
    last24h,
    last7d,
    last30d,
    byTool,
    byClient,
    topCities,
    topEventTypes,
    topCategories,
    capacityDistribution: capacityBuckets.map(({ range, count }) => ({ range, count })),
    budgetBands,
    dailyTimeline,
    hourlyDistribution,
    clickThroughRate: searches ? Math.round((clickThroughs / searches) * 1000) / 10 : 0,
    recentQueries: queries.slice(-20).reverse(),
  };
}
