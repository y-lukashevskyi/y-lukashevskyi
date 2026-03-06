// generate-stats.js
// Run by GitHub Actions on a schedule — outputs stats.svg with real data

const fs = require("fs");

const USERNAME = process.env.USERNAME || "y-lukashevskyi";
const TOKEN = process.env.GITHUB_TOKEN || "";

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

const QUERY = `
  query($login: String!, $from: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from) {
        totalCommitContributions
        restrictedContributionsCount
        pullRequestContributionsByRepository {
          contributions(first: 100) {
            nodes { pullRequest { state } }
          }
        }
      }
    }
  }
`;

function extract(data) {
  const c = data?.data?.user?.contributionsCollection;
  if (!c) return { commits: 0, prs: 0 };

  // totalCommitContributions = public commits
  // restrictedContributionsCount = private commits (only visible with sufficient token scope)
  const commits =
    (c.totalCommitContributions || 0) + (c.restrictedContributionsCount || 0);

  // Count merged PRs across all repos (public + private)
  const prs = (c.pullRequestContributionsByRepository || []).reduce(
    (sum, repo) =>
      sum +
      (repo.contributions?.nodes || []).filter(
        (n) => n.pullRequest?.state === "MERGED",
      ).length,
    0,
  );
  return { commits, prs };
}

async function fetchStats() {
  const [yw, ym, yy] = await Promise.all([
    gql(QUERY, { login: USERNAME, from: startOf("week") }),
    gql(QUERY, { login: USERNAME, from: startOf("month") }),
    gql(QUERY, { login: USERNAME, from: startOf("year") }),
  ]);
  return {
    week: extract(yw),
    month: extract(ym),
    year: extract(yy),
  };
}

