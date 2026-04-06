/**
 * Analytics logger and summary generator.
 * Logs every MCP tool call to a JSONL file for dashboard reporting.
 * No PII is logged — only tool name, city, capacity, event type, category, result count.
 */

import { writeFileSync, appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const LOG_DIR = process.env.LOG_DIR || join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "queries.jsonl");

// Ensure log directory exists
try {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
} catch {
  // If we can't create log dir, we'll log to memory only
}

// In-memory buffer for recent queries (last 1000)
const recentQueries: QueryLog[] = [];
const MAX_MEMORY = 1000;

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

/**
 * Log a query to both file and memory.
 */
export function logQuery(entry: QueryLog): void {
  // Add to memory buffer
  recentQueries.push(entry);
  if (recentQueries.length > MAX_MEMORY) {
    recentQueries.shift();
  }

  // Append to JSONL file
  try {
    appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  } catch {
    // Silently fail if file write fails (e.g., read-only filesystem)
  }
}

/**
 * Read all queries from file + memory.
 */
export function readAllQueries(): QueryLog[] {
  const fromFile: QueryLog[] = [];

  try {
    if (existsSync(LOG_FILE)) {
      const content = readFileSync(LOG_FILE, "utf-8");
      for (const line of content.split("\n")) {
        if (line.trim()) {
          try {
            fromFile.push(JSON.parse(line));
          } catch {
            // Skip malformed lines
          }
        }
      }
    }
  } catch {
    // Fall back to memory only
  }

  // Deduplicate: use file data if available, otherwise memory
  return fromFile.length > 0 ? fromFile : recentQueries;
}

/**
 * Generate analytics summary for dashboard.
 */
export function getAnalyticsSummary(): {
  total: number;
  last24h: number;
  last7d: number;
  last30d: number;
  byTool: Record<string, number>;
  topCities: { city: string; count: number }[];
  topEventTypes: { eventType: string; count: number }[];
  topCategories: { category: string; count: number }[];
  capacityDistribution: { range: string; count: number }[];
  dailyTimeline: { date: string; count: number }[];
  hourlyDistribution: { hour: number; count: number }[];
  recentQueries: QueryLog[];
} {
  const queries = readAllQueries();
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  // Time-based counts
  const last24h = queries.filter((q) => now - new Date(q.timestamp).getTime() < day).length;
  const last7d = queries.filter((q) => now - new Date(q.timestamp).getTime() < 7 * day).length;
  const last30d = queries.filter((q) => now - new Date(q.timestamp).getTime() < 30 * day).length;

  // By tool
  const byTool: Record<string, number> = {};
  for (const q of queries) {
    byTool[q.tool] = (byTool[q.tool] || 0) + 1;
  }

  // Top cities
  const cityCounts = new Map<string, number>();
  for (const q of queries) {
    if (q.city) cityCounts.set(q.city, (cityCounts.get(q.city) || 0) + 1);
  }
  const topCities = [...cityCounts.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Top event types
  const eventCounts = new Map<string, number>();
  for (const q of queries) {
    if (q.eventType) eventCounts.set(q.eventType, (eventCounts.get(q.eventType) || 0) + 1);
  }
  const topEventTypes = [...eventCounts.entries()]
    .map(([eventType, count]) => ({ eventType, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Top categories
  const catCounts = new Map<string, number>();
  for (const q of queries) {
    if (q.category) catCounts.set(q.category, (catCounts.get(q.category) || 0) + 1);
  }
  const topCategories = [...catCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Capacity distribution
  const capacityBuckets = [
    { range: "1-10", min: 1, max: 10, count: 0 },
    { range: "11-30", min: 11, max: 30, count: 0 },
    { range: "31-50", min: 31, max: 50, count: 0 },
    { range: "51-100", min: 51, max: 100, count: 0 },
    { range: "101-200", min: 101, max: 200, count: 0 },
    { range: "201-500", min: 201, max: 500, count: 0 },
    { range: "500+", min: 501, max: 99999, count: 0 },
  ];
  for (const q of queries) {
    if (q.capacity) {
      for (const bucket of capacityBuckets) {
        if (q.capacity >= bucket.min && q.capacity <= bucket.max) {
          bucket.count++;
          break;
        }
      }
    }
  }

  // Daily timeline (last 30 days)
  const dailyCounts = new Map<string, number>();
  for (const q of queries) {
    const date = q.timestamp.split("T")[0];
    if (date) dailyCounts.set(date, (dailyCounts.get(date) || 0) + 1);
  }
  const dailyTimeline = [...dailyCounts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30);

  // Hourly distribution
  const hourlyCounts = new Array(24).fill(0);
  for (const q of queries) {
    const hour = new Date(q.timestamp).getHours();
    if (!isNaN(hour)) hourlyCounts[hour]++;
  }
  const hourlyDistribution = hourlyCounts.map((count, hour) => ({ hour, count }));

  return {
    total: queries.length,
    last24h,
    last7d,
    last30d,
    byTool,
    topCities,
    topEventTypes,
    topCategories,
    capacityDistribution: capacityBuckets.map(({ range, count }) => ({ range, count })),
    dailyTimeline,
    hourlyDistribution,
    recentQueries: queries.slice(-20).reverse(),
  };
}
