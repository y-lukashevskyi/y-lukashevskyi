// generate-stats.js — outputs stats.svg + history.svg + activity.svg + pr-stats.svg

const fs = require("fs");

const USERNAME = process.env.USERNAME || "y-lukashevskyi";
const TOKEN = process.env.GITHUB_TOKEN || "";
const START_YEAR = 2022;

const TARGETS = {
  week: 35,
  month: 130,
  year: 1040,
  allTime: 3000,
};

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
const MLABELS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const DAYS = ["MON", "TUE", "WED", "THU", "FRI"];

// ─── GQL ────────────────────────────────────────────────────

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

// ─── QUERIES ────────────────────────────────────────────────

const CREATED_QUERY = `query($login:String!){user(login:$login){createdAt}}`;

const COMMIT_QUERY = `
  query($login: String!, $from: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from) {
        totalCommitContributions
        restrictedContributionsCount
      }
    }
  }
`;

const MONTHLY_QUERY = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks { contributionDays { date contributionCount } }
        }
      }
    }
  }
`;

const CALENDAR_QUERY = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks { contributionDays { date contributionCount weekday } }
        }
      }
    }
  }
`;

const PR_QUERY = `
  query($login: String!, $after: String) {
    user(login: $login) {
      pullRequests(first: 100, after: $after, orderBy: {field: CREATED_AT, direction: DESC}) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes {
          state
          createdAt
          additions
          deletions
        }
      }
    }
  }
`;

// ─── HELPERS ────────────────────────────────────────────────

function extractCommits(data) {
  const c = data?.data?.user?.contributionsCollection;
  if (!c) return 0;
  return (
    (c.totalCommitContributions || 0) + (c.restrictedContributionsCount || 0)
  );
}

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

function barW(commits, target, max = 128) {
  return Math.max(2, Math.min(Math.round((commits / target) * max), max));
}

function starPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const oa = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    const ia = oa + Math.PI / 5;
    pts.push(
      `${(cx + Math.cos(oa) * r).toFixed(2)},${(cy + Math.sin(oa) * r).toFixed(2)}`,
    );
    pts.push(
      `${(cx + Math.cos(ia) * (r * 0.42)).toFixed(2)},${(cy + Math.sin(ia) * (r * 0.42)).toFixed(2)}`,
    );
  }
  return pts.join(" ");
}

function starRow(tier, x, y, size = 11) {
  let out = "";
  for (let i = 0; i < 5; i++) {
    const filled = i < tier;
    out += `<polygon points="${starPoints(x + i * (size + 3), y, size / 2)}" fill="${filled ? "#e8c84a" : "none"}" stroke="#e8c84a" stroke-width="1" opacity="${filled ? 1 : 0.3}"/>`;
  }
  return out;
}

