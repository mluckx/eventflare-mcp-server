/**
 * Eventflare MCP Server
 *
 * Makes Eventflare venue data queryable by AI assistants (Claude, ChatGPT, etc.)
 * via the Model Context Protocol (MCP).
 *
 * Security features:
 *   - Rate limiting (60 req/min per IP)
 *   - Input sanitization (all params validated)
 *   - Response caching (5-min TTL, reduces Strapi load)
 *   - Read-only (only GET requests to Strapi)
 *   - No PII in responses (emails, phones, commissions excluded)
 *
 * Transports:
 *   - stdio  (default) — for Claude Desktop, Claude Code, Cursor
 *   - http   — for remote access via Streamable HTTP
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { getAnalyticsSummary } from "./analytics.js";
import { getDashboardHtml } from "./dashboard.js";
import { checkRateLimit, recordRequest, getStats } from "./rate-limiter.js";
import { getCacheStats } from "./cache.js";

const server = new McpServer({
  name: "eventflare",
  version: "1.1.0",
});

// Register all 6 tools
registerTools(server);

// ---------- Transport ----------

const transport = process.env.TRANSPORT || "stdio";

if (transport === "http") {
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const { createServer } = await import("node:http");
  const PORT = parseInt(process.env.PORT || "3001");
  const RATE_LIMIT = parseInt(process.env.RATE_LIMIT || "60"); // requests per minute

  const transports = new Map<string, InstanceType<typeof StreamableHTTPServerTransport>>();

  const httpServer = createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id");
    res.setHeader("Access-Control-Expose-Headers", "mcp-session-id");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Get client IP
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      || req.socket.remoteAddress
      || "unknown";

    // Rate limiting for MCP endpoint
    if (req.url?.startsWith("/mcp")) {
      const { allowed, remaining, resetAt } = checkRateLimit(ip, RATE_LIMIT);
      res.setHeader("X-RateLimit-Limit", String(RATE_LIMIT));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
      res.setHeader("X-RateLimit-Reset", String(Math.ceil(resetAt / 1000)));

      if (!allowed) {
        recordRequest(true);
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          error: "Rate limit exceeded",
          message: `Max ${RATE_LIMIT} requests per minute. Try again in ${Math.ceil((resetAt - Date.now()) / 1000)} seconds.`,
        }));
        return;
      }
      recordRequest(false);
    }

    // Health check
    if (req.url === "/health") {
      const stats = getStats();
      const cacheStats = getCacheStats();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        server: "eventflare-mcp",
        version: "1.1.0",
        security: {
          rate_limit: `${RATE_LIMIT}/min`,
          requests_total: stats.total,
          requests_blocked: stats.blocked,
          cache_entries: cacheStats.entries,
        },
      }));
      return;
    }

    // Analytics dashboard
    if (req.url?.startsWith("/dashboard")) {
      const dashKey = process.env.DASHBOARD_KEY;
      if (dashKey) {
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.searchParams.get("key") !== dashKey) {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("Unauthorized. Add ?key=YOUR_DASHBOARD_KEY to the URL.");
          return;
        }
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(getDashboardHtml());
      return;
    }

    // Analytics API (JSON)
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

    // MCP endpoint
    if (req.url?.startsWith("/mcp")) {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks).toString();

        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res, body);
        } else {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => crypto.randomUUID(),
            onsessioninitialized: (id) => {
              transports.set(id, transport);
            },
          });

          transport.onclose = () => {
            const id = [...transports.entries()].find(([_, t]) => t === transport)?.[0];
            if (id) transports.delete(id);
          };

          await server.connect(transport);
          await transport.handleRequest(req, res, body);
        }
        return;
      }

      if (req.method === "GET") {
        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res);
          return;
        }
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No session. Send a POST first." }));
        return;
      }

      if (req.method === "DELETE") {
        if (sessionId && transports.has(sessionId)) {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res);
          transports.delete(sessionId);
          return;
        }
        res.writeHead(404);
        res.end();
        return;
      }
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. MCP endpoint is at /mcp" }));
  });

  httpServer.listen(PORT, () => {
    console.error(`Eventflare MCP server v1.1.0 (HTTP) running on port ${PORT}`);
    console.error(`MCP endpoint: http://localhost:${PORT}/mcp`);
    console.error(`Dashboard:    http://localhost:${PORT}/dashboard`);
    console.error(`Health check: http://localhost:${PORT}/health`);
    console.error(`Rate limit:   ${RATE_LIMIT} req/min per IP`);
  });
} else {
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  console.error("Eventflare MCP server v1.1.0 running on stdio");
}
