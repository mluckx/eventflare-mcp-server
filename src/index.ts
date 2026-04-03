/**
 * Eventflare MCP Server
 *
 * Makes Eventflare venue data queryable by AI assistants (Claude, ChatGPT, etc.)
 * via the Model Context Protocol (MCP).
 *
 * Supports two transports:
 *   - stdio  (default) — for Claude Desktop, Claude Code, Cursor
 *   - http   — for remote access via Streamable HTTP
 *
 * Usage:
 *   TRANSPORT=stdio  node dist/index.js     # local AI tool
 *   TRANSPORT=http   node dist/index.js     # remote server
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { getAnalyticsSummary } from "./analytics.js";
import { getDashboardHtml } from "./dashboard.js";

const server = new McpServer({
  name: "eventflare",
  version: "1.0.0",
});

// Register all 6 tools
registerTools(server);

// ---------- Transport ----------

const transport = process.env.TRANSPORT || "stdio";

if (transport === "http") {
  // Streamable HTTP transport — for remote deployment
  // Requires Express or similar HTTP server wrapper
  const { StreamableHTTPServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/streamableHttp.js"
  );

  const { createServer } = await import("node:http");
  const PORT = parseInt(process.env.PORT || "3001");

  // Store transports for session management
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

    // Health check
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: "eventflare-mcp", version: "1.0.0" }));
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
    if (req.url === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (req.method === "POST") {
        // Read request body
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks).toString();

        if (sessionId && transports.has(sessionId)) {
          // Existing session
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res, body);
        } else {
          // New session
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
        // SSE stream for server-initiated messages
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

    // 404 for everything else
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. MCP endpoint is at /mcp" }));
  });

  httpServer.listen(PORT, () => {
    console.error(`Eventflare MCP server (HTTP) running on port ${PORT}`);
    console.error(`MCP endpoint: http://localhost:${PORT}/mcp`);
    console.error(`Dashboard:    http://localhost:${PORT}/dashboard`);
    console.error(`Health check: http://localhost:${PORT}/health`);
  });
} else {
  // stdio transport — default for Claude Desktop / Claude Code
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  console.error("Eventflare MCP server running on stdio");
}
