/**
 * Remote analytics sink — fire-and-forget HTTP POST per event.
 *
 * Currently configured for OpenPanel's Track API
 * (https://docs.openpanel.dev/docs/api/track), but the same pattern works
 * for any HTTP events endpoint (Mixpanel, Segment, custom webhook).
 *
 * If env vars aren't set, sendToSink is a no-op — local JSONL logging still works.
 *
 * Required env vars (when enabled):
 *   OPENPANEL_CLIENT_ID      project / client id
 *   OPENPANEL_CLIENT_SECRET  write key
 *   OPENPANEL_API_URL        defaults to https://api.openpanel.dev
 *
 * Or, more generic:
 *   ANALYTICS_SINK_URL       any HTTP POST endpoint
 *   ANALYTICS_SINK_TOKEN     bearer token added as Authorization header
 */

import type { QueryLog } from "./analytics.js";

const OP_CLIENT_ID = process.env.OPENPANEL_CLIENT_ID || "";
const OP_CLIENT_SECRET = process.env.OPENPANEL_CLIENT_SECRET || "";
const OP_API_URL = process.env.OPENPANEL_API_URL || "https://api.openpanel.dev";

const SINK_URL = process.env.ANALYTICS_SINK_URL || "";
const SINK_TOKEN = process.env.ANALYTICS_SINK_TOKEN || "";

const SINK_TIMEOUT_MS = 3000;

let warned = false;

export async function sendToSink(event: QueryLog): Promise<void> {
  // Prefer OpenPanel if its credentials are set.
  if (OP_CLIENT_ID && OP_CLIENT_SECRET) {
    return sendToOpenPanel(event);
  }
  if (SINK_URL) {
    return sendToWebhook(event);
  }
  // Neither configured — silent no-op. Log dashboard still works locally.
  if (!warned) {
    console.error(
      "[analytics-sink] No remote sink configured. Set OPENPANEL_CLIENT_ID + OPENPANEL_CLIENT_SECRET (or ANALYTICS_SINK_URL) to mirror events. Local dashboard still records."
    );
    warned = true;
  }
}

async function sendToOpenPanel(event: QueryLog): Promise<void> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), SINK_TIMEOUT_MS);

  // OpenPanel expects the event in their schema.
  // See: https://docs.openpanel.dev/docs/api/track
  const payload = {
    type: "track",
    payload: {
      name: `mcp.${event.tool}`,
      // Use sessionId as profileId so OpenPanel groups events by session.
      profileId: event.sessionId || "anonymous",
      properties: {
        tool: event.tool,
        city: event.city,
        capacity: event.capacity,
        eventType: event.eventType,
        category: event.category,
        region: event.region,
        resultCount: event.resultCount,
        clientClass: event.clientClass,
        budgetBand: event.budgetBand,
        landmarkSlug: event.landmarkSlug,
        neighborhood: event.neighborhood,
        activitySlug: event.activitySlug,
        venueId: event.venueId,
        resultClickedThrough: event.resultClickedThrough,
        language: event.language,
        queryHourUtc: event.queryHourUtc,
      },
    },
  };

  try {
    await fetch(`${OP_API_URL}/api/track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "openpanel-client-id": OP_CLIENT_ID,
        "openpanel-client-secret": OP_CLIENT_SECRET,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    // Never let analytics break the MCP. Log to stderr only.
    console.error("[analytics-sink] OpenPanel send failed:", (err as Error).message);
  } finally {
    clearTimeout(t);
  }
}

async function sendToWebhook(event: QueryLog): Promise<void> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), SINK_TIMEOUT_MS);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (SINK_TOKEN) headers.Authorization = `Bearer ${SINK_TOKEN}`;

  try {
    await fetch(SINK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
      signal: controller.signal,
    });
  } catch (err) {
    console.error("[analytics-sink] Webhook send failed:", (err as Error).message);
  } finally {
    clearTimeout(t);
  }
}