function fmt(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

function calendarToMonthly(data, year) {
  const months = Array(12).fill(0);
  const weeks =
    data?.data?.user?.contributionsCollection?.contributionCalendar?.weeks ||
    [];
  for (const week of weeks)
    for (const day of week.contributionDays) {
      const d = new Date(day.date);
      if (d.getFullYear() === year)
        months[d.getMonth()] += day.contributionCount;
    }
  return months;
}

// SVG shell shared across all cards
function svgShell(W, H, clipId, hatchId, content, footer) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&amp;family=Share+Tech+Mono&amp;display=swap');
    .bg{fill:#0a0c08}.hd{font-family:'Barlow Condensed',sans-serif;font-weight:900}.mono{font-family:'Share Tech Mono',monospace}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    @keyframes scanln{0%{transform:translateY(-45px)}100%{transform:translateY(${H + 50}px)}}
    @keyframes fadeUp{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
    @keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
    @keyframes shine{0%,100%{opacity:.65}50%{opacity:1}}
    @keyframes flame{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.08) scaleX(.95)}}
    .pulse{animation:pulse 2s ease-in-out infinite}
    .scanln{animation:scanln 5s linear infinite;opacity:.02}
    .shine{animation:shine 3s ease-in-out infinite}
    .flame{animation:flame 1.5s ease-in-out infinite;transform-origin:center bottom}
    .fu1{animation:fadeUp .5s ease forwards;opacity:0;animation-delay:.05s}
    .fu2{animation:fadeUp .5s ease forwards;opacity:0;animation-delay:.2s}
    .fu3{animation:fadeUp .5s ease forwards;opacity:0;animation-delay:.35s}
    .fu4{animation:fadeUp .5s ease forwards;opacity:0;animation-delay:.5s}
    .fu5{animation:fadeUp .5s ease forwards;opacity:0;animation-delay:.65s}
    .fu6{animation:fadeUp .5s ease forwards;opacity:0;animation-delay:.8s}
    .blink{animation:blink 1.1s step-end infinite}
  </style>
  <clipPath id="${clipId}"><rect width="${W}" height="${H}" rx="3"/></clipPath>
  <filter id="goldglow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="brightglow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <filter id="softglow"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <pattern id="${hatchId}" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <line x1="0" y1="0" x2="0" y2="8" stroke="#e8c84a" stroke-width=".5" opacity=".05"/>
  </pattern>
  <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#4a5a20"/><stop offset="55%" stop-color="#c8a830"/><stop offset="100%" stop-color="#e8c84a"/>
  </linearGradient>
  <linearGradient id="barAll" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#6a5010"/><stop offset="55%" stop-color="#d4a830"/><stop offset="100%" stop-color="#ffdd66"/>
  </linearGradient>
  <linearGradient id="streakGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#4a5a20"/><stop offset="60%" stop-color="#c8a830"/><stop offset="100%" stop-color="#e8c84a"/>
  </linearGradient>
  <linearGradient id="bestGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="#2a3a10"/><stop offset="100%" stop-color="#6a7a3a"/>
  </linearGradient>
  <symbol id="star" viewBox="0 0 20 20">
    <polygon points="10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7" fill="#e8c84a"/>
  </symbol>
</defs>
<g clip-path="url(#${clipId})">
  <rect class="bg" width="${W}" height="${H}"/>
  <rect width="${W}" height="${H}" fill="url(#${hatchId})"/>
  <rect width="${W}" height="${H}" fill="#182008" opacity=".08"/>
  <rect class="scanln" width="${W}" height="42" fill="white"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="2" fill="none" stroke="#e8c84a" stroke-width="1.5" opacity=".5"/>
  <rect x="5" y="5" width="${W - 10}" height="${H - 10}" rx="1" fill="none" stroke="#4a5a2a" stroke-width=".7"/>
  <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="1" fill="none" stroke="#2a3a1a" stroke-width=".4"/>
  <g fill="#e8c84a">
    <rect x="1" y="1" width="22" height="3"/>          <rect x="1" y="1" width="3" height="22"/>
    <rect x="${W - 23}" y="1" width="22" height="3"/>     <rect x="${W - 4}" y="1" width="3" height="22"/>
    <rect x="1" y="${H - 4}" width="22" height="3"/>      <rect x="1" y="${H - 23}" width="3" height="22"/>
    <rect x="${W - 23}" y="${H - 4}" width="22" height="3"/><rect x="${W - 4}" y="${H - 23}" width="3" height="22"/>
  </g>
  ${content}
  <line x1="12" y1="${H - 32}" x2="${W - 12}" y2="${H - 32}" stroke="#e8c84a" stroke-width="1" opacity=".3"/>
  <text class="mono" x="14" y="${H - 14}" font-size="7" fill="#3a4a1a" letter-spacing=".13em">FOR SUPER EARTH. FOR DEMOCRACY. FOR MANAGED CODE.</text>
  <text class="mono" x="${W - 14}" y="${H - 14}" font-size="7" fill="#3a4a1a" text-anchor="end">${footer}</text>
  <text class="mono blink" x="${W - 14}" y="${H - 4}" font-size="7" fill="#2a3a1a" text-anchor="end">█</text>
</g>
</svg>`;
}

// ─── FETCH ───────────────────────────────────────────────────

async function fetchStats() {
  const createdData = await gql(CREATED_QUERY, { login: USERNAME });
  const createdYear =
    new Date(createdData?.data?.user?.createdAt).getFullYear() || 2019;
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let y = createdYear; y <= currentYear; y++) years.push(y);

  const [yw, ym, yy, ...yearlyResults] = await Promise.all([
    gql(COMMIT_QUERY, { login: USERNAME, from: startOf("week") }),
    gql(COMMIT_QUERY, { login: USERNAME, from: startOf("month") }),
    gql(COMMIT_QUERY, { login: USERNAME, from: startOf("year") }),
    ...years.map((y) =>
      gql(COMMIT_QUERY, {
        login: USERNAME,
        from: new Date(y, 0, 1).toISOString(),
      }),
    ),
  ]);

  const yearlyCounts = yearlyResults.map((d) => extractCommits(d));
  let allTime = 0;
  for (let i = 0; i < yearlyCounts.length; i++) {
    if (i < yearlyCounts.length - 1)
      allTime += Math.max(0, yearlyCounts[i] - yearlyCounts[i + 1]);
    else allTime += yearlyCounts[i];
  }

  return {
    week: extractCommits(yw),
    month: extractCommits(ym),
    year: extractCommits(yy),
    allTime,
  };
}

async function fetchMonthly() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();
  const historyYears = [];
  for (let y = START_YEAR; y <= currentYear; y++) historyYears.push(y);

  const results = await Promise.all(
    historyYears.map((y) =>
      gql(MONTHLY_QUERY, {
        login: USERNAME,
        from: new Date(y, 0, 1).toISOString(),
        to: new Date(y, 11, 31, 23, 59, 59).toISOString(),
      }),
    ),
  );

  const monthly = {};
  for (let i = 0; i < historyYears.length; i++) {
    monthly[historyYears[i]] = calendarToMonthly(results[i], historyYears[i]);
  }
  for (let m = currentMonth + 1; m < 12; m++) monthly[currentYear][m] = null;
  return monthly;
}

async function fetchActivityData() {
  const now = new Date();
  const from = new Date(now);
  from.setFullYear(now.getFullYear() - 1);

  const data = await gql(CALENDAR_QUERY, {
    login: USERNAME,
    from: from.toISOString(),
    to: now.toISOString(),
  });
  const weeks =
    data?.data?.user?.contributionsCollection?.contributionCalendar?.weeks ||
    [];
  const days = weeks.flatMap((w) => w.contributionDays);

  // Current weekday streak
  let currentStreak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let checkDate = new Date(today);
  if (checkDate.getDay() === 0) checkDate.setDate(checkDate.getDate() - 2);
  if (checkDate.getDay() === 6) checkDate.setDate(checkDate.getDate() - 1);
  for (let i = 0; i < 365; i++) {
    const dow = checkDate.getDay();
    if (dow === 0 || dow === 6) {
      checkDate.setDate(checkDate.getDate() - 1);
      continue;
    }
    const dateStr = checkDate.toISOString().slice(0, 10);
    const found = days.find((d) => d.date === dateStr);
    if (found && found.contributionCount > 0) {
      currentStreak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else break;
  }

  // Best weekday streak
  const allDays = [...days]
    .map((d) => ({ ...d, dt: new Date(d.date) }))
    .sort((a, b) => a.dt - b.dt)
    .filter((d) => d.dt.getDay() !== 0 && d.dt.getDay() !== 6);

  let bestStreak = 0,
    runStreak = 0,
    prevDt = null;
  for (const d of allDays) {
    if (d.contributionCount > 0) {
      if (prevDt) {
        const diff = (d.dt - prevDt) / (1000 * 60 * 60 * 24);
        runStreak = diff === 1 || diff === 3 ? runStreak + 1 : 1;
      } else {
        runStreak = 1;
      }
      bestStreak = Math.max(bestStreak, runStreak);
      prevDt = d.dt;
    } else {
      runStreak = 0;
      prevDt = null;
    }
  }

  // By day of week
  const byDow = Array(5).fill(0);
  for (const d of days) {
    const dow = new Date(d.date).getDay();
    if (dow >= 1 && dow <= 5) byDow[dow - 1] += d.contributionCount;
  }

  // By hour (REST events)
  const byHour = Array(24).fill(0);
  try {
    const evRes = await fetch(
      `https://api.github.com/users/${USERNAME}/events?per_page=100`,
      {
        headers: {
          Authorization: `bearer ${TOKEN}`,
          "User-Agent": "stats-bot",
        },
      },
    );
    const events = await evRes.json();
    if (Array.isArray(events)) {
      for (const ev of events) {
        if (ev.type === "PushEvent" && ev.created_at) {
          const hour = new Date(ev.created_at).getHours();
          const dow = new Date(ev.created_at).getDay();
          if (dow >= 1 && dow <= 5) byHour[hour]++;
        }
      }
    }
  } catch (e) {
    console.warn("Hourly fetch failed:", e.message);
  }

  return { currentStreak, bestStreak, byDow, byHour };
}

