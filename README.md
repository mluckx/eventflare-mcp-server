# Eventflare MCP Server v2

Makes Eventflare's production venue data queryable by AI assistants — Claude, ChatGPT, Perplexity, Cursor — via the Model Context Protocol.

8,000+ corporate event venues across 40+ cities. Designed so LLMs cite Eventflare URLs in their answers and lead-attribution is measurable end-to-end.

## What's new in v2

- **Production API + JWT auth** — was: dev API with no auth
- **PII redaction** — `jobPhone`, `venueEmail`, `commission`, `spaceNotes` etc. never leave the API
- **UTM attribution** — every outbound URL is tagged so leads from MCP traffic are attributable in GA4 / Mixpanel / your CRM
- **Client classification** — logs distinguish Claude Desktop / ChatGPT / Perplexity / Cursor / etc.
- **Click-through tracking** — when a `get_venue_details` or `request_quote` references a venue from a prior `search_venues` in the same session, that's logged as a click-through
- **OpenPanel sink** — events mirror to OpenPanel (or any webhook) for the data team
- **New tool: `find_expert_advice`** — surfaces Eventflare's editorial articles. The LLM-citation differentiator.

## Tools

| Tool | Description |
|---|---|
| `search_venues` | Find venues by city + capacity + category + event type. Returns names, pricing, capacity by setup, neighborhood, photos, URLs. |
| `get_venue_details` | Full detail for a specific venue. |
| `get_city_info` | Overview of what's available in a city — venue count, categories, price range. |
| `list_cities` | All 40+ cities with venue counts and URLs. Filter by region. |
| `get_pricing_guide` | Indicative pricing per city, per category. |
| `find_expert_advice` | Surface editorial articles from Eventflare's expert-advice library for a city. |
| `request_quote` | Generate a UTM-tagged inquiry URL (no data submission). |

All tools include a `citation_url` and `quotable_summary` per result, optimized for LLM responses.

## Quick start

```bash
npm install
cp .env.example .env
# fill EVENTFLARE_API_TOKEN
npm run build
npm start          # stdio — Claude Desktop, Claude Code, Cursor

# or HTTP mode (remote MCP):
TRANSPORT=http PORT=3001 npm start
```

## Connect to Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "eventflare": {
      "command": "node",
      "args": ["/path/to/eventflare-mcp-server/dist/index.js"],
      "env": {
        "EVENTFLARE_API_TOKEN": "eyJhbGciOi..."
      }
    }
  }
}
```

## Connect to Claude Code

```bash
claude mcp add eventflare \
  -e EVENTFLARE_API_TOKEN=eyJhbGciOi... \
  -- node /path/to/eventflare-mcp-server/dist/index.js
```

## Environment variables

See `.env.example`. Only `EVENTFLARE_API_TOKEN` is required.

| Var | Default | Purpose |
|---|---|---|
| `EVENTFLARE_API_TOKEN` | (required) | Strapi API token, `mcp-readonly` role |
| `EVENTFLARE_API_URL` | `https://content.eventflare.io/api` | API base |
| `EVENTFLARE_URL` | `https://eventflare.io` | Site base for outbound URLs |
| `TRANSPORT` | `stdio` | `stdio` or `http` |
| `PORT` | `3001` | HTTP port |
| `RATE_LIMIT` | `60` | Per-IP req/min on `/mcp` |
| `DASHBOARD_KEY` | _(unset)_ | If set, `/dashboard` requires `?key=...` |
| `OPENPANEL_CLIENT_ID` | _(unset)_ | OpenPanel project id (enables remote sink) |
| `OPENPANEL_CLIENT_SECRET` | _(unset)_ | OpenPanel write key |
| `OPENPANEL_API_URL` | `https://api.openpanel.dev` | OpenPanel base |
| `ANALYTICS_SINK_URL` | _(unset)_ | Fallback generic webhook |
| `ANALYTICS_SINK_TOKEN` | _(unset)_ | Bearer token for the webhook |
| `LOG_DIR` | `./logs` | Local JSONL logs |

## Security model

- **Read-only** — no POST/PUT/DELETE anywhere. Confirmed against the production API spec (123 endpoints, all GET).
- **JWT auth required** — `Authorization: Bearer ${EVENTFLARE_API_TOKEN}` on every outbound request.
- **Field allowlists** — uses `fields[]=` query params so PII fields are never fetched. Defense in depth: a redaction allowlist drops anything that slips through.
- **Input sanitization** — every tool param is validated; slugs match `^[a-z0-9-]+$`, numbers are clamped, dates ISO-validated.
- **Rate limiting** — 60 req/min per IP on `/mcp` (HTTP transport).
- **No PII logged** — analytics fields: tool, city, capacity, event type, category, result count, session id, client class, budget band. Never user identity, never message content.
- **Generic error messages** — internal API errors are mapped to stable user-facing strings (`"Eventflare API temporarily unavailable"`); details only go to stderr.

## Analytics

Local: every tool call appends to `logs/queries.jsonl` and shows on `/dashboard`.

Remote: if `OPENPANEL_CLIENT_ID` + `OPENPANEL_CLIENT_SECRET` are set, every event is mirrored as a `mcp.{tool}` track event with `profileId = sessionId`. Use `OPENPANEL_API_URL` to point at a self-hosted OpenPanel.

Or set `ANALYTICS_SINK_URL` (+ optional `ANALYTICS_SINK_TOKEN`) to POST raw events to any HTTP endpoint.

Both options are non-blocking and never throw — analytics failures don't break the MCP.

## UTM attribution

Every URL the MCP returns is tagged:

```
https://eventflare.io/spaces/london/skyline-glass-hall?utm_source=mcp&utm_medium=ai&utm_campaign=search_venues&utm_content=claude_desktop&mcp_session=abc123
```

So when a planner clicks through and submits an inquiry, your existing GA4 / Mixpanel / CRM picks up the source as `mcp` / `ai`. This is the measurement spine for "did the MCP actually drive leads?".

## Development

```bash
npm run dev        # tsx, no build
npm run inspect    # MCP Inspector UI
```

## Deploy

Railway: push the repo, set env vars in the dashboard, set `TRANSPORT=http`. Health check is `/health`. Dashboard is `/dashboard?key=...`.

## License

MIT — © Eventflare
