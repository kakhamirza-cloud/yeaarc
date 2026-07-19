/** Shared game constants (tutorial + canvas use the same icons). */

export const PICKUP_EMOJI = {
  boost: "⚡",
  hazard: "💥",
  wheel: "🎡",
};

export const TWITTER_HANDLE = "arc_mfers";

/** Fixed spin bands: 1% free · 30% whitelist · 69% zonk */
export const WHEEL_FREE_CHANCE = 0.01;
export const WHEEL_WHITELIST_CHANCE = 0.3;

export const WHEEL_DEFAULT_PRIZE = "Free Mfer Arc";
export const WHEEL_DEFAULT_LIMIT = 3;
export const WHEEL_DEFAULT_WHITELIST = "Whitelist spot";
export const WHEEL_DEFAULT_WHITELIST_LIMIT = 50;

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

export function defaultPrizes() {
  return {
    free: {
      id: "free",
      name: WHEEL_DEFAULT_PRIZE,
      limit: WHEEL_DEFAULT_LIMIT,
      chance: WHEEL_FREE_CHANCE,
    },
    whitelist: {
      id: "whitelist",
      name: WHEEL_DEFAULT_WHITELIST,
      limit: WHEEL_DEFAULT_WHITELIST_LIMIT,
      chance: WHEEL_WHITELIST_CHANCE,
    },
  };
}

export function createWheelState(overrides = {}) {
  const prizes = defaultPrizes();
  if (overrides.prizes && typeof overrides.prizes === "object") {
    for (const id of Object.keys(prizes)) {
      const incoming = overrides.prizes[id];
      if (!incoming || typeof incoming !== "object") continue;
      prizes[id] = {
        ...prizes[id],
        ...incoming,
        id,
        // odds stay fixed in code so rigging the admin UI can't break the published split
        chance: prizes[id].chance,
      };
    }
  }

  // Migrate legacy single-prize KV shape
  if (overrides.prizeName) prizes.free.name = String(overrides.prizeName).slice(0, 48);
  if (overrides.limit != null && Number.isFinite(Number(overrides.limit))) {
    prizes.free.limit = Math.max(0, Math.floor(Number(overrides.limit)));
  }

  const winners = Array.isArray(overrides.winners)
    ? overrides.winners.map((w) => ({
        twitter: normalizeTwitterUser(w.twitter),
        wallet: normalizeWallet(w.wallet) || String(w.wallet || "").toLowerCase(),
        prizeId: w.prizeId || "free",
        prizeName: w.prizeName || prizes.free.name,
        at: w.at || Date.now(),
      }))
    : [];

  return {
    prizes,
    winners,
    pending:
      overrides.pending && typeof overrides.pending === "object" ? overrides.pending : {},
    adminPassword: overrides.adminPassword || "arc-wheel-2026",
  };
}

export function countPrizeClaims(state, prizeId) {
  return state.winners.filter((w) => (w.prizeId || "free") === prizeId).length;
}

export function wheelPublicStatus(state) {
  const prizes = Object.values(state.prizes).map((p) => {
    const claimed = countPrizeClaims(state, p.id);
    const remaining = Math.max(0, p.limit - claimed);
    return {
      id: p.id,
      name: p.name,
      limit: p.limit,
      chance: p.chance,
      claimed,
      remaining,
      available: remaining > 0,
    };
  });
  return {
    prizes,
    available: prizes.some((p) => p.available),
    odds: { free: WHEEL_FREE_CHANCE, whitelist: WHEEL_WHITELIST_CHANCE, zonk: 0.69 },
  };
}

/** Roll against fixed bands; sold-out / already-owned tiers become Zonk. */
export function rollWheelPrize(state, twitter) {
  const status = wheelPublicStatus(state);
  if (!status.available) return { result: "unavailable", ...status };

  const wonIds = new Set(
    state.winners
      .filter((w) => w.twitter === twitter)
      .map((w) => w.prizeId || "free")
  );
  const canWin = status.prizes.some((p) => p.available && !wonIds.has(p.id));
  if (!canWin) {
    return {
      result: "zonk",
      reason: "already_won",
      message: "You already claimed the prizes still available.",
      ...status,
    };
  }

  const free = status.prizes.find((p) => p.id === "free");
  const wl = status.prizes.find((p) => p.id === "whitelist");
  const r = Math.random();

  if (r < WHEEL_FREE_CHANCE) {
    if (free?.available && !wonIds.has("free")) {
      return { result: "prize", prizeId: "free", prizeName: free.name, ...status };
    }
    return { result: "zonk", ...status };
  }
  if (r < WHEEL_FREE_CHANCE + WHEEL_WHITELIST_CHANCE) {
    if (wl?.available && !wonIds.has("whitelist")) {
      return { result: "prize", prizeId: "whitelist", prizeName: wl.name, ...status };
    }
    return { result: "zonk", ...status };
  }
  return { result: "zonk", ...status };
}

export function serializeWheelState(state) {
  return {
    prizes: state.prizes,
    winners: state.winners,
    pending: state.pending,
    adminPassword: state.adminPassword,
  };
}