async function fetchPRStats() {
  let allPRs = [],
    after = null,
    pages = 0;
  while (pages < 5) {
    const data = await gql(PR_QUERY, { login: USERNAME, after });
    const prs = data?.data?.user?.pullRequests;
    if (!prs) break;
    allPRs = allPRs.concat(prs.nodes);
    if (!prs.pageInfo.hasNextPage) break;
    after = prs.pageInfo.endCursor;
    pages++;
  }

  const total = allPRs.length;
  const merged = allPRs.filter((p) => p.state === "MERGED").length;
  const closed = allPRs.filter((p) => p.state === "CLOSED").length;
  const open = allPRs.filter((p) => p.state === "OPEN").length;
  const mergeRate = total > 0 ? ((merged / total) * 100).toFixed(0) : 0;
  const additions = allPRs.reduce((s, p) => s + (p.additions || 0), 0);
  const deletions = allPRs.reduce((s, p) => s + (p.deletions || 0), 0);

  const currentYear = new Date().getFullYear();
  const byMonth = Array(12).fill(0);
  for (const pr of allPRs) {
    const d = new Date(pr.createdAt);
    if (d.getFullYear() === currentYear) byMonth[d.getMonth()]++;
  }

  const byYear = {};
  for (const pr of allPRs) {
    const y = new Date(pr.createdAt).getFullYear();
    byYear[y] = (byYear[y] || 0) + 1;
  }

  return {
    total,
    merged,
    closed,
    open,
    mergeRate,
    additions,
    deletions,
    byMonth,
    byYear,
  };
}

// ─── MAKE stats.svg ──────────────────────────────────────────

