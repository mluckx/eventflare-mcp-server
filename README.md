# Eventflare MCP Server

Makes Eventflare venue data queryable by AI assistants (Claude, ChatGPT, Perplexity) via the Model Context Protocol.

## Quick Start

```bash
npm install
npm run build
npm start          # stdio mode (Claude Desktop)
```

For HTTP mode (remote access):
```bash
TRANSPORT=http PORT=3001 npm start
```

## Tools

| Tool | What it does |
|------|-------------|
| `search_venues` | Search venues by city, capacity, category, event type |
| `get_city_info` | Venue count, categories, price ranges for a city |
| `list_cities` | All 40+ cities with URLs |
| `get_venue_details` | Full venue details + photos |
| `get_pricing_guide` | Budget guidance by city/category |
| `request_quote` | Generate inquiry URL |

## Connect to Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "eventflare": {
      "command": "node",
      "args": ["/path/to/eventflare-mcp-server/dist/index.js"]
    }
  }
}
```

## Connect to Claude Code

```bash
claude mcp add eventflare node /path/to/eventflare-mcp-server/dist/index.js
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STRAPI_API_URL` | `https://dev-content.eventflare.io/api` | Strapi API base URL |
| `EVENTFLARE_URL` | `https://eventflare.io` | Website URL for generated links |
| `TRANSPORT` | `stdio` | `stdio` or `http` |
| `PORT` | `3001` | HTTP server port |
| `ANALYTICS_LOG` | `./analytics.jsonl` | Query log file path |

## Development

```bash
npm run dev        # run with tsx (no build needed)
npm run inspect    # open MCP Inspector UI
```

## Deploy as Remote Server

When using `TRANSPORT=http`, the MCP endpoint is at `/mcp`. Add CORS headers are included.
Point AI clients to: `https://your-domain.com/mcp`

## Analytics

Every query is logged to `analytics.jsonl` with: timestamp, tool name, city, capacity, event type, result count. No PII.
