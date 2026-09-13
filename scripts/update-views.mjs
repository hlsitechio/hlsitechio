/**
 * Profile views badge — a UI element, not a stats report.
 *
 * The number is real (read from GitHub's own traffic API, which is the only
 * source GitHub exposes) but it is deliberately small and de-emphasised: it
 * is here to finish the page, not to impress anyone.
 *
 * The traffic API only ever returns a 14-day window, so the figure is labelled
 * "since <firstDay>" — never "all time". No inflation, no base= tricks.
 *
 * Runs with GH_TOKEN=secrets.GITHUB_TOKEN in CI, or a local `gh auth token`.
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

// ---- 1. the 14-day window GitHub exposes ----------------------------------
const traffic = gh(`repos/${REPO}/traffic/views?per=day`);
if (!Array.isArray(traffic.views)) {
  console.error("Unexpected traffic payload — aborting without touching files.");
  process.exit(1);
}

// ---- 2. merge into the cumulative history ---------------------------------
const history = existsSync(HISTORY) ? JSON.parse(readFileSync(HISTORY, "utf8")) : { days: {} };
history.days ||= {};

for (const v of traffic.views) {
  const day = v.timestamp.slice(0, 10);
  history.days[day] = Math.max(history.days[day] ?? 0, v.count);
}

const days = Object.keys(history.days).sort();
const totalViews = days.reduce((s, d) => s + history.days[d], 0);
const firstDay = days[0] ?? null;

// Honest label: this is a "since" figure, not all-time. The API can't do all-time.
const sinceLabel = firstDay
  ? "since " +
    new Date(firstDay + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })
  : "tracked window";

history.totalViews = totalViews;
history.lastRun = new Date().toISOString();

mkdirSync(join(ROOT, "assets"), { recursive: true });
writeFileSync(HISTORY, JSON.stringify(history, null, 2) + "\n");

// ---- 3. render: compact UI chip, number small ------------------------------
const n = (x) => x.toLocaleString("en-US");

const W = 268, H = 46;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${n(totalViews)} profile views ${sinceLabel}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0d0f1a"/>
      <stop offset="55%" stop-color="#140919"/>
      <stop offset="100%" stop-color="#16254d"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.07"/>
      <stop offset="60%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#8a7cc9"/>
      <stop offset="100%" stop-color="#3d4a85"/>
    </linearGradient>
  </defs>

  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="12" fill="url(#bg)"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="12" fill="url(#gloss)"/>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="12" fill="none" stroke="#30384a" stroke-width="1"/>

  <circle cx="22" cy="23" r="5" fill="url(#accent)"/>
  <circle cx="22" cy="23" r="8.5" fill="none" stroke="#5a4d9e" stroke-width="1" opacity="0.3"/>

  <text x="40" y="21" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="10" font-weight="600" fill="#9aa0b5" letter-spacing="1.3">PROFILE VIEWS</text>
  <text x="40" y="35" font-family="'Segoe UI',Helvetica,Arial,sans-serif" font-size="10" font-weight="500" fill="#6a7085">${n(totalViews)} · ${sinceLabel}</text>

  <rect x="${W - 46}" y="12" width="24" height="2.5" rx="1.25" fill="#30384a"/>
  <rect x="${W - 46}" y="12" width="24" height="2.5" rx="1.25" fill="url(#accent)" opacity="0.85"/>
  <rect x="${W - 46}" y="19" width="18" height="2.5" rx="1.25" fill="#30384a"/>
  <rect x="${W - 46}" y="26" width="13" height="2.5" rx="1.25" fill="#30384a"/>
  <rect x="${W - 46}" y="33" width="9" height="2.5" rx="1.25" fill="#30384a"/>
</svg>
`;

writeFileSync(OUT, svg);

console.log(`views: ${n(totalViews)} ${sinceLabel} (${days.length} days tracked) | ${n(traffic.count)} in the public 14d window / ${n(traffic.uniques)} uniq`);