function panel(cx, cy, w, label, commits, target, animDelay, allTime = false) {
  const x = cx - w / 2;
  const pct = Math.min((commits / target) * 100, 100);
  const bw = barW(commits, target, w - 16);
  const mr = missionRating(commits, target);
  const col = tierColor(mr.tier);

  if (allTime) {
    return `<g>
    <g transform="translate(${cx - 52},${cy - 28}) scale(1.04)" opacity=".07">
      <path d="M50,8 L32,26 L10,20 L28,33 L18,52 L50,36 L82,52 L72,33 L90,20 L68,26 Z" fill="#e8c84a"/>
      <circle cx="50" cy="22" r="9" fill="#e8c84a"/><circle cx="50" cy="22" r="4" fill="#0a0c08"/>
    </g>
    <text class="mono lbl" x="${cx}" y="${cy - 54}" text-anchor="middle" font-size="9" fill="#a8b878" letter-spacing=".15em">◈ ${label} ◈</text>
    <text class="hd" x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="38" fill="#ffdd66" filter="url(#brightglow)">${commits.toLocaleString()}</text>
    <text class="mono" x="${cx}" y="${cy + 28}" text-anchor="middle" font-size="8" fill="#6a7a3a" letter-spacing=".2em">COMMITS DEPLOYED</text>
    <text class="mono" x="${cx}" y="${cy + 48}" text-anchor="middle" font-size="7.5" fill="#6a5a2a" letter-spacing=".1em">SINCE ACCOUNT CREATION</text>
  </g>`;
  }

  return `<g>
    <g transform="translate(${cx - 52},${cy - 28}) scale(1.04)" opacity=".07">
      <path d="M50,8 L32,26 L10,20 L28,33 L18,52 L50,36 L82,52 L72,33 L90,20 L68,26 Z" fill="#e8c84a"/>
      <circle cx="50" cy="22" r="9" fill="#e8c84a"/><circle cx="50" cy="22" r="4" fill="#0a0c08"/>
    </g>
    <text class="mono" x="${cx}" y="${cy - 54}" text-anchor="middle" font-size="9" fill="#a8b878" letter-spacing=".15em">◈ ${label} ◈</text>
    <text class="hd" x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="34" fill="#e8c84a" filter="url(#goldglow)">${commits.toLocaleString()}</text>
    <text class="mono" x="${cx}" y="${cy + 20}" text-anchor="middle" font-size="8" fill="#6a7a3a" letter-spacing=".2em">COMMITS DEPLOYED</text>
    <text class="mono" x="${cx}" y="${cy + 36}" text-anchor="middle" font-size="7.5" fill="${col}" letter-spacing=".1em">${mr.label}</text>
    ${starRow(mr.tier, cx - (5 * 14) / 2 + 1, cy + 52, 11)}
    <rect x="${x + 8}" y="${cy + 62}" width="${w - 16}" height="6" rx="1" fill="#181d0e"/>
    <rect x="${x + 8}" y="${cy + 62}" width="0" height="6" rx="1" fill="url(#barGrad)">
      <animate attributeName="width" from="0" to="${bw}" dur=".8s" begin="${animDelay}s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1"/>
    </rect>
    <line x1="${x + 8 + (w - 16) * 0.25}" y1="${cy + 62}" x2="${x + 8 + (w - 16) * 0.25}" y2="${cy + 68}" stroke="#0a0c08" stroke-width="1.5"/>
    <line x1="${x + 8 + (w - 16) * 0.5}" y1="${cy + 62}" x2="${x + 8 + (w - 16) * 0.5}" y2="${cy + 68}" stroke="#0a0c08" stroke-width="1.5"/>
    <line x1="${x + 8 + (w - 16) * 0.75}" y1="${cy + 62}" x2="${x + 8 + (w - 16) * 0.75}" y2="${cy + 68}" stroke="#0a0c08" stroke-width="1.5"/>
    <text class="mono" x="${x + 8}" y="${cy + 80}" font-size="7" fill="#3a4a1a">0</text>
    <text class="mono" x="${x + w - 8}" y="${cy + 80}" font-size="7" fill="#3a4a1a" text-anchor="end">TGT:${target}</text>
    <text class="mono" x="${cx}" y="${cy + 80}" font-size="7" fill="#3a4a1a" text-anchor="middle">${pct.toFixed(0)}%</text>
  </g>`;
}

function makeSVG({ week, month, year, allTime }) {
  const updated = new Date().toUTCString().slice(0, 16);
  const W = 720,
    H = 300,
    pW = 158,
    pCY = 158;
  const c1 = 89,
    c2 = 269,
    c3 = 449,
    c4 = 629;

  const content = `
  <g class="fu1">
    <text class="mono" x="14" y="22" font-size="8" fill="#6a7a3a" letter-spacing=".22em">▶ SUPER EARTH HIGH COMMAND — CLASSIFIED DEPLOYMENT METRICS</text>
    <text class="hd" x="14" y="48" font-size="21" fill="#e8c84a" letter-spacing=".1em" filter="url(#goldglow)">HELLDIVER COMMIT REPORT</text>
    <rect x="14" y="53" width="318" height="15" fill="#e8c84a" opacity=".07"/>
    <rect x="14" y="53" width="3" height="15" fill="#e8c84a"/>
    <use href="#star" x="18" y="54" width="12" height="12"/>
    <use href="#star" x="32" y="54" width="12" height="12"/>
    <use href="#star" x="46" y="54" width="12" height="12"/>
    <use href="#star" x="60" y="54" width="12" height="12"/>
    <use href="#star" x="74" y="54" width="12" height="12"/>
    <text class="mono shine" x="92" y="64" font-size="9" fill="#c8a830" letter-spacing=".26em">HIGH COMMAND GENERAL · Y-LUKASHEVSKYI</text>
  </g>
  <g class="fu1">
    <circle class="pulse" cx="692" cy="25" r="4" fill="#4aaa4a" filter="url(#softglow)"/>
    <text class="mono" x="700" y="21" font-size="7" fill="#4a8a4a">LIVE</text>
    <text class="mono" x="700" y="31" font-size="7" fill="#3a4a1a">FEED</text>
  </g>
  <g transform="translate(600,43)" opacity=".16">
    <rect x="0" y="0" width="100" height="18" fill="none" stroke="#e8c84a" stroke-width="1.2"/>
    <rect x="2" y="2" width="96" height="14" fill="none" stroke="#e8c84a" stroke-width=".4"/>
    <text class="hd" x="50" y="13" text-anchor="middle" font-size="10" fill="#e8c84a" letter-spacing=".2em">CLASSIFIED</text>
  </g>
  <line x1="12" y1="74" x2="708" y2="74" stroke="#e8c84a" stroke-width="1" opacity=".4" class="fu1"/>
  <line x1="12" y1="76" x2="708" y2="76" stroke="#4a5a2a" stroke-width=".5" class="fu1"/>

  <g class="fu2">${panel(c1, pCY, pW, "THIS WEEK", week, TARGETS.week, 0.3)}</g>
  <line x1="180" y1="82" x2="180" y2="246" stroke="#4a5a2a" stroke-width="1" class="fu1"/>
  <polygon points="180,162 185,167 180,172 175,167" fill="#e8c84a" opacity=".3" class="fu1"/>

  <g class="fu3">${panel(c2, pCY, pW, "THIS MONTH", month, TARGETS.month, 0.5)}</g>
  <line x1="360" y1="82" x2="360" y2="246" stroke="#4a5a2a" stroke-width="1" class="fu1"/>
  <polygon points="360,162 365,167 360,172 355,167" fill="#e8c84a" opacity=".3" class="fu1"/>

  <g class="fu4">${panel(c3, pCY, pW, "THIS YEAR", year, TARGETS.year, 0.7)}</g>
  <line x1="540" y1="82" x2="540" y2="246" stroke="#c8a830" stroke-width="1.5" class="fu1"/>
  <polygon points="540,162 546,167 540,172 534,167" fill="#e8c84a" opacity=".55" class="fu1"/>

  <rect x="548" y="80" width="164" height="170" rx="2" fill="#1e1a08" opacity=".5" class="fu5"/>
  <rect x="548" y="80" width="164" height="170" rx="2" fill="none" stroke="#c8a830" stroke-width=".8" opacity=".35" class="fu5"/>
  <g class="fu5">${panel(c4, pCY, pW, "ALL TIME", allTime, TARGETS.allTime, 0.9, true)}</g>

  <line x1="12" y1="247" x2="708" y2="247" stroke="#e8c84a" stroke-width="1" opacity=".35" class="fu5"/>
  <line x1="12" y1="249" x2="708" y2="249" stroke="#4a5a2a" stroke-width=".5" class="fu5"/>
  <use href="#star" x="14" y="254" width="10" height="10" opacity=".25" class="fu6"/>
  <use href="#star" x="26" y="254" width="10" height="10" opacity=".25" class="fu6"/>
  <use href="#star" x="38" y="254" width="10" height="10" opacity=".25" class="fu6"/>
  <use href="#star" x="50" y="254" width="10" height="10" opacity=".25" class="fu6"/>
  <use href="#star" x="62" y="254" width="10" height="10" opacity=".25" class="fu6"/>`;

  return svgShell(W, H, "cc1", "h1", content, `${updated} UTC`);
}

