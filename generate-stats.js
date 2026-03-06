// generate-stats.js
// Run by GitHub Actions — outputs stats.svg with real data

const fs = require("fs");

const USERNAME = process.env.USERNAME || "y-lukashevskyi";
const TOKEN = process.env.GITHUB_TOKEN || "";

// ── TARGETS (commits to hit 100%) ──────────────────────────
const TARGETS = {
  week: 35, // commits/week target
  month: 150, // commits/month target
  year: 1500, // commits/year target
  allTime: 3000, // all-time target
};
// ────────────────────────────────────────────────────────────

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `bearer ${TOKEN}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json;
}

function startOf(unit) {
  const now = new Date();
  if (unit === "week") {
    const d = new Date(now);
    d.setDate(now.getDate() - now.getDay());
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (unit === "month")
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  if (unit === "year") return new Date(now.getFullYear(), 0, 1).toISOString();
}

const CREATED_QUERY = `query($login:String!){user(login:$login){createdAt}}`;
const QUERY = `
  query($login: String!, $from: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from) {
        totalCommitContributions
        restrictedContributionsCount
      }
    }
  }
`;

function extract(data) {
  const c = data?.data?.user?.contributionsCollection;
  if (!c) return { commits: 0 };
  return {
    commits:
      (c.totalCommitContributions || 0) + (c.restrictedContributionsCount || 0),
  };
}

// Mission rating based on % of target achieved
function missionRating(commits, target) {
  const pct = Math.min((commits / target) * 100, 100);
  if (pct >= 100) return { label: "GALLANTRY BEYOND MEASURE", tier: 5 };
  if (pct >= 80) return { label: "SUPERIOR VALOUR", tier: 4 };
  if (pct >= 60) return { label: "HONORABLE DUTY", tier: 3 };
  if (pct >= 40) return { label: "UNREMARKABLE PERFORMANCE", tier: 2 };
  if (pct >= 20) return { label: "DISAPPOINTING SERVICE", tier: 1 };
  return { label: "DISGRACEFUL CONDUCT", tier: 0 };
}

function tierColor(tier) {
  return ["#884422", "#aa6622", "#c8a830", "#d4b840", "#e8c84a", "#fff0a0"][
    tier
  ];
}

async function fetchStats() {
  const createdData = await gql(CREATED_QUERY, { login: USERNAME });
  const createdYear =
    new Date(createdData?.data?.user?.createdAt).getFullYear() || 2019;

  const [yw, ym, yy, ya] = await Promise.all([
    gql(QUERY, { login: USERNAME, from: startOf("week") }),
    gql(QUERY, { login: USERNAME, from: startOf("month") }),
    gql(QUERY, { login: USERNAME, from: startOf("year") }),
    gql(QUERY, {
      login: USERNAME,
      from: new Date(createdYear, 0, 1).toISOString(),
    }),
  ]);

  return {
    week: extract(yw),
    month: extract(ym),
    year: extract(yy),
    allTime: extract(ya),
  };
}

// Bar width px given commits vs target, max 128px
function barW(commits, target, max = 128) {
  return Math.max(2, Math.min(Math.round((commits / target) * max), max));
}

function starRow(tier, x, y, size = 11) {
  let out = "";
  for (let i = 0; i < 5; i++) {
    const filled = i < tier;
    out += `<polygon points="${starPoints(x + i * (size + 3), y, size / 2)}"
      fill="${filled ? "#e8c84a" : "none"}"
      stroke="#e8c84a" stroke-width="1" opacity="${filled ? 1 : 0.3}"/>`;
  }
  return out;
}

function starPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const outerAngle = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    const innerAngle = outerAngle + Math.PI / 5;
    pts.push(
      `${(cx + Math.cos(outerAngle) * r).toFixed(2)},${(cy + Math.sin(outerAngle) * r).toFixed(2)}`,
    );
    pts.push(
      `${(cx + Math.cos(innerAngle) * (r * 0.42)).toFixed(2)},${(cy + Math.sin(innerAngle) * (r * 0.42)).toFixed(2)}`,
    );
  }
  return pts.join(" ");
}

// Stat panel SVG block
function panel(cx, cy, w, label, commits, target, animDelay, allTime = false) {
  const x = cx - w / 2;
  const pct = Math.min((commits / target) * 100, 100);
  const bw = barW(commits, target, w - 16);
  const mr = missionRating(commits, target);
  const col = tierColor(mr.tier);
  const numSize = allTime ? 30 : 34;

  return `
  <!-- panel: ${label} -->
  <g>
    <!-- eagle bg, centered in panel -->
    <g transform="translate(${cx - 52}, ${cy - 28}) scale(1.04)" opacity=".07">
      <path d="M50,8 L32,26 L10,20 L28,33 L18,52 L50,36 L82,52 L72,33 L90,20 L68,26 Z" fill="#e8c84a"/>
      <circle cx="50" cy="22" r="9" fill="#e8c84a"/>
      <circle cx="50" cy="22" r="4" fill="#0a0c08"/>
    </g>

    <text class="mono lbl" x="${cx}" y="${cy - 54}" text-anchor="middle">◈ ${label} ◈</text>

    <!-- commit number -->
    <text class="hd" x="${cx}" y="${cy + 6}" text-anchor="middle"
      font-size="${numSize}" fill="${allTime ? "#ffdd66" : "#e8c84a"}"
      filter="url(#${allTime ? "brightglow" : "goldglow"})">${commits.toLocaleString()}</text>

    <text class="mono sub" x="${cx}" y="${cy + 20}" text-anchor="middle" fill="#6a7a3a">COMMITS DEPLOYED</text>

    <!-- mission rating label -->
    <text class="mono" x="${cx}" y="${cy + 36}" text-anchor="middle"
      font-size="7.5" fill="${col}" letter-spacing=".1em">${mr.label}</text>

    <!-- stars -->
    ${starRow(mr.tier, cx - (5 * 14) / 2 + 1, cy + 52, 11)}

    <!-- progress bar -->
    <rect x="${x + 8}" y="${cy + 62}" width="${w - 16}" height="6" rx="1" fill="#181d0e"/>
    <rect x="${x + 8}" y="${cy + 62}" width="0" height="6" rx="1"
      fill="${allTime ? "url(#barAll)" : "url(#barGrad)"}">
      <animate attributeName="width" from="0" to="${bw}" dur=".8s"
        begin="${animDelay}s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1"/>
    </rect>
    <!-- tick marks -->
    <line x1="${x + 8 + (w - 16) * 0.25}" y1="${cy + 62}" x2="${x + 8 + (w - 16) * 0.25}" y2="${cy + 68}" stroke="#0a0c08" stroke-width="1.5"/>
    <line x1="${x + 8 + (w - 16) * 0.5}" y1="${cy + 62}" x2="${x + 8 + (w - 16) * 0.5}" y2="${cy + 68}" stroke="#0a0c08" stroke-width="1.5"/>
    <line x1="${x + 8 + (w - 16) * 0.75}" y1="${cy + 62}" x2="${x + 8 + (w - 16) * 0.75}" y2="${cy + 68}" stroke="#0a0c08" stroke-width="1.5"/>
    <text class="mono dim" x="${x + 8}"     y="${cy + 80}">0</text>
    <text class="mono dim" x="${x + w - 8}" y="${cy + 80}" text-anchor="end">TGT:${target.toLocaleString()}</text>
    <text class="mono dim" x="${cx}"         y="${cy + 80}" text-anchor="middle">${pct.toFixed(0)}%</text>
  </g>`;
}

function makeSVG({ week, month, year, allTime }) {
  const updated = new Date().toUTCString().slice(0, 16);
  const panelW = 158;
  const panelCY = 158; // vertical center of stat area

  // Column centers
  const c1 = 89,
    c2 = 269,
    c3 = 449,
    c4 = 629;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="300" viewBox="0 0 720 300">
<defs>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&amp;family=Share+Tech+Mono&amp;display=swap');
    .bg    { fill: #0a0c08 }
    .hd    { font-family: 'Barlow Condensed', sans-serif; font-weight: 900 }
    .mono  { font-family: 'Share Tech Mono', monospace }
    .title { font-size: 21px; fill: #e8c84a; letter-spacing: .1em }
    .rank  { font-size: 9px; fill: #c8a830; letter-spacing: .26em }
    .sub   { font-size: 8px; fill: #6a7a3a; letter-spacing: .2em }
    .lbl   { font-size: 9px; fill: #a8b878; letter-spacing: .15em }
    .dim   { font-size: 7px; fill: #3a4a1a; letter-spacing: .13em }
    @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:.4} }
    @keyframes scanln { 0%{transform:translateY(-45px)} 100%{transform:translateY(345px)} }
    @keyframes fadeUp { from{opacity:0;transform:translateY(7px)} to{opacity:1;transform:translateY(0)} }
    @keyframes blink  { 0%,49%{opacity:1} 50%,100%{opacity:0} }
    @keyframes shine  { 0%,100%{opacity:.65} 50%{opacity:1} }
    .pulse  { animation: pulse  2s ease-in-out infinite }
    .scanln { animation: scanln 5s linear infinite; opacity:.02 }
    .shine  { animation: shine  3s ease-in-out infinite }
    .fu1 { animation: fadeUp .5s ease forwards; opacity:0; animation-delay:.05s }
    .fu2 { animation: fadeUp .5s ease forwards; opacity:0; animation-delay:.2s }
    .fu3 { animation: fadeUp .5s ease forwards; opacity:0; animation-delay:.35s }
    .fu4 { animation: fadeUp .5s ease forwards; opacity:0; animation-delay:.5s }
    .fu5 { animation: fadeUp .5s ease forwards; opacity:0; animation-delay:.65s }
    .fu6 { animation: fadeUp .5s ease forwards; opacity:0; animation-delay:.8s }
    .blink { animation: blink 1.1s step-end infinite }
  </style>
  <clipPath id="cc"><rect width="720" height="300" rx="3"/></clipPath>
  <filter id="goldglow">
    <feGaussianBlur stdDeviation="2.5" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="brightglow">
    <feGaussianBlur stdDeviation="4" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="softglow">
    <feGaussianBlur stdDeviation="7" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <pattern id="hatch" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="8" stroke="#e8c84a" stroke-width=".5" opacity=".05"/>
  </pattern>
  <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%"   stop-color="#4a5a20"/>
    <stop offset="55%"  stop-color="#c8a830"/>
    <stop offset="100%" stop-color="#e8c84a"/>
  </linearGradient>
  <linearGradient id="barAll" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%"   stop-color="#6a5010"/>
    <stop offset="55%"  stop-color="#d4a830"/>
    <stop offset="100%" stop-color="#ffdd66"/>
  </linearGradient>
  <symbol id="star" viewBox="0 0 20 20">
    <polygon points="10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7" fill="#e8c84a"/>
  </symbol>
</defs>

<g clip-path="url(#cc)">
  <!-- BG -->
  <rect class="bg" width="720" height="300"/>
  <rect width="720" height="300" fill="url(#hatch)"/>
  <rect width="720" height="300" fill="#182008" opacity=".08"/>
  <rect class="scanln" width="720" height="42" fill="white"/>

  <!-- borders -->
  <rect x="1" y="1" width="718" height="298" rx="2" fill="none" stroke="#e8c84a" stroke-width="1.5" opacity=".5"/>
  <rect x="5" y="5" width="710" height="290" rx="1" fill="none" stroke="#4a5a2a" stroke-width=".7"/>
  <rect x="8" y="8" width="704" height="284" rx="1" fill="none" stroke="#2a3a1a" stroke-width=".4"/>

  <!-- corner marks -->
  <g fill="#e8c84a">
    <rect x="1"   y="1"   width="28" height="3"/> <rect x="1"   y="1"   width="3" height="28"/>
    <rect x="691" y="1"   width="28" height="3"/> <rect x="717" y="1"   width="3" height="28"/>
    <rect x="1"   y="296" width="28" height="3"/> <rect x="1"   y="270" width="3" height="29"/>
    <rect x="691" y="296" width="28" height="3"/> <rect x="717" y="270" width="3" height="29"/>
  </g>

  <!-- HEADER -->
  <g class="fu1">
    <text class="mono sub" x="14" y="22">▶ SUPER EARTH HIGH COMMAND — CLASSIFIED DEPLOYMENT METRICS</text>
    <text class="hd title" x="14" y="48" filter="url(#goldglow)">HELLDIVER COMMIT REPORT</text>
    <rect x="14" y="53" width="318" height="15" fill="#e8c84a" opacity=".07"/>
    <rect x="14" y="53" width="3"   height="15" fill="#e8c84a"/>
    <use href="#star" x="18" y="54" width="12" height="12"/>
    <use href="#star" x="32" y="54" width="12" height="12"/>
    <use href="#star" x="46" y="54" width="12" height="12"/>
    <use href="#star" x="60" y="54" width="12" height="12"/>
    <use href="#star" x="74" y="54" width="12" height="12"/>
    <text class="mono rank shine" x="92" y="64">HIGH COMMAND GENERAL · Y-LUKASHEVSKYI</text>
  </g>

  <!-- live dot -->
  <g class="fu1">
    <circle class="pulse" cx="692" cy="25" r="4" fill="#4aaa4a" filter="url(#softglow)"/>
    <text class="mono dim" x="700" y="21" fill="#4a8a4a">LIVE</text>
    <text class="mono dim" x="700" y="31" fill="#3a4a1a">FEED</text>
  </g>

  <!-- classified stamp -->
  <g transform="translate(600,43)" opacity=".16">
    <rect x="0" y="0" width="100" height="18" fill="none" stroke="#e8c84a" stroke-width="1.2"/>
    <rect x="2" y="2" width="96"  height="14" fill="none" stroke="#e8c84a" stroke-width=".4"/>
    <text class="hd" x="50" y="13" text-anchor="middle" font-size="10" fill="#e8c84a" letter-spacing=".2em">CLASSIFIED</text>
  </g>

  <!-- header divider -->
  <line x1="12" y1="74" x2="708" y2="74" stroke="#e8c84a" stroke-width="1"  opacity=".4" class="fu1"/>
  <line x1="12" y1="76" x2="708" y2="76" stroke="#4a5a2a" stroke-width=".5" class="fu1"/>

  <!-- ═══ STAT PANELS ═══ -->
  <g class="fu2">${panel(c1, panelCY, panelW, "THIS WEEK", week.commits, TARGETS.week, 0.3)}</g>

  <g class="fu1"><line x1="180" y1="82" x2="180" y2="246" stroke="#4a5a2a" stroke-width="1"/>
  <polygon points="180,162 185,167 180,172 175,167" fill="#e8c84a" opacity=".3"/></g>

  <g class="fu3">${panel(c2, panelCY, panelW, "THIS MONTH", month.commits, TARGETS.month, 0.5)}</g>

  <g class="fu1"><line x1="360" y1="82" x2="360" y2="246" stroke="#4a5a2a" stroke-width="1"/>
  <polygon points="360,162 365,167 360,172 355,167" fill="#e8c84a" opacity=".3"/></g>

  <g class="fu4">${panel(c3, panelCY, panelW, "THIS YEAR", year.commits, TARGETS.year, 0.7)}</g>

  <!-- gold divider before all-time -->
  <g class="fu1"><line x1="540" y1="82" x2="540" y2="246" stroke="#c8a830" stroke-width="1.5"/>
  <polygon points="540,162 546,167 540,172 534,167" fill="#e8c84a" opacity=".55"/></g>

  <!-- all-time special panel bg -->
  <rect x="548" y="80" width="164" height="170" rx="2"
    fill="#1e1a08" opacity=".5" class="fu5"/>
  <rect x="548" y="80" width="164" height="170" rx="2"
    fill="none" stroke="#c8a830" stroke-width=".8" opacity=".35" class="fu5"/>

  <g class="fu5">${panel(c4, panelCY, panelW, "ALL TIME", allTime.commits, TARGETS.allTime, 0.9, true)}</g>

  <!-- bottom divider -->
  <line x1="12" y1="247" x2="708" y2="247" stroke="#e8c84a" stroke-width="1"  opacity=".35" class="fu5"/>
  <line x1="12" y1="249" x2="708" y2="249" stroke="#4a5a2a" stroke-width=".5" class="fu5"/>

  <!-- FOOTER -->
  <g class="fu6">
    <text class="mono dim" x="14"  y="268">FOR SUPER EARTH. FOR DEMOCRACY. FOR MANAGED CODE.</text>
    <text class="mono dim" x="706" y="268" text-anchor="end">${updated} UTC</text>
    <text class="mono dim" x="14"  y="282" fill="#1e2a0e">▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰</text>
    <text class="mono dim blink" x="706" y="282" text-anchor="end">█</text>
    <use href="#star" x="14" y="286" width="10" height="10" opacity=".25"/>
    <use href="#star" x="26" y="286" width="10" height="10" opacity=".25"/>
    <use href="#star" x="38" y="286" width="10" height="10" opacity=".25"/>
    <use href="#star" x="50" y="286" width="10" height="10" opacity=".25"/>
    <use href="#star" x="62" y="286" width="10" height="10" opacity=".25"/>
  </g>
</g>
</svg>`;
}

(async () => {
  console.log("Fetching stats for", USERNAME, "...");
  const stats = await fetchStats();
  console.log("Stats:", JSON.stringify(stats, null, 2));
  const svg = makeSVG(stats);
  fs.writeFileSync("stats.svg", svg, "utf8");
  console.log("✅ stats.svg written");
})();
