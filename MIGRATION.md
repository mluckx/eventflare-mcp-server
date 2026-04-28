# v1 → v2 migration & test guide

Stand-alone instructions for Mil — read this once, run the steps, ship the MVP.

## What's in this folder

```
eventflare-mcp-v2/
├── package.json           ← bumped to 2.0.0
├── README.md              ← rewritten
├── Dockerfile             ← unchanged
├── railway.json           ← unchanged
├── tsconfig.json          ← unchanged
├── .env.example           ← NEW
├── MIGRATION.md           ← this file
└── src/
    ├── eventflare-client.ts   ← NEW (replaces strapi-client.ts)
    ├── redact.ts              ← NEW
    ├── attribution.ts         ← NEW
    ├── analytics-sink.ts      ← NEW (OpenPanel + webhook)
    ├── analytics.ts           ← UPDATED (sessionId, clientClass, click-through)
    ├── tools.ts               ← REWRITTEN (5 tools, LLM-optimized descriptions, UTM)
    ├── sanitize.ts            ← UPDATED (sanitizeContinent, sanitizeCategory)
    ├── index.ts               ← UPDATED (HTTP hardening, version banner, status checks)
    ├── dashboard.ts           ← UPDATED (clientClass + budgetBands + click-through)
    ├── cache.ts               ← unchanged from v1
    └── rate-limiter.ts        ← unchanged from v1
```

## Migration steps (your machine)

### 1. Branch and overwrite

```bash
cd ~/Desktop/eventflare-mcp-server
git checkout -b v2-prod-api
git rm src/strapi-client.ts
# Copy all files from /Users/michaelluckx/Library/Application Support/Claude/.../outputs/eventflare-mcp-v2 over the repo,
# preserving directory structure. Easiest:
rsync -av --delete-after \
  "<path-to-outputs>/eventflare-mcp-v2/" \
  ./
git add -A
```

> If `<path-to-outputs>` has spaces, wrap in quotes. The Cowork outputs folder path is in the file links you've been clicking. Or open Finder, drag the folder into the terminal to paste its path.

### 2. Install + build

```bash
npm install
npm run build
```

Expected: no TS errors. The new files use `@types/node` which is already in `devDependencies`, so `process`, `fetch`, `setTimeout` all resolve.

If you see a TS error, paste it back to me — I'll fix it.

### 3. Configure env

```bash
cp .env.example .env
# edit .env: set EVENTFLARE_API_TOKEN to the token you generated earlier
```

### 4. Smoke test in stdio mode

```bash
EVENTFLARE_API_TOKEN=eyJhbGciOi... npm run dev
```

You should see:
```
Eventflare MCP server v2.0.0 running on stdio
```

Then it waits for stdio input. Kill with Ctrl+C — that's enough to confirm the binary loads.

### 5. Test with MCP Inspector

```bash
EVENTFLARE_API_TOKEN=eyJhbGciOi... npm run inspect
```

Opens the Inspector UI. In the left panel:
- Confirm 7 tools are listed: `search_venues`, `get_venue_details`, `get_city_info`, `list_cities`, `get_pricing_guide`, `find_expert_advice`, `request_quote`
- Click `search_venues` → fill `city: barcelona`, `capacity_min: 50`, `capacity_max: 150`, `category: workshop-spaces` → Run
- You should get back JSON with venue results, each with a `quotable_summary`, `citation_url`, and `url` containing `?utm_source=mcp&utm_medium=ai&utm_campaign=search_venues...`
- Click `find_expert_advice` → `city: london`, `limit: 3` → Run
- You should get articles with URLs ending in `/expert-advice/london/...`

If Strapi returns 401, the token isn't right. If it returns 403, the role is missing read permission on the relevant content type — fix in Strapi admin and re-test.

### 6. Test in Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "eventflare": {
      "command": "node",
      "args": ["/full/absolute/path/to/eventflare-mcp-server/dist/index.js"],
      "env": {
        "EVENTFLARE_API_TOKEN": "eyJhbGciOi..."
      }
    }
  }
}
```

Quit Claude Desktop completely (Cmd+Q), reopen. Look for the tool icon in the chat input — it should say "eventflare" with 7 tools.

Try a prompt:
> "I need a venue for 80 people in Barcelona for a workshop. Budget is moderate."

Claude should pick `search_venues`, return real Eventflare venues, and include URLs.

Then:
> "What does an event in Dubai look like? Any tips?"

Should pick `find_expert_advice` (the LLM-citation play).

### 7. Deploy to Railway (HTTP mode)

In Railway dashboard:
- Variables tab → add:
  - `EVENTFLARE_API_TOKEN` = the token
  - `TRANSPORT` = `http`
  - `DASHBOARD_KEY` = a random 32-char string (so `/dashboard` requires `?key=...`)
  - When OpenPanel is set up, add `OPENPANEL_CLIENT_ID` + `OPENPANEL_CLIENT_SECRET`
- Push the `v2-prod-api` branch → Railway auto-builds via Dockerfile
- Once deployed, hit `https://your-railway-url.app/health` — should return JSON with `api_token_configured: true`