// ─── MAKE history.svg ────────────────────────────────────────

function makeHistorySVG(monthly) {
  const years = Object.keys(monthly).map(Number).sort();
  const updated = new Date().toUTCString().slice(0, 16);
  const W = 720,
    colW = 52,
    rowH = 28,
    labelW = 46,
    padL = 14,
    padT = 58;
  const tableStartX = padL;
  const totalH = padT + years.length * rowH + 52;

  const allVals = years.flatMap((y) => monthly[y].filter((v) => v !== null));
  const maxVal = Math.max(...allVals, 1);

  function cellColor(val) {
    if (val === null) return "#0a0c08";
    if (val === 0) return "#111408";
    const t = Math.sqrt(val / maxVal);
    const r = Math.round(20 + t * (232 - 20));
    const g = Math.round(22 + t * (200 - 22));
    const b = Math.round(8 + t * (74 - 8));
    return `rgb(${r},${g},${b})`;
  }
  function textColor(val) {
    if (val === null || val === 0) return "#2a3a1a";
    return val / maxVal > 0.4 ? "#0a0c08" : "#6a7a3a";
  }

  let rows = "",
    header = "";
  for (let yi = 0; yi < years.length; yi++) {
    const y = years[yi];
    const ry = padT + yi * rowH;
    const tot = monthly[y].reduce((s, v) => s + (v || 0), 0);
    rows += `<text class="mono" x="${tableStartX + labelW - 6}" y="${ry + 18}" text-anchor="end" font-size="9" fill="#a8b878" letter-spacing=".1em">${y}</text>`;
    for (let m = 0; m < 12; m++) {
      const val = monthly[y][m];
      const cx = tableStartX + labelW + m * colW;
      const disp = val === null ? "—" : val === 0 ? "·" : val;
      rows += `<rect x="${cx + 1}" y="${ry + 2}" width="${colW - 2}" height="${rowH - 4}" rx="2" fill="${cellColor(val)}"/>`;
      rows += `<text class="mono" x="${cx + colW / 2}" y="${ry + 17}" text-anchor="middle" font-size="9" fill="${textColor(val)}">${disp}</text>`;
    }
    rows += `<text class="mono" x="${tableStartX + labelW + 12 * colW + 8}" y="${ry + 18}" font-size="9" fill="#e8c84a">${tot}</text>`;
  }
  for (let m = 0; m < 12; m++) {
    const cx = tableStartX + labelW + m * colW;
    header += `<text class="mono" x="${cx + colW / 2}" y="${padT - 8}" text-anchor="middle" font-size="8" fill="#6a7a3a" letter-spacing=".1em">${MONTHS[m]}</text>`;
  }
  header += `<text class="mono" x="${tableStartX + labelW + 12 * colW + 8}" y="${padT - 8}" font-size="8" fill="#6a7a3a">TOT</text>`;

  const content = `
  <g class="fu1">
    <text class="mono" x="14" y="22" font-size="8" fill="#6a7a3a" letter-spacing=".2em">▶ COMMIT HISTORY — MONTHLY BREAKDOWN</text>
    <text class="hd" x="14" y="46" font-size="18" fill="#e8c84a" letter-spacing=".08em">DEPLOYMENT ARCHIVE · ${START_YEAR}–PRESENT</text>
  </g>
  <line x1="12" y1="${padT - 14}" x2="${W - 12}" y2="${padT - 14}" stroke="#e8c84a" stroke-width="1" opacity=".35"/>
  <line x1="12" y1="${padT - 12}" x2="${W - 12}" y2="${padT - 12}" stroke="#4a5a2a" stroke-width=".5"/>
  <g class="fu1">${header}</g>
  <g class="fu2">${rows}</g>`;

  return svgShell(W, totalH, "cc2", "h2", content, `${updated} UTC`);
}

// ─── MAKE activity.svg ───────────────────────────────────────