function makeSVG({ week, month, year }) {
  const updated = new Date().toUTCString().slice(0, 16);

  // Bar heights (capped at 52px)
  const cap = (v, scale) => Math.max(2, Math.min(v * scale, 52));
  const wCH = cap(week.commits, 5);
  const wPH = cap(week.prs, 14);
  const mCH = cap(month.commits, 1.2);
  const mPH = cap(month.prs, 5);
  const yCH = cap(year.commits, 0.18);
  const yPH = cap(year.prs, 1.4);
  const BY = 152; // bar base Y

  const animBar = (x, y, w, h, color, delay) => `
    <rect x="${x}" y="${y}" width="${w}" height="0" rx="2" fill="${color}" opacity="0.85">
      <animate attributeName="height" from="0" to="${h}" dur="0.55s" begin="${delay}s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1"/>
      <animate attributeName="y"      from="${y}" to="${y - h}" dur="0.55s" begin="${delay}s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1"/>
    </rect>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="210" viewBox="0 0 480 210">
<defs>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&amp;family=Syne:wght@800&amp;display=swap');
    .bg   { fill: #0d1117 }
    .brdr { fill: none; stroke: #21262d; stroke-width: 1 }
    .ttl  { font-family: 'Syne', sans-serif; font-weight: 800; fill: #e6edf3; font-size: 13px; letter-spacing: .06em }
    .lbl  { font-family: 'JetBrains Mono', monospace; fill: #8b949e; font-size: 9px; letter-spacing: .12em }
    .num  { font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 23px }
    .c    { fill: #58a6ff }
    .g    { fill: #3fb950 }
    .dim  { font-family: 'JetBrains Mono', monospace; fill: #484f58; font-size: 8px; letter-spacing: .14em }
    @keyframes fu   { from { opacity:0; transform: translateY(7px) } to { opacity:1; transform: translateY(0) } }
    @keyframes fi   { to   { opacity: 1 } }
    @keyframes blnk { 0%,100% { opacity:1 } 50% { opacity:.2 } }
    @keyframes scn  { 0% { transform: translateY(-70px) } 100% { transform: translateY(280px) } }
    .fu   { animation: fu  .55s ease forwards; opacity: 0 }
    .fi   { animation: fi  .5s  ease forwards; opacity: 0 }
    .dot  { animation: blnk 2s  ease-in-out infinite }
    .scn  { animation: scn 4.5s linear infinite; opacity: .018 }
  </style>
  <clipPath id="cl"><rect width="480" height="210" rx="8"/></clipPath>
  <linearGradient id="card" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#161b22"/>
    <stop offset="100%" stop-color="#0d1117"/>
  </linearGradient>
  <linearGradient id="bgC" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#58a6ff" stop-opacity=".13"/>
    <stop offset="100%" stop-color="#58a6ff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="bgG" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#3fb950" stop-opacity=".13"/>
    <stop offset="100%" stop-color="#3fb950" stop-opacity="0"/>
  </linearGradient>
  <filter id="glC"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="glG"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>

<g clip-path="url(#cl)">
  <!-- background -->
  <rect width="480" height="210" rx="8" fill="url(#card)"/>

  <!-- subtle grid -->
  <g opacity=".022">
    <line x1="96"  y1="0" x2="96"  y2="210" stroke="#58a6ff" stroke-width=".5"/>
    <line x1="192" y1="0" x2="192" y2="210" stroke="#58a6ff" stroke-width=".5"/>
    <line x1="288" y1="0" x2="288" y2="210" stroke="#58a6ff" stroke-width=".5"/>
    <line x1="384" y1="0" x2="384" y2="210" stroke="#58a6ff" stroke-width=".5"/>
    <line x1="0" y1="60"  x2="480" y2="60"  stroke="#58a6ff" stroke-width=".5"/>
    <line x1="0" y1="110" x2="480" y2="110" stroke="#58a6ff" stroke-width=".5"/>
    <line x1="0" y1="160" x2="480" y2="160" stroke="#58a6ff" stroke-width=".5"/>
  </g>

  <!-- scanline -->
  <rect class="scn" width="480" height="60" fill="white"/>

  <!-- border -->
  <rect class="brdr" x=".5" y=".5" width="479" height="209" rx="8"/>

  <!-- top accent -->
  <line x1="18" y1="1" x2="140" y2="1" stroke="#58a6ff" stroke-width="1.5"
        class="fi" style="animation-delay:.08s"/>

  <!-- corner brackets -->
  <g opacity=".35" class="fi" style="animation-delay:.1s">
    <polyline points="456,13 474,13 474,31" fill="none" stroke="#58a6ff" stroke-width="1"/>
    <polyline points="456,197 474,197 474,179" fill="none" stroke="#30363d" stroke-width="1"/>
    <polyline points="24,197 6,197 6,179"   fill="none" stroke="#30363d" stroke-width="1"/>
  </g>

  <!-- header -->
  <g class="fu" style="animation-delay:.18s">
    <circle class="dot c" cx="20" cy="27" r="3.5"/>
    <text class="ttl" x="32" y="32">ACTIVITY STATS</text>
    <text class="dim" x="32" y="46">@${USERNAME}</text>
  </g>

  <!-- legend -->
  <g class="fi" style="animation-delay:.28s">
    <rect x="328" y="20" width="7" height="7" rx="1.5" fill="#58a6ff"/>
    <text class="lbl" x="339" y="27">COMMITS</text>
    <rect x="398" y="20" width="7" height="7" rx="1.5" fill="#3fb950"/>
    <text class="lbl" x="409" y="27">MERGED PR</text>
  </g>

  <!-- section divider -->
  <line x1="16" y1="58" x2="464" y2="58" stroke="#21262d" stroke-width="1"
        class="fi" style="animation-delay:.3s"/>

  <!-- ══ WEEK ══ -->
  <g class="fu" style="animation-delay:.32s">
    <text class="lbl" x="60" y="77" text-anchor="middle">THIS WEEK</text>
    <rect x="14" y="83" width="92" height="58" rx="5" fill="url(#bgC)"/>
    <text class="num c" x="60" y="119" text-anchor="middle" filter="url(#glC)">${week.commits}</text>
    <text class="lbl g" x="60" y="134" text-anchor="middle">${week.prs} MERGED PR</text>
  </g>
  <!-- week bars -->
  ${animBar(116, BY, 9, wCH, "#58a6ff", 0.55)}
  ${animBar(127, BY, 9, wPH, "#3fb950", 0.62)}

  <!-- divider -->
  <line x1="146" y1="64" x2="146" y2="158" stroke="#21262d" stroke-width="1"
        class="fi" style="animation-delay:.33s"/>

  <!-- ══ MONTH ══ -->
  <g class="fu" style="animation-delay:.42s">
    <text class="lbl" x="248" y="77" text-anchor="middle">THIS MONTH</text>
    <rect x="155" y="83" width="186" height="58" rx="5" fill="url(#bgC)"/>
    <text class="num c" x="248" y="119" text-anchor="middle" filter="url(#glC)">${month.commits}</text>
    <text class="lbl g" x="248" y="134" text-anchor="middle">${month.prs} MERGED PR</text>
  </g>
  <!-- month bars -->
  ${animBar(351, BY, 9, mCH, "#58a6ff", 0.62)}
  ${animBar(362, BY, 9, mPH, "#3fb950", 0.69)}

  <!-- divider -->
  <line x1="382" y1="64" x2="382" y2="158" stroke="#21262d" stroke-width="1"
        class="fi" style="animation-delay:.33s"/>

  <!-- ══ YEAR ══ -->
  <g class="fu" style="animation-delay:.52s">
    <text class="lbl" x="431" y="77" text-anchor="middle">THIS YEAR</text>
    <rect x="391" y="83" width="80" height="58" rx="5" fill="url(#bgC)"/>
    <text class="num c" x="431" y="119" text-anchor="middle" filter="url(#glC)">${year.commits}</text>
    <text class="lbl g" x="431" y="134" text-anchor="middle">${year.prs} PR</text>
  </g>

  <!-- bottom divider -->
  <line x1="16" y1="160" x2="464" y2="160" stroke="#21262d" stroke-width="1"
        class="fi" style="animation-delay:.6s"/>

  <!-- footer -->
  <g class="fi" style="animation-delay:.72s">
    <circle cx="20" cy="183" r="2" fill="#3fb950" opacity=".5"/>
    <text class="lbl" x="28" y="187">COMMITS + MERGED PRS · AUTO-UPDATED</text>
    <text class="dim" x="464" y="187" text-anchor="end">${updated}</text>
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
