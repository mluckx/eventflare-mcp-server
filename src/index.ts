/**
 * Eventflare MCP Server v2.0.0
 *
 * Makes Eventflare's production venue data queryable by AI assistants
 * (Claude Desktop, Claude Code, ChatGPT, Perplexity, Cursor) via MCP.
 *
 * v2 changes:
 *   - Production API + JWT bearer auth (was: dev API, no auth)
 *   - PII redaction allowlist (jobPhone, venueEmail, commission, spaceNotes never returned)
 *   - UTM attribution on every outbound URL (utm_source=mcp&utm_medium=ai&utm_campaign={tool})
 *   - mcp_session_id propagated through logs and URLs
 *   - Client classification (claude_desktop / chatgpt / perplexity / etc.)
 *   - OpenPanel analytics sink (env-var, defaults to off)
 *   - New tool: find_expert_advice (LLM-citation play)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { getAnalyticsSummary } from "./analytics.js";
import { getDashboardHtml } from "./dashboard.js";
import { checkRateLimit, recordRequest, getStats } from "./rate-limiter.js";
import { getCacheStats } from "./cache.js";

const VERSION = "2.0.0";

// For stdio mode only — HTTP mode creates a fresh server per session
const server = new McpServer({
  name: "eventflare",
  version: VERSION,
});

registerTools(server);

function createServer() {
  const s = new McpServer({ name: "eventflare", version: VERSION });
  registerTools(s);
  return s;
}

const transport = process.env.TRANSPORT || "stdio";

if (transport === "http") {
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );
  const { createServer } = await import("node:http");
  const PORT = parseInt(process.env.PORT || "3001");
  const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || "60");

  const transports = new Map<
    string,
    InstanceType<typeof StreamableHTTPServerTransport>
  >();

  const httpServer = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, mcp-session-id, user-agent"
    );
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    // Hardening
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("Referrer-Policy", "no-referrer");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    if (req.url?.startsWith("/mcp")) {
      const { allowed, remaining, resetAt } = checkRateLimit(ip, RATE_LIMIT);
      res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

      if (!allowed) {
        recordRequest(true);
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Rate limit exceeded",
            message: `Max ${RATE_LIMIT} requests per minute.`,
          })
        );
        return;
      }
      recordRequest(false);
    }

    if (req.url === "/health") {
      const stats = getStats();
      const cacheStats = getCacheStats();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          server: "eventflare-mcp",
          version: VERSION,
          security: {
            rate_limit: `${RATE_LIMIT}/min`,
            requests_total: stats.total,
            requests_blocked: stats.blocked,
            cache_entries: cacheStats.entries,
            api_token_configured: !!process.env.EVENTFLARE_API_TOKEN,
          },
        })
      );
      return;
    }

    if (req.url?.startsWith("/dashboard")) {
      const dashKey = process.env.DASHBOARD_KEY;
      if (dashKey) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.searchParams.get("key") !== dashKey) {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("Unauthorized. Append ?key=YOUR_DASHBOARD_KEY");
          return;
        }
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(getDashboardHtml(VERSION));
      return;
    }

    if (req.url?.startsWith("/api/analytics")) {
      const dashKey = process.env.DASHBOARD_KEY;
      if (dashKey) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.searchParams.get("key") !== dashKey) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return;
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(getAnalyticsSummary()));
      return;
    }

    if (req.url?.startsWith("/mcp")) {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        // Read the raw body off the stream, then JSON.parse it.
        // MCP SDK >= 1.12 expects handleRequest's third arg to be PARSED
        // JSON, not a string. Passing a string yields a -32700 Parse error.
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString();

        let parsedBody: unknown = undefined;
        if (raw.length) {
          try {
            parsedBody = JSON.parse(raw);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32700, message: "Parse error: body is not valid JSON" },
                id: null,
              })
            );
            return;
          }
        }

        if (sessionId && transports.has(sessionId)) {
          const t = transports.get(sessionId)!;
          await t.handleRequest(req, res, parsedBody);
        } else {
          // Create a fresh McpServer per session — the SDK does not allow
          // connecting the same server instance to multiple transports.
          const sessionServer = createServer();
          const t = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id) => {
              transports.set(id, t);
            },
          });
          t.onclose = () => {
            const id = [...transports.entries()].find(([_, x]) => x === t)?.[0];
            if (id) transports.delete(id);
          };
          await sessionServer.connect(t);
          await t.handleRequest(req, res, parsedBody);
        }
        return;
      }

      if (req.method === "GET") {
        if (sessionId && transports.has(sessionId)) {
          await transports.get(sessionId)!.handleRequest(req, res);
          return;
        }
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No session. Send a POST first." }));
        return;
      }

      if (req.method === "DELETE") {
        if (sessionId && transports.has(sessionId)) {
          const t = transports.get(sessionId)!;
          await t.handleRequest(req, res);
          transports.delete(sessionId);
          return;
        }
        res.writeHead(404);
        res.end();
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. MCP endpoint is at /mcp" }));
  });

  httpServer.listen(PORT, () => {
    console.error(`Eventflare MCP server v${VERSION} (HTTP) running on port ${PORT}`);
    console.error(`MCP endpoint: http://localhost:${PORT}/mcp`);
    console.error(`Dashboard:    http://localhost:${PORT}/dashboard`);
    console.error(`Health:       http://localhost:${PORT}/health`);
    console.error(`Rate limit:   ${RATE_LIMIT} req/min per IP`);
    console.error(
      `API token:    ${
        process.env.EVENTFLARE_API_TOKEN ? "configured ✓" : "MISSING ✗ — set EVENTFLARE_API_TOKEN"
      }`
    );
    console.error(
      `Sink:         ${
        process.env.OPENPANEL_CLIENT_ID
          ? "OpenPanel ✓"
          : process.env.ANALYTICS_SINK_URL
          ? "Webhook ✓"
          : "local only"
      }`
    );
  });
} else {
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  console.error(`Eventflare MCP server v${VERSION} running on stdio`);
}