function makeActivitySVG({ currentStreak, bestStreak, byDow, byHour }) {
  const updated = new Date().toUTCString().slice(0, 16);
  const W = 720,
    H = 260;
  const streakTarget = Math.max(bestStreak, 30);
  const curBarW = Math.min(
    Math.round((currentStreak / streakTarget) * 280),
    280,
  );
  const bestBarW = Math.min(Math.round((bestStreak / streakTarget) * 280), 280);
  const flameCol =
    currentStreak >= bestStreak
      ? "#ffdd66"
      : currentStreak > 0
        ? "#e8c84a"
        : "#3a4a1a";
  const maxDow = Math.max(...byDow, 1);
  const maxDow_i = byDow.indexOf(Math.max(...byDow));

  // Hour blocks (3hr buckets)
  const hourBlocks = Array.from({ length: 8 }, (_, i) =>
    byHour.slice(i * 3, i * 3 + 3).reduce((a, b) => a + b, 0),
  );
  const maxBlock = Math.max(...hourBlocks, 1);
  const maxBlock_i = hourBlocks.indexOf(Math.max(...hourBlocks));

  const dowBars = DAYS.map((label, i) => {
    const bh = Math.max(
      Math.round((byDow[i] / maxDow) * 60),
      byDow[i] > 0 ? 2 : 0,
    );
    const x = 358 + i * 28,
      by = 194;
    const col = i === maxDow_i ? "#e8c84a" : "#6a8a3a";
    return `
    <rect x="${x}" y="${by - bh}" width="18" height="${bh}" rx="2" fill="${col}" opacity=".85">
      <animate attributeName="height" from="0" to="${bh}" dur=".6s" begin="${0.3 + i * 0.08}s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1"/>
      <animate attributeName="y" from="${by}" to="${by - bh}" dur=".6s" begin="${0.3 + i * 0.08}s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1"/>
    </rect>
    <text class="mono" x="${x + 9}" y="${by + 11}" text-anchor="middle" font-size="7" fill="#4a5a2a">${label}</text>
    ${byDow[i] > 0 ? `<text class="mono" x="${x + 9}" y="${by - bh - 3}" text-anchor="middle" font-size="7" fill="${col}">${byDow[i]}</text>` : ""}`;
  }).join("");

  const HLABELS = ["0h", "3h", "6h", "9h", "12h", "15h", "18h", "21h"];
  const hourBars = hourBlocks
    .map((val, i) => {
      const bh = Math.max(Math.round((val / maxBlock) * 60), val > 0 ? 2 : 0);
      const x = 530 + i * 24,
        by = 194;
      const col = i === maxBlock_i ? "#e8c84a" : "#4a6a2a";
      return `
    <rect x="${x}" y="${by - bh}" width="16" height="${bh}" rx="2" fill="${col}" opacity=".85">
      <animate attributeName="height" from="0" to="${bh}" dur=".6s" begin="${0.5 + i * 0.06}s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1"/>
      <animate attributeName="y" from="${by}" to="${by - bh}" dur=".6s" begin="${0.5 + i * 0.06}s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1"/>
    </rect>
    <text class="mono" x="${x + 8}" y="${by + 11}" text-anchor="middle" font-size="6" fill="#4a5a2a">${HLABELS[i]}</text>
    ${val > 0 ? `<text class="mono" x="${x + 8}" y="${by - bh - 3}" text-anchor="middle" font-size="7" fill="${col}">${val}</text>` : ""}`;
    })
    .join("");

  const content = `
  <g class="fu1">
    <text class="mono" x="14" y="22" font-size="8" fill="#6a7a3a" letter-spacing=".22em">▶ OPERATIVE BEHAVIOUR ANALYSIS — CLASSIFIED</text>
    <text class="hd" x="14" y="48" font-size="20" fill="#e8c84a" letter-spacing=".1em" filter="url(#goldglow)">COMBAT PATTERN REPORT</text>
  </g>
  <g class="fu1">
    <circle class="pulse" cx="692" cy="25" r="4" fill="#4aaa4a" filter="url(#softglow)"/>
    <text class="mono" x="700" y="21" font-size="7" fill="#4a8a4a">LIVE</text>
    <text class="mono" x="700" y="31" font-size="7" fill="#3a4a1a">FEED</text>
  </g>
  <line x1="12" y1="58" x2="${W - 12}" y2="58" stroke="#e8c84a" stroke-width="1" opacity=".4" class="fu1"/>
  <line x1="12" y1="60" x2="${W - 12}" y2="60" stroke="#4a5a2a" stroke-width=".5" class="fu1"/>

  <!-- STREAK -->
  <g class="fu2">
    <text class="mono" x="14" y="78" font-size="8" fill="#6a7a3a" letter-spacing=".2em">◈ DEPLOYMENT STREAK (MON–FRI) ◈</text>
    <g class="flame" transform="translate(14,90)">
      <path d="M12,0 C12,0 18,8 18,14 C18,20 15,24 12,24 C9,24 6,20 6,14 C6,8 12,0 12,0Z M12,10 C12,10 15,15 15,18 C15,21 13.5,22 12,22 C10.5,22 9,21 9,18 C9,15 12,10 12,10Z"
        fill="${flameCol}" opacity=".9" filter="url(#softglow)"/>
    </g>
    <text class="hd" x="50" y="120" font-size="42" fill="${flameCol}" filter="url(#goldglow)">${currentStreak}</text>
    <text class="mono" x="50" y="134" font-size="8" fill="#6a7a3a" letter-spacing=".15em">DAY STREAK</text>
    <text class="mono" x="14" y="154" font-size="7" fill="#a8b878" letter-spacing=".1em">CURRENT</text>
    <rect x="14" y="158" width="280" height="7" rx="1" fill="#181d0e"/>
    <rect x="14" y="158" width="0" height="7" rx="1" fill="url(#streakGrad)">
      <animate attributeName="width" from="0" to="${curBarW}" dur=".8s" begin=".4s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1"/>
    </rect>
    <text class="mono" x="300" y="165" font-size="7" fill="#e8c84a">${currentStreak}d</text>
    <text class="mono" x="14" y="182" font-size="7" fill="#6a7a3a" letter-spacing=".1em">ALL-TIME BEST</text>
    <rect x="14" y="186" width="280" height="7" rx="1" fill="#181d0e"/>
    <rect x="14" y="186" width="0" height="7" rx="1" fill="url(#bestGrad)">
      <animate attributeName="width" from="0" to="${bestBarW}" dur=".8s" begin=".5s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1"/>
    </rect>
    <text class="mono" x="300" y="193" font-size="7" fill="#6a7a3a">${bestStreak}d</text>
    <text class="mono" x="14" y="212" font-size="7" fill="#2a3a1a" letter-spacing=".1em">WEEKENDS EXCLUDED FROM STREAK COUNTER</text>
  </g>

  <!-- divider -->
  <line x1="340" y1="64" x2="340" y2="220" stroke="#4a5a2a" stroke-width="1" class="fu2"/>
  <polygon points="340,140 345,145 340,150 335,145" fill="#e8c84a" opacity=".3" class="fu2"/>

  <!-- DOW bars -->
  <g class="fu3">
    <text class="mono" x="358" y="78" font-size="8" fill="#6a7a3a" letter-spacing=".18em">◈ ACTIVE DAYS ◈</text>
    ${dowBars}
  </g>

  <!-- divider 2 -->
  <line x1="520" y1="64" x2="520" y2="220" stroke="#4a5a2a" stroke-width="1" class="fu3"/>
  <polygon points="520,140 525,145 520,150 515,145" fill="#e8c84a" opacity=".3" class="fu3"/>

  <!-- Hour bars -->
  <g class="fu4">
    <text class="mono" x="530" y="78" font-size="8" fill="#6a7a3a" letter-spacing=".18em">◈ ACTIVE HOURS ◈</text>
    ${hourBars}
    <text class="mono" x="530" y="212" font-size="7" fill="#2a3a1a">LAST 100 PUSH EVENTS</text>
  </g>`;

  return svgShell(W, H, "cc3", "h3", content, `${updated} UTC`);
}

