/**
 * Self-contained HTML dashboard for MCP analytics.
 * Served at /dashboard — no external dependencies.
 * Auto-refreshes every 30 seconds.
 *
 * v2 changes:
 *   - Accepts version param (rendered in subtitle)
 *   - Renders byClient breakdown (Claude / ChatGPT / Perplexity / etc.)
 *   - Renders budgetBands, clickThroughRate
 *   - Fixed type cast in tool-sort comparator (was TS-syntax-in-JS bug)
 */

export function getDashboardHtml(version: string = "2.0.0"): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Eventflare MCP — Analytics Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #e2e8f0; padding: 24px; }
  h1 { font-size: 24px; margin-bottom: 4px; color: #f8fafc; }
  .subtitle { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .card { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; }
  .card-label { font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; }
  .card-value { font-size: 32px; font-weight: 700; color: #f8fafc; margin-top: 4px; }
  .card-sub { font-size: 12px; color: #64748b; margin-top: 2px; }
  .section { background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155; margin-bottom: 16px; }
  .section-title { font-size: 14px; font-weight: 600; color: #cbd5e1; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .pills { display: flex; flex-wrap: wrap; gap: 8px; }
  .pill { background: #334155; border-radius: 20px; padding: 6px 14px; font-size: 13px; color: #cbd5e1; }
  .pill span { color: #60a5fa; font-weight: 600; margin-left: 6px; }
  .bar-row { display: flex; align-items: center; margin-bottom: 8px; }
  .bar-label { width: 140px; font-size: 13px; color: #94a3b8; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-track { flex: 1; height: 24px; background: #0f172a; border-radius: 4px; overflow: hidden; margin: 0 10px; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, #3b82f6, #60a5fa); border-radius: 4px; transition: width 0.3s; min-width: 2px; }
  .bar-count { width: 40px; text-align: right; font-size: 13px; color: #64748b; flex-shrink: 0; }
  .heatmap { display: grid; grid-template-columns: repeat(24, 1fr); gap: 3px; }
  .heat-cell { aspect-ratio: 1; border-radius: 3px; position: relative; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; padding: 8px 12px; color: #64748b; border-bottom: 1px solid #334155; font-weight: 500; }
  td { padding: 8px 12px; border-bottom: 1px solid #1e293b; color: #cbd5e1; }
  tr:hover td { background: #1e293b; }
  .timeline { display: flex; align-items: flex-end; gap: 2px; height: 80px; }
  .timeline-bar { flex: 1; background: #3b82f6; border-radius: 2px 2px 0 0; min-height: 2px; position: relative; }
  .loading { text-align: center; padding: 40px; color: #64748b; }
  .refresh-note { text-align: center; font-size: 11px; color: #475569; margin-top: 16px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 768px) { .two-col { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<h1>Eventflare MCP Dashboard</h1>
<p class="subtitle">Real-time analytics for AI venue queries — v${version}</p>
<div id="app"><div class="loading">Loading analytics...</div></div>
<p class="refresh-note">Auto-refreshes every 30 seconds</p>

<script>
const key = new URLSearchParams(window.location.search).get('key');
const apiUrl = '/api/analytics' + (key ? '?key=' + encodeURIComponent(key) : '');

async function load() {
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error('API error ' + res.status);
    const d = await res.json();
    render(d);
  } catch (e) {
    document.getElementById('app').innerHTML = '<div class="loading">Error loading data: ' + e.message + '</div>';
  }
}

function render(d) {
  const uniqueCities = d.topCities ? d.topCities.length : 0;
  const tools = d.byTool || {};
  const clients = d.byClient || {};

  let html = '<div class="grid">';
  html += statCard('Total Queries', d.total, 'All time');
  html += statCard('Last 24h', d.last24h, 'Today');
  html += statCard('Last 7 Days', d.last7d, 'This week');
  html += statCard('Cities Queried', uniqueCities, 'Unique cities');
  html += statCard('Click-through Rate', (d.clickThroughRate || 0) + '%', 'search → detail/quote');
  html += '</div>';

  if (d.dailyTimeline && d.dailyTimeline.length > 0) {
    const maxDay = Math.max(...d.dailyTimeline.map(t => t.count), 1);
    html += '<div class="section"><div class="section-title">Daily Timeline</div><div class="timeline">';
    for (const t of d.dailyTimeline) {
      const h = Math.max(2, (t.count / maxDay) * 100);
      html += '<div class="timeline-bar" style="height:' + h + '%" title="' + t.date + ': ' + t.count + ' queries"></div>';
    }
    html += '</div></div>';
  }

  html += '<div class="section"><div class="section-title">Queries by Tool</div><div class="pills">';
  for (const [tool, count] of Object.entries(tools).sort((a, b) => b[1] - a[1])) {
    html += '<div class="pill">' + tool + '<span>' + count + '</span></div>';
  }
  html += '</div></div>';

  if (Object.keys(clients).length > 0) {
    html += '<div class="section"><div class="section-title">Queries by Client</div><div class="pills">';
    for (const [client, count] of Object.entries(clients).sort((a, b) => b[1] - a[1])) {
      html += '<div class="pill">' + client + '<span>' + count + '</span></div>';
    }
    html += '</div></div>';
  }

  if (d.hourlyDistribution) {
    const maxH = Math.max(...d.hourlyDistribution.map(h => h.count), 1);
    html += '<div class="section"><div class="section-title">Queries by Hour (UTC)</div><div class="heatmap">';
    for (const h of d.hourlyDistribution) {
      const intensity = h.count / maxH;
      const bg = intensity === 0 ? '#1e293b' : 'rgba(59,130,246,' + (0.2 + intensity * 0.8).toFixed(2) + ')';
      html += '<div class="heat-cell" style="background:' + bg + '" title="' + h.hour + ':00 — ' + h.count + ' queries"></div>';
    }
    html += '</div></div>';
  }

  html += '<div class="two-col">';
  if (d.topCities && d.topCities.length > 0) {
    const maxC = d.topCities[0].count;
    html += '<div class="section"><div class="section-title">Top Cities</div>';
    for (const c of d.topCities.slice(0, 10)) {
      html += barRow(c.city, c.count, maxC);
    }
    html += '</div>';
  }
  if (d.topEventTypes && d.topEventTypes.length > 0) {
    const maxE = d.topEventTypes[0].count;
    html += '<div class="section"><div class="section-title">Top Event Types</div>';
    for (const e of d.topEventTypes.slice(0, 10)) {
      html += barRow(e.eventType, e.count, maxE);
    }
    html += '</div>';
  } else {
    html += '<div class="section"><div class="section-title">Top Event Types</div><div style="color:#64748b;font-size:13px">No event type data yet</div></div>';
  }
  html += '</div>';

  if (d.budgetBands && d.budgetBands.length > 0) {
    const maxB = d.budgetBands[0].count;
    html += '<div class="section"><div class="section-title">Budget Bands (by capacity)</div>';
    for (const b of d.budgetBands) {
      html += barRow(b.band, b.count, maxB);
    }
    html += '</div>';
  }

  if (d.capacityDistribution) {
    const maxCap = Math.max(...d.capacityDistribution.map(b => b.count), 1);
    html += '<div class="section"><div class="section-title">Capacity Distribution</div>';
    for (const b of d.capacityDistribution) {
      html += barRow(b.range + ' pax', b.count, maxCap);
    }
    html += '</div>';
  }

  if (d.recentQueries && d.recentQueries.length > 0) {
    html += '<div class="section"><div class="section-title">Recent Queries</div>';
    html += '<table><thead><tr><th>Time</th><th>Tool</th><th>Client</th><th>City</th><th>Capacity</th><th>Event</th><th>Results</th></tr></thead><tbody>';
    for (const q of d.recentQueries) {
      const time = new Date(q.timestamp).toLocaleString();
      html += '<tr><td>' + time + '</td><td>' + (q.tool || '') + '</td><td>' + (q.clientClass || '-') + '</td><td>' + (q.city || '-') + '</td><td>' + (q.capacity || '-') + '</td><td>' + (q.eventType || '-') + '</td><td>' + (q.resultCount ?? '-') + '</td></tr>';
    }
    html += '</tbody></table></div>';
  }

  document.getElementById('app').innerHTML = html;
}

function statCard(label, value, sub) {
  return '<div class="card"><div class="card-label">' + label + '</div><div class="card-value">' + (value || 0) + '</div><div class="card-sub">' + sub + '</div></div>';
}

function barRow(label, count, max) {
  const pct = max > 0 ? (count / max * 100).toFixed(1) : 0;
  return '<div class="bar-row"><div class="bar-label">' + label + '</div><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div><div class="bar-count">' + count + '</div></div>';
}

load();
setInterval(load, 30000);
</script>
</body>
</html>`;
}
