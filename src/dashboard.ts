/**
 * Analytics dashboard — served at /dashboard on the HTTP server.
 * Self-contained HTML with inline CSS + JS. Fetches data from /api/analytics.
 */

export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Eventflare MCP — AI Query Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f1117;
      color: #e1e4e8;
      min-height: 100vh;
    }
    header {
      background: linear-gradient(135deg, #1a1f35 0%, #0d1117 100%);
      border-bottom: 1px solid #21262d;
      padding: 20px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    header h1 {
      font-size: 20px;
      font-weight: 600;
      background: linear-gradient(135deg, #58a6ff, #a371f7);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    header .subtitle { color: #8b949e; font-size: 13px; margin-top: 2px; }
    .refresh-btn {
      background: #21262d;
      border: 1px solid #30363d;
      color: #58a6ff;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
    }
    .refresh-btn:hover { background: #30363d; }
    .container { max-width: 1400px; margin: 0 auto; padding: 24px; }

    /* Stat cards row */
    .stats-row {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 12px;
      padding: 20px;
    }
    .stat-card .label { color: #8b949e; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-card .value { font-size: 36px; font-weight: 700; margin-top: 4px; color: #f0f6fc; }
    .stat-card .sub { color: #8b949e; font-size: 12px; margin-top: 4px; }
    .stat-card.accent .value { color: #58a6ff; }
    .stat-card.green .value { color: #3fb950; }
    .stat-card.purple .value { color: #a371f7; }
    .stat-card.orange .value { color: #d29922; }

    /* Charts grid */
    .charts-grid {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }
    .chart-card {
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 12px;
      padding: 20px;
    }
    .chart-card h3 {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 16px;
      color: #c9d1d9;
    }

    /* Bar chart */
    .bar-row {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
      font-size: 13px;
    }
    .bar-label {
      width: 140px;
      text-align: right;
      padding-right: 12px;
      color: #8b949e;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .bar-track {
      flex: 1;
      height: 24px;
      background: #0d1117;
      border-radius: 4px;
      overflow: hidden;
      position: relative;
    }
    .bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.6s ease;
      min-width: 2px;
    }
    .bar-count {
      width: 50px;
      text-align: right;
      padding-left: 8px;
      color: #e1e4e8;
      font-weight: 500;
    }

    /* Timeline */
    .timeline-chart {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      height: 120px;
      padding-top: 8px;
    }
    .timeline-bar {
      flex: 1;
      background: #58a6ff;
      border-radius: 2px 2px 0 0;
      min-height: 2px;
      transition: height 0.4s ease;
      position: relative;
    }
    .timeline-bar:hover { opacity: 0.8; }
    .timeline-bar .tooltip {
      display: none;
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: #30363d;
      color: #f0f6fc;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      white-space: nowrap;
      z-index: 10;
    }
    .timeline-bar:hover .tooltip { display: block; }

    /* Hourly heatmap */
    .heatmap {
      display: grid;
      grid-template-columns: repeat(24, 1fr);
      gap: 3px;
    }
    .heat-cell {
      aspect-ratio: 1;
      border-radius: 3px;
      position: relative;
    }
    .heat-cell .tooltip {
      display: none;
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%);
      background: #30363d;
      color: #f0f6fc;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      white-space: nowrap;
      z-index: 10;
    }
    .heat-cell:hover .tooltip { display: block; }
    .heat-labels {
      display: grid;
      grid-template-columns: repeat(24, 1fr);
      gap: 3px;
      margin-top: 4px;
    }
    .heat-labels span { font-size: 9px; color: #484f58; text-align: center; }

    /* Tools breakdown */
    .tool-pills {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .tool-pill {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 20px;
      padding: 6px 14px;
      font-size: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .tool-pill .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .tool-pill .count { color: #f0f6fc; font-weight: 600; }

    /* Recent queries table */
    .recent-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .recent-table th {
      text-align: left;
      padding: 8px 12px;
      color: #8b949e;
      font-weight: 500;
      border-bottom: 1px solid #21262d;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .recent-table td {
      padding: 8px 12px;
      border-bottom: 1px solid #161b22;
      color: #c9d1d9;
    }
    .recent-table tr:hover td { background: #1c2128; }
    .tag {
      display: inline-block;
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 11px;
    }

    /* Bottom grid */
    .bottom-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }

    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: #484f58;
    }
    .empty-state .icon { font-size: 48px; margin-bottom: 12px; }
    .empty-state p { font-size: 14px; }

    @media (max-width: 900px) {
      .stats-row { grid-template-columns: repeat(2, 1fr); }
      .charts-grid { grid-template-columns: 1fr; }
      .bottom-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Eventflare MCP Analytics</h1>
      <div class="subtitle">AI Venue Query Intelligence Dashboard</div>
    </div>
    <button class="refresh-btn" onclick="loadData()">Refresh</button>
  </header>

  <div class="container" id="app">
    <div class="empty-state">
      <div class="icon">&#128269;</div>
      <p>Loading analytics data...</p>
    </div>
  </div>

  <script>
    const TOOL_COLORS = {
      search_venues: '#58a6ff',
      get_city_info: '#3fb950',
      list_cities: '#a371f7',
      get_venue_details: '#d29922',
      get_pricing_guide: '#f78166',
      request_quote: '#db61a2',
    };

    async function loadData() {
      try {
        const key = new URLSearchParams(window.location.search).get('key'); const res = await fetch('/api/analytics' + (key ? '?key=' + key : ''));
        const data = await res.json();
        render(data);
      } catch (err) {
        document.getElementById('app').innerHTML =
          '<div class="empty-state"><div class="icon">&#9888;</div><p>Could not load analytics. ' + err.message + '</p></div>';
      }
    }

    function render(d) {
      const app = document.getElementById('app');

      if (d.overview.total === 0) {
        app.innerHTML = \`
          <div class="empty-state" style="margin-top:80px">
            <div class="icon">&#128640;</div>
            <p style="font-size:18px; color:#c9d1d9; margin-bottom:8px">No queries yet</p>
            <p>Once AI assistants start querying your MCP server, data will appear here.</p>
            <p style="margin-top:16px">Test it by connecting Claude Desktop or using the MCP Inspector.</p>
          </div>\`;
        return;
      }

      // Stats row
      let html = \`
        <div class="stats-row">
          <div class="stat-card accent">
            <div class="label">Total Queries</div>
            <div class="value">\${d.overview.total.toLocaleString()}</div>
            <div class="sub">All time</div>
          </div>
          <div class="stat-card green">
            <div class="label">Last 24 Hours</div>
            <div class="value">\${d.overview.last24h.toLocaleString()}</div>
            <div class="sub">queries</div>
          </div>
          <div class="stat-card purple">
            <div class="label">Last 7 Days</div>
            <div class="value">\${d.overview.last7d.toLocaleString()}</div>
            <div class="sub">queries</div>
          </div>
          <div class="stat-card orange">
            <div class="label">Cities Searched</div>
            <div class="value">\${d.topCities.length}</div>
            <div class="sub">unique cities</div>
          </div>
        </div>\`;

      // Timeline + Tools
      html += '<div class="charts-grid">';

      // Timeline chart
      const maxTimeline = Math.max(...d.timeline.map(t => t.count), 1);
      html += '<div class="chart-card"><h3>Queries Over Time (last 30 days)</h3><div class="timeline-chart">';
      for (const t of d.timeline) {
        const h = Math.max((t.count / maxTimeline) * 100, 2);
        html += \`<div class="timeline-bar" style="height:\${h}%"><span class="tooltip">\${t.date}: \${t.count} queries</span></div>\`;
      }
      html += '</div></div>';

      // Tool breakdown
      html += '<div class="chart-card"><h3>By Tool</h3><div class="tool-pills">';
      for (const [tool, count] of Object.entries(d.byTool).sort((a,b) => b[1] - a[1])) {
        const color = TOOL_COLORS[tool] || '#8b949e';
        html += \`<div class="tool-pill"><span class="dot" style="background:\${color}"></span>\${tool} <span class="count">\${count}</span></div>\`;
      }
      html += '</div>';

      // Hourly heatmap
      const maxHour = Math.max(...d.hourly, 1);
      html += '<h3 style="margin-top:20px">Query Hours (UTC)</h3><div class="heatmap">';
      for (let h = 0; h < 24; h++) {
        const intensity = d.hourly[h] / maxHour;
        const bg = intensity === 0 ? '#0d1117'
          : intensity < 0.25 ? '#0e4429'
          : intensity < 0.5 ? '#006d32'
          : intensity < 0.75 ? '#26a641'
          : '#3fb950';
        html += \`<div class="heat-cell" style="background:\${bg}"><span class="tooltip">\${h}:00 — \${d.hourly[h]} queries</span></div>\`;
      }
      html += '</div><div class="heat-labels">';
      for (let h = 0; h < 24; h++) html += \`<span>\${h}</span>\`;
      html += '</div></div></div>';

      // Bottom grid: cities, event types, capacity
      html += '<div class="bottom-grid">';

      // Top cities
      const maxCity = d.topCities[0]?.count || 1;
      html += '<div class="chart-card"><h3>Top Cities</h3>';
      for (const c of d.topCities.slice(0, 10)) {
        const w = (c.count / maxCity) * 100;
        html += \`<div class="bar-row"><div class="bar-label">\${c.city}</div><div class="bar-track"><div class="bar-fill" style="width:\${w}%;background:#58a6ff"></div></div><div class="bar-count">\${c.count}</div></div>\`;
      }
      html += '</div>';

      // Top event types
      const maxEv = d.topEventTypes[0]?.count || 1;
      html += '<div class="chart-card"><h3>Event Types</h3>';
      if (d.topEventTypes.length === 0) {
        html += '<p style="color:#484f58;font-size:13px">No event type filters used yet</p>';
      }
      for (const e of d.topEventTypes.slice(0, 10)) {
        const w = (e.count / maxEv) * 100;
        html += \`<div class="bar-row"><div class="bar-label">\${e.eventType}</div><div class="bar-track"><div class="bar-fill" style="width:\${w}%;background:#a371f7"></div></div><div class="bar-count">\${e.count}</div></div>\`;
      }
      html += '</div>';

      // Capacity distribution
      html += '<div class="chart-card"><h3>Capacity Requests</h3>';
      const maxCap = Math.max(...Object.values(d.capacityBuckets), 1);
      for (const [bucket, count] of Object.entries(d.capacityBuckets)) {
        const w = (count / maxCap) * 100;
        html += \`<div class="bar-row"><div class="bar-label">\${bucket} ppl</div><div class="bar-track"><div class="bar-fill" style="width:\${w}%;background:#d29922"></div></div><div class="bar-count">\${count}</div></div>\`;
      }
      html += '</div></div>';

      // Recent queries table
      html += '<div class="chart-card"><h3>Recent Queries</h3>';
      html += '<table class="recent-table"><thead><tr><th>Time</th><th>Tool</th><th>City</th><th>Event Type</th><th>Capacity</th><th>Results</th></tr></thead><tbody>';
      for (const q of d.recentQueries.slice(0, 25)) {
        const time = new Date(q.timestamp).toLocaleString();
        const color = TOOL_COLORS[q.tool] || '#8b949e';
        html += \`<tr>
          <td>\${time}</td>
          <td><span class="tag" style="border-color:\${color}">\${q.tool}</span></td>
          <td>\${q.city || '—'}</td>
          <td>\${q.eventType || q.category || '—'}</td>
          <td>\${q.capacity || '—'}</td>
          <td>\${q.resultCount ?? '—'}</td>
        </tr>\`;
      }
      html += '</tbody></table></div>';

      app.innerHTML = html;
    }

    loadData();
    // Auto-refresh every 30 seconds
    setInterval(loadData, 30000);
  </script>
</body>
</html>`;
}
