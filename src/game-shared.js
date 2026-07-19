/** Shared game constants (tutorial + canvas use the same icons). */

export const PICKUP_EMOJI = {
  boost: "⚡",
  hazard: "💥",
  wheel: "🎡",
};

export const TWITTER_HANDLE = "arc_mfers";

export const WHEEL_ZONK_CHANCE = 0.99; // 1% prize
export const WHEEL_DEFAULT_PRIZE = "Free Mfer Arc";
export const WHEEL_DEFAULT_LIMIT = 3;

export function normalizeTwitterUser(raw) {
  return String(raw || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .slice(0, 15);
}

export function normalizeWallet(raw) {
  const w = String(raw || "").trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(w)) return w.toLowerCase();
  return "";
}

export function buildScoreTweet({ score, username }) {
  const who = username ? `@${username}` : "I";
  return `${who} just climbed ${score} on the ARC mfers ladder 🧗 Can you beat that? @${TWITTER_HANDLE} #arcmfers\n\nBoard resets every Sunday.`;
}

export function buildPrizeTweet({ prizeName, username }) {
  const who = username ? `@${username}` : "I";
  return `${who} just spun the 🎡 and won ${prizeName} on ARC mfers 🔥 @${TWITTER_HANDLE} #arcmfers`;
}

export function tweetIntentUrl(text) {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

/** Keep top N scores, one best entry per twitter user. */
export function mergeLeaderboard(list, entry, limit = 50) {
  const next = Array.isArray(list) ? [...list] : [];
  const name = normalizeTwitterUser(entry.name);
  if (!name || typeof entry.score !== "number" || !Number.isFinite(entry.score)) {
    return next;
  }
  const score = Math.max(0, Math.floor(entry.score));
  const filtered = next.filter((row) => normalizeTwitterUser(row.name) !== name);
  filtered.push({
    name,
    score,
    at: entry.at || Date.now(),
    mfer: entry.mfer ?? null,
  });
  return filtered.sort((a, b) => b.score - a.score || a.at - b.at).slice(0, limit);
}

export function createWheelState(overrides = {}) {
  return {
    prizeName: WHEEL_DEFAULT_PRIZE,
    limit: WHEEL_DEFAULT_LIMIT,
    winners: [],
    pending: {},
    adminPassword: "arc-wheel-2026",
    ...overrides,
  };
}

export function wheelPublicStatus(state) {
  const claimed = state.winners.length;
  const remaining = Math.max(0, state.limit - claimed);
  return {
    prizeName: state.prizeName,
    limit: state.limit,
    claimed,
    remaining,
    available: remaining > 0,
  };
}
