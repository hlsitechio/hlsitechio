/**
 * Self-hosted profile view badge.
 *
 * Reads GitHub's own traffic API (source of truth, no third party), keeps a
 * cumulative history in assets/views-history.json, and renders assets/views.svg
 * in Hubert's palette.
 *
 * The GitHub traffic API only exposes a 14-day window, so the history file is
 * what makes a real all-time number possible: every run merges the window into
 * the history and keeps whatever it has already seen.
 *
 * Runs in CI with GH_TOKEN=secrets.GITHUB_TOKEN (push access to this repo is
 * enough to read its own traffic), and locally with a `gh auth token`.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = process.env.VIEWS_REPO || "hlsitechio/hlsitechio";
const HISTORY = join(ROOT, "assets", "views-history.json");
const OUT = join(ROOT, "assets", "views.svg");

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || execSync("gh auth token").toString().trim();

function gh(path) {
  return JSON.parse(
    execSync(`gh api "${path}"`, {
      env: { ...process.env, GH_TOKEN: token },
      stdio: ["ignore", "pipe", "ignore"],
    }).toString()
  );
}

// ---- 1. fetch the 14-day window from GitHub -------------------------------
const traffic = gh(`repos/${REPO}/traffic/views?per=day`);
if (!Array.isArray(traffic.views)) {
  console.error("Unexpected traffic payload — aborting without touching files.");
  process.exit(1);
}

// ---- 2. merge into the cumulative history ---------------------------------
const history = existsSync(HISTORY) ? JSON.parse(readFileSync(HISTORY, "utf8")) : { days: {} };
history.days ||= {};

let added = 0;
for (const v of traffic.views) {
  const day = v.timestamp.slice(0, 10);
  if (!(day in history.days)) added++;
  // keep the max ever seen for a day (counts are stable once a day is over)
  history.days[day] = Math.max(history.days[day] ?? 0, v.count);
}

const days = Object.keys(history.days).sort();
const totalViews = days.reduce((s, d) => s + history.days[d], 0);

// 14-day window straight from the API
const winViews = traffic.views.reduce((s, v) => s + v.count, 0);
const winUniques = traffic.uniques ?? traffic.views.reduce((s, v) => s + v.uniques, 0);

// trailing 30-day from our own history
const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
const views30 = days.filter((d) => d >= cutoff).reduce((s, d) => s + history.days[d], 0);

history.totalViews = totalViews;
history.uniquesAllTime = Math.max(history.uniquesAllTime ?? 0, traffic.uniques ?? 0);
history.lastRun = new Date().toISOString();

mkdirSync(join(ROOT, "assets"), { recursive: true });
writeFileSync(HISTORY, JSON.stringify(history, null, 2) + "\n");

// ---- 3. render the SVG in Hubert's palette --------------------------------
const n = (x) => x.toLocaleString("en-US");

const W = 320, H = 132;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Profile views: ${n(totalViews)} all time, ${n(views30)} in the last 30 days">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d0f1a"/>
      <stop offset="55%" stop-color="#140919"/>
      <stop offset="100%" stop-color="#16254d"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8a7cc9"/>
      <stop offset="50%" stop-color="#5a4d9e"/>
      <stop offset="100%" stop-color="#3d4a85"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.07"/>
      <stop offset="60%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="soft" x="-20%" y="-40%" width="140%" height="180%">
      <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#000000" flood-opacity="0.55"/>
    </filter>
  </defs>

  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="url(#bg)"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="url(#gloss)"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="none" stroke="#30384a" stroke-width="1"/>

  <text x="20" y="32" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="11" font-weight="600" fill="#9aa0b5" letter-spacing="1.6">PROFILE VIEWS</text>

  <text x="20" y="76" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="42" font-weight="700" fill="#f5f3fc">${n(totalViews)}</text>

  <text x="20" y="100" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="11" font-weight="500" fill="#8a7cc9">${n(views30)} in the last 30 days</text>

  <rect x="20" y="112" width="${W - 40}" height="3" rx="1.5" fill="#30384a"/>
  <rect x="20" y="112" width="${Math.max(6, Math.min(1, views30 / Math.max(1, totalViews)) * (W - 40)).toFixed(0)}" height="3" rx="1.5" fill="url(#accent)"/>

  <circle cx="${W - 34}" cy="34" r="5" fill="url(#accent)"/>
  <circle cx="${W - 34}" cy="34" r="9" fill="none" stroke="#5a4d9e" stroke-width="1" opacity="0.35"/>
</svg>
`;

writeFileSync(OUT, svg);

console.log(`views: ${n(totalViews)} all-time (${days.length} days tracked) | ${n(views30)} last 30d | ${n(winViews)} last 14d / ${n(winUniques)} uniq | +${added} new day(s)`);