// ─── MAKE pr-stats.svg ───────────────────────────────────────

function makePRSVG({
  total,
  merged,
  closed,
  open,
  mergeRate,
  additions,
  deletions,
  byMonth,
  byYear,
}) {
  const updated = new Date().toUTCString().slice(0, 16);
  const W = 720,
    H = 260;

  // Donut helpers
  function polar(cx, cy, r, deg) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }
  function slice(cx, cy, ro, ri, startDeg, endDeg, color) {
    if (endDeg - startDeg < 0.5) return "";
    if (endDeg - startDeg >= 360) endDeg = startDeg + 359.99;
    const lg = endDeg - startDeg > 180 ? 1 : 0;
    const os = polar(cx, cy, ro, startDeg),
      oe = polar(cx, cy, ro, endDeg);
    const is = polar(cx, cy, ri, endDeg),
      ie = polar(cx, cy, ri, startDeg);
    return `<path d="M${os.x.toFixed(1)},${os.y.toFixed(1)} A${ro},${ro} 0 ${lg},1 ${oe.x.toFixed(1)},${oe.y.toFixed(1)} L${is.x.toFixed(1)},${is.y.toFixed(1)} A${ri},${ri} 0 ${lg},0 ${ie.x.toFixed(1)},${ie.y.toFixed(1)} Z" fill="${color}" opacity=".9"/>`;
  }

  const cx = 110,
    cy = 152,
    ro = 65,
    ri = 40;
  const mergedDeg = total > 0 ? (merged / total) * 360 : 0;
  const closedDeg = total > 0 ? (closed / total) * 360 : 0;
  const openDeg = total > 0 ? (open / total) * 360 : 0;

  const donut = [
    slice(cx, cy, ro, ri, 0, mergedDeg, "#e8c84a"),
    slice(cx, cy, ro, ri, mergedDeg, mergedDeg + closedDeg, "#7a3010"),
    slice(
      cx,
      cy,
      ro,
      ri,
      mergedDeg + closedDeg,
      mergedDeg + closedDeg + openDeg,
      "#3a6a2a",
    ),
  ].join("");

  // Month bars
  const maxM = Math.max(...byMonth, 1);
  const curM = new Date().getMonth();
  const monthBars = byMonth
    .map((v, i) => {
      const bh = Math.max(Math.round((v / maxM) * 60), v > 0 ? 2 : 0);
      const x = 310 + i * 32,
        by = 194;
      const col = i === curM ? "#e8c84a" : "#4a6a2a";
      return `
    <rect x="${x}" y="${by - bh}" width="24" height="${bh}" rx="2" fill="${col}" opacity=".85">
      <animate attributeName="height" from="0" to="${bh}" dur=".5s" begin="${0.3 + i * 0.04}s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1"/>
      <animate attributeName="y" from="${by}" to="${by - bh}" dur=".5s" begin="${0.3 + i * 0.04}s" fill="freeze" calcMode="spline" keySplines="0.16 1 0.3 1"/>
    </rect>
    <text class="mono" x="${x + 12}" y="${by + 11}" text-anchor="middle" font-size="7" fill="#4a5a2a">${MLABELS[i]}</text>
    ${v > 0 ? `<text class="mono" x="${x + 12}" y="${by - bh - 3}" text-anchor="middle" font-size="7" fill="${col}">${v}</text>` : ""}`;
    })
    .join("");

  const content = `
  <g class="fu1">
    <text class="mono" x="14" y="22" font-size="8" fill="#6a7a3a" letter-spacing=".22em">▶ PULL REQUEST INTELLIGENCE REPORT — CLASSIFIED</text>
    <text class="hd" x="14" y="48" font-size="20" fill="#e8c84a" letter-spacing=".1em" filter="url(#goldglow)">MISSION SUBMISSION REPORT</text>
  </g>
  <g class="fu1">
    <circle class="pulse" cx="692" cy="25" r="4" fill="#4aaa4a" filter="url(#softglow)"/>
    <text class="mono" x="700" y="21" font-size="7" fill="#4a8a4a">LIVE</text>
    <text class="mono" x="700" y="31" font-size="7" fill="#3a4a1a">FEED</text>
  </g>
  <line x1="12" y1="58" x2="${W - 12}" y2="58" stroke="#e8c84a" stroke-width="1" opacity=".4" class="fu1"/>
  <line x1="12" y1="60" x2="${W - 12}" y2="60" stroke="#4a5a2a" stroke-width=".5" class="fu1"/>

  <!-- DONUT -->
  <g class="fu2">
    ${donut}
    <!-- donut hole label -->
    <text class="hd" x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="22" fill="#e8c84a" filter="url(#goldglow)">${total}</text>
    <text class="mono" x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="7" fill="#6a7a3a">TOTAL</text>

    <!-- legend -->
    <rect x="18" y="78" width="10" height="10" rx="1" fill="#e8c84a"/>
    <text class="mono" x="34" y="88" font-size="8" fill="#a8b878">MERGED</text>
    <text class="hd" x="34" y="104" font-size="20" fill="#e8c84a">${merged}</text>
    <text class="mono" x="34" y="115" font-size="7" fill="#6a7a3a">${mergeRate}% RATE</text>

    <rect x="18" y="128" width="10" height="10" rx="1" fill="#7a3010"/>
    <text class="mono" x="34" y="138" font-size="8" fill="#a8b878">CLOSED</text>
    <text class="hd" x="34" y="154" font-size="20" fill="#c8602a">${closed}</text>

    <rect x="18" y="166" width="10" height="10" rx="1" fill="#3a6a2a"/>
    <text class="mono" x="34" y="176" font-size="8" fill="#a8b878">OPEN</text>
    <text class="hd" x="34" y="192" font-size="20" fill="#4aaa4a">${open}</text>
  </g>

  <!-- divider -->
  <line x1="220" y1="64" x2="220" y2="220" stroke="#4a5a2a" stroke-width="1" class="fu2"/>
  <polygon points="220,140 225,145 220,150 215,145" fill="#e8c84a" opacity=".3" class="fu2"/>

  <!-- LINES CHANGED -->
  <g class="fu3">
    <text class="mono" x="234" y="78" font-size="8" fill="#6a7a3a" letter-spacing=".18em">◈ LINES CHANGED ◈</text>
    <text class="hd" x="234" y="120" font-size="30" fill="#4aaa4a" filter="url(#softglow)">+${fmt(additions)}</text>
    <text class="mono" x="234" y="134" font-size="7" fill="#3a7a3a" letter-spacing=".1em">LINES ADDED</text>
    <text class="hd" x="234" y="170" font-size="30" fill="#aa4422" filter="url(#softglow)">-${fmt(deletions)}</text>
    <text class="mono" x="234" y="184" font-size="7" fill="#7a3a1a" letter-spacing=".1em">LINES REMOVED</text>
    <text class="mono" x="234" y="210" font-size="7" fill="#2a3a1a">NET: ${additions - deletions >= 0 ? "+" : ""}${fmt(additions - deletions)}</text>
  </g>

  <!-- divider 2 -->
  <line x1="300" y1="64" x2="300" y2="220" stroke="#4a5a2a" stroke-width="1" class="fu3"/>
  <polygon points="300,140 305,145 300,150 295,145" fill="#e8c84a" opacity=".3" class="fu3"/>

  <!-- MONTHLY BARS -->
  <g class="fu4">
    <text class="mono" x="310" y="78" font-size="8" fill="#6a7a3a" letter-spacing=".18em">◈ PRs THIS YEAR BY MONTH ◈</text>
    ${monthBars}
  </g>`;

  return svgShell(W, H, "cc4", "h4", content, `${updated} UTC`);
}

// ─── MAIN ────────────────────────────────────────────────────

(async () => {
  console.log("Fetching all data for", USERNAME, "...");
  const [stats, monthly, activity, prStats] = await Promise.all([
    fetchStats(),
    fetchMonthly(),
    fetchActivityData(),
    fetchPRStats(),
  ]);

  console.log("Stats:", JSON.stringify(stats));
  console.log(
    "Streak:",
    activity.currentStreak,
    "/ best:",
    activity.bestStreak,
  );
  console.log("PRs:", prStats.total, "total,", prStats.merged, "merged");

  fs.writeFileSync("stats.svg", makeSVG(stats), "utf8");
  fs.writeFileSync("history.svg", makeHistorySVG(monthly), "utf8");
  fs.writeFileSync("activity.svg", makeActivitySVG(activity), "utf8");
  fs.writeFileSync("pr-stats.svg", makePRSVG(prStats), "utf8");
  console.log(
    "✅ stats.svg + history.svg + activity.svg + pr-stats.svg written",
  );
})();
