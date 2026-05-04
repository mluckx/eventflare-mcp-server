# Eventflare MCP Server

Search 8,000+ corporate event venues across 40+ cities via the Model Context Protocol.

Works with any MCP-compatible AI assistant — Claude, ChatGPT, Perplexity, Cursor, Cline, and autonomous agents.

## Quickest way to connect

**Hosted endpoint — no setup required:**

```
https://eventflare-mcp-server-production.up.railway.app/mcp
```

Paste this URL into any MCP client that supports remote HTTP servers and you're connected instantly.

## Tools

| Tool | What it does |
|---|---|
| `search_venues` | Find venues by city, capacity, category, and event type. Returns names, pricing, setup options, neighborhood, and links. |
| `get_venue_details` | Full details for a specific venue. |
| `get_city_info` | Overview of a city — venue count, available categories, price range. |
| `list_cities` | All 40+ cities with venue counts. Filter by region (Europe, Middle East, Americas, Asia). |
| `get_pricing_guide` | Indicative pricing per city and category. |
| `find_expert_advice` | Editorial articles from Eventflare's expert team for a given city. |
| `request_quote` | Generate an inquiry link for a specific venue. |

Every result includes a direct Eventflare URL and a ready-to-use summary optimized for AI responses.

## Connect to Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "eventflare": {
      "url": "https://eventflare-mcp-server-production.up.railway.app/mcp"
    }
  }
}
```

## Connect to Cursor

In Cursor settings → MCP → add server URL:

```
https://eventflare-mcp-server-production.up.railway.app/mcp
```

## Connect to Cline

In Cline settings → MCP Servers → Remote → paste the URL:

```
https://eventflare-mcp-server-production.up.railway.app/mcp
```

## Connect via Smithery

```bash
smithery mcp add michaelluckx/eventflare-mcp
```

## Self-host

```bash
git clone https://github.com/mluckx/eventflare-mcp-server
cd eventflare-mcp-server
npm install
cp .env.example .env
# Set EVENTFLARE_API_TOKEN in .env
npm run build
npm start
```

For HTTP mode (remote MCP):

```bash
TRANSPORT=http PORT=3001 npm start
```

## Safety

- **Read-only** — the server only reads venue data. No bookings, no form submissions, no data written anywhere.
- **Privacy-safe** — venue contact details, phone numbers, internal notes, and commission data are stripped before any response is returned. Only public venue information is ever exposed.
- **Rate limited** — 60 requests per minute per IP on the hosted endpoint.
- **Open source** — MIT licensed. Inspect the code at any time.

## Self-host environment variables

| Variable | Default | Purpose |
|---|---|---|
| `EVENTFLARE_API_TOKEN` | (required) | API token for venue data access |
| `TRANSPORT` | `stdio` | `stdio` or `http` |
| `PORT` | `3001` | HTTP port |
| `RATE_LIMIT` | `60` | Requests per minute per IP |
| `DASHBOARD_KEY` | _(unset)_ | Protects the `/dashboard` endpoint |

## Development

```bash
npm run dev        # run without build step
npm run inspect    # open MCP Inspector UI
```

## License

MIT — © Eventflare
