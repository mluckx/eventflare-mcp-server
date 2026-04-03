/**
 * Anonymized query analytics logger + API.
 * Logs every MCP tool call — no PII, just query patterns.
 * Output: JSONL file (one JSON object per line).
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const LOG_PATH = process.env.ANALYTICS_LOG || "./analytics.jsonl";

export interface QueryLog {
  timestamp: string;
  tool: string;
  city?: string;
  capacity?: number;
  eventType?: string;
  category?: string;
  region?: string;
  resultCount?: number;
}

export function logQuery(entry: QueryLog): void {
  try {
    const dir = dirname(LOG_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const line = JSON.stringify({
      ...entry,
      timestamp: entry.timestamp || new Date().toISOString(),
    });

    appendFileSync(LOG_PATH, line + "\n");
  } catch {
    // Analytics should never crash the server
  }
}

/**
 * Read all logged queries.
 */
export function readAllQueries(): QueryLog[] {
  try {
    if (!existsSync(LOG_PATH)) return [];
    const content = readFileSync(LOG_PATH, "utf-8").trim();
    if (!content) return [];
    return content.split("\n").map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * Compute analytics summary from logged queries.
 */
export function getAnalyticsSummary() {
  const queries = readAllQueries();
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Totals by period
  const total = queries.length;
  const last24hCount = queries.filter((q) => new Date(q.timestamp) >= last24h).length;
  const last7dCount = queries.filter((q) => new Date(q.timestamp) >= last7d).length;
  const last30dCount = queries.filter((q) => new Date(q.timestamp) >= last30d).length;

  // By tool
  const byTool: Record<string, number> = {};
  for (const q of queries) {
    byTool[q.tool] = (byTool[q.tool] || 0) + 1;
  }

  // By city (top 20)
  const byCity: Record<string, number> = {};
  for (const q of queries) {
    if (q.city) byCity[q.city] = (byCity[q.city] || 0) + 1;
  }
  const topCities = Object.entries(byCity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([city, count]) => ({ city, count }));

  // By event type (top 20)
  const byEventType: Record<string, number> = {};
  for (const q of queries) {
    if (q.eventType) byEventType[q.eventType] = (byEventType[q.eventType] || 0) + 1;
  }
  const topEventTypes = Object.entries(byEventType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([eventType, count]) => ({ eventType, count }));

  // By category (top 10)
  const byCategory: Record<string, number> = {};
  for (const q of queries) {
    if (q.category) byCategory[q.category] = (byCategory[q.category] || 0) + 1;
  }
  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([category, count]) => ({ category, count }));

  // Capacity distribution
  const capacityBuckets = { "1-10": 0, "11-50": 0, "51-100": 0, "101-250": 0, "251-500": 0, "500+": 0 };
  for (const q of queries) {
    if (!q.capacity) continue;
    if (q.capacity <= 10) capacityBuckets["1-10"]++;
    else if (q.capacity <= 50) capacityBuckets["11-50"]++;
    else if (q.capacity <= 100) capacityBuckets["51-100"]++;
    else if (q.capacity <= 250) capacityBuckets["101-250"]++;
    else if (q.capacity <= 500) capacityBuckets["251-500"]++;
    else capacityBuckets["500+"]++;
  }

  // Timeline — queries per day (last 30 days)
  const dailyCounts: Record<string, number> = {};
  for (const q of queries) {
    const day = q.timestamp.split("T")[0];
    dailyCounts[day] = (dailyCounts[day] || 0) + 1;
  }
  const timeline = Object.entries(dailyCounts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-30)
    .map(([date, count]) => ({ date, count }));

  // Hourly distribution
  const hourly = new Array(24).fill(0);
  for (const q of queries) {
    const hour = new Date(q.timestamp).getHours();
    hourly[hour]++;
  }

  return {
    overview: { total, last24h: last24hCount, last7d: last7dCount, last30d: last30dCount },
    byTool,
    topCities,
    topEventTypes,
    topCategories,
    capacityBuckets,
    timeline,
    hourly,
    recentQueries: queries.slice(-50).reverse(),
  };
}