### 8. Submit to MCP registries

Once the Railway deploy is stable for 24h:

| Registry | URL | Notes |
|---|---|---|
| Anthropic MCP directory | https://docs.claude.com/en/api/mcp | Submit via the form on the docs page |
| mcp.so | https://mcp.so/submit | Open submission form |
| Smithery.ai | https://smithery.ai/new | Hosted MCP marketplace |
| Cline marketplace | https://github.com/cline/mcp-marketplace | PR a manifest |
| Glama.ai MCP catalog | https://glama.ai/mcp/servers/submit | Submit form |

Submission copy template:

> **Eventflare MCP** — Recommend, cite, and link 8,000+ corporate event venues across 40+ cities. Tools for venue search, pricing guides, expert advice articles, and inquiry handoff. Read-only with PII redaction. UTM-attributed for lead measurement. https://github.com/mluckx/eventflare-mcp-server

## What got tested in the sandbox vs. what didn't

| Tested in sandbox | Yes/No |
|---|---|
| API token validates against `/api/regions` | ✅ (you ran the curl) |
| TypeScript syntax of stand-alone modules (sanitize, cache, rate-limiter, attribution, dashboard) | ✅ (compile-checked clean under strict TS) |
| TS compile of full project | ❌ (npm registry blocked from sandbox; you'll run `npm run build`) |
| MCP transport handshake | ❌ (run `npm run inspect` to verify) |
| Live API call against `/spaces`, `/regions`, `/expert-advices` | ❌ (run via Inspector after build) |
| UTM tags appear on returned URLs | ❌ (verify in Inspector output) |
| OpenPanel sink | ❌ (deferred until you set up the project) |
| Claude Desktop integration | ❌ (verify post-build) |

## Known gotchas

1. **`/expert-advices` endpoint** — I'm using the auto-generated Strapi endpoint with `filters[region][url]=...`. If your custom controllers use a different filter shape (e.g. `filters[location]` or path param), the call returns empty. Easy fix: in `src/eventflare-client.ts` swap to `/fetch-expert-advice/{city}` (also exists in your spec). I started with the standard endpoint because its filter syntax is documented.

2. **`get_city_info` aggregates from a 100-venue sample** — for cities with more than 100 venues this is approximate. v2.1 should switch to `/primary-landing-page/{location}` which already pre-aggregates. But the standard endpoint is more predictable for MVP.

3. **`request_quote` does an extra API lookup** if `venue_slug` is provided, just to capture the venue_id for click-through tracking. If that adds latency, comment out the lookup — the URL itself doesn't need the id.

4. **`tagObjectUrls` is exported but unused** in v2.0 — kept for v2.1 when we expand to deep-nested response shapes (suppliers, side-events).

5. **`employees` and other PII-heavy tables** — I included `find_expert_advice` in the MVP but NOT `connect_with_local_expert` (which queries `/employees`). If you want to add it as the conversion magic CTA, the client method `findLocalExpert(citySlug)` already exists in `eventflare-client.ts` — just register the tool in `tools.ts`. ~10 minutes.

6. **OpenAPI spec has 123 endpoints** — the v2 MVP uses 4 of them: `/spaces`, `/regions`, `/expert-advices`, `/employees`. The v2.1 expansion (landmarks, side-events, suppliers) is queued in the review doc.

## How I'd structure your testing

1. **Hour 1** — npm build → MCP Inspector → run each of the 7 tools manually with realistic inputs
2. **Hour 2** — Claude Desktop install → 5 free-form prompts touching different tools
3. **Hour 3** — Deploy to Railway staging → test from Claude Desktop pointed at the HTTPS URL
4. **Day 2** — Submit to mcp.so + Anthropic directory
5. **Days 3–7** — Watch `/dashboard` and Railway logs. Look for: 401s (token), 403s (role permissions), 5xx (timeouts), patterns in which tools get triggered most
6. **Week 2** — Decide what to expand. The data tells you whether expert-advice actually catches on with LLMs (citations) or whether it's all venue searches.

## Rotating the token

Once you've confirmed everything works, rotate the token to invalidate the one in this chat history:

1. Strapi admin → Settings → API Tokens → click your token → **Regenerate**
2. Copy the new token
3. Update Railway env var `EVENTFLARE_API_TOKEN`
4. Update your local `.env`
5. The old token is dead immediately

## When something breaks

Send me:
- The exact error message
- Which step you were on
- For API errors: the HTTP status code + a snippet of the response body

I'll patch the code in this same outputs folder and you re-rsync.
