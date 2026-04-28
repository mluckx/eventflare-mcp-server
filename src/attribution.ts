/**
 * UTM attribution layer.
 *
 * Every URL that leaves the MCP gets utm_* tags so traffic that lands on
 * eventflare.io can be attributed back to the MCP — and to the specific
 * tool, client (Claude Desktop, ChatGPT, Perplexity, etc.) and session.
 *
 * Without this, "10x leads from MCP" is unmeasurable.
 */

const UTM_SOURCE = "mcp";
const UTM_MEDIUM = "ai";

export interface AttributionContext {
  tool: string; // e.g. "search_venues"
  clientClass: string; // e.g. "claude_desktop", "chatgpt", "perplexity", "claude_code", "unknown"
  sessionId?: string; // mcp-session-id
}

/**
 * Append UTM params + MCP session id to any Eventflare URL.
 * Idempotent: if the URL already has these params they are overwritten.
 */
export function tagUrl(url: string, ctx: AttributionContext): string {
  if (!url) return url;
  // Only tag eventflare.io URLs (don't push tags to third-party links).
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (!u.hostname.endsWith("eventflare.io")) return url;

  u.searchParams.set("utm_source", UTM_SOURCE);
  u.searchParams.set("utm_medium", UTM_MEDIUM);
  u.searchParams.set("utm_campaign", ctx.tool);
  u.searchParams.set("utm_content", ctx.clientClass || "unknown");
  if (ctx.sessionId) {
    u.searchParams.set("mcp_session", ctx.sessionId);
  }

  // Preserve hash (#inquiry) — URLSearchParams doesn't touch it but be safe.
  return u.toString();
}

/**
 * Apply tagUrl to every URL-shaped field on an object (shallow).
 * Useful for wrapping search results before returning them to the LLM.
 */
export function tagObjectUrls<T extends Record<string, any>>(
  obj: T,
  ctx: AttributionContext
): T {
  if (!obj || typeof obj !== "object") return obj;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (
      typeof v === "string" &&
      (k === "url" ||
        k === "quote_url" ||
        k === "quoteUrl" ||
        k === "city_url" ||
        k === "cityUrl" ||
        k === "browse_url" ||
        k === "inquiry_url" ||
        k === "scheduler_url" ||
        k === "schedulerUrl" ||
        k === "citation_url")
    ) {
      out[k] = tagUrl(v, ctx);
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === "object" ? tagObjectUrls(item, ctx) : item
      );
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/**
 * Classify the MCP client from the request headers / clientInfo.
 * Best-effort — falls back to "unknown".
 *
 * Inputs we may have:
 *   - clientInfo.name (from the MCP initialize handshake) — e.g. "claude-ai", "ChatGPT"
 *   - User-Agent header (HTTP transport only)
 */
export function classifyClient(opts: {
  clientName?: string;
  userAgent?: string;
}): string {
  const n = (opts.clientName || "").toLowerCase();
  const ua = (opts.userAgent || "").toLowerCase();
  const hay = `${n} ${ua}`;

  if (hay.includes("claude code")) return "claude_code";
  if (hay.includes("claude")) return "claude_desktop";
  if (hay.includes("openai") || hay.includes("chatgpt") || hay.includes("gpt-"))
    return "chatgpt";
  if (hay.includes("perplexity")) return "perplexity";
  if (hay.includes("cursor")) return "cursor";
  if (hay.includes("cline")) return "cline";
  if (hay.includes("inspector")) return "mcp_inspector";
  if (hay.includes("python")) return "python_sdk";
  if (hay.includes("node")) return "node_sdk";
  return "unknown";
}
