/**
 * Cloudflare Worker: static site + leaderboard + prize wheel + prediction (KV).
 */
import {
  mergeLeaderboard,
  normalizeTwitterUser,
  normalizeWallet,
  createWheelState,
  wheelPublicStatus,
  rollWheelPrize,
  serializeWheelState,
  countPrizeClaims,
} from "./game-shared.js";
import { isMintWhitelisted } from "./mint-whitelist.js";
import {
  createPredictionState,
  claimFaucet,
  placeBet,
  ensureOpenMarkets,
  resolveExpiredMarkets,
  forceResolveOpenMarket,
  snapshotState,
} from "./prediction-shared.js";

const LB_KEY = "climb-v1";
const WHEEL_KEY = "wheel-v1";
const WL_APPLY_KEY = "wl-apply-v1";
const PREDICTION_KEY = "prediction-v1";
const MAX_STORE = 50;
const TOP_PUBLIC = 10;
const MAX_WL_APPLIES = 5000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

async function readBoard(env) {
  if (!env.LEADERBOARD) return [];
  try {
    const raw = await env.LEADERBOARD.get(LB_KEY, "json");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeBoard(env, list) {
  await env.LEADERBOARD.put(LB_KEY, JSON.stringify(list.slice(0, MAX_STORE)));
}

async function readWheel(env) {
  if (!env.LEADERBOARD) return createWheelState();
  try {
    const raw = await env.LEADERBOARD.get(WHEEL_KEY, "json");
    return createWheelState(raw && typeof raw === "object" ? raw : {});
  } catch {
    return createWheelState();
  }
}

async function writeWheel(env, state) {
  await env.LEADERBOARD.put(WHEEL_KEY, JSON.stringify(serializeWheelState(state)));
}

async function readWlApplies(env) {
  if (!env.LEADERBOARD) return [];
  try {
    const raw = await env.LEADERBOARD.get(WL_APPLY_KEY, "json");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function writeWlApplies(env, list) {
  await env.LEADERBOARD.put(WL_APPLY_KEY, JSON.stringify(list.slice(0, MAX_WL_APPLIES)));
}

async function readPrediction(env) {
  if (!env.LEADERBOARD) return createPredictionState();
  try {
    const raw = await env.LEADERBOARD.get(PREDICTION_KEY, "json");
    return createPredictionState(raw && typeof raw === "object" ? raw : {});
  } catch {
    return createPredictionState();
  }
}

async function writePrediction(env, state) {
  // Never persist a client-facing dump — state stays server-side in KV
  await env.LEADERBOARD.put(
    PREDICTION_KEY,
    JSON.stringify({
      adminPassword: state.adminPassword,
      publicOpen: Boolean(state.publicOpen),
      players: state.players || {},
      markets: Array.isArray(state.markets) ? state.markets.slice(0, 40) : [],
    })
  );
}

function newClaimToken() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function applyAdminAction(wheel, data) {
  const action = String(data?.action || "");
  if (action === "reset") {
    wheel.winners = [];
    wheel.pending = {};
    return { ok: true };
  }
  if (action === "setPrize") {
    const prizeName = String(data?.prizeName || "").trim().slice(0, 48);
    if (!prizeName) return { error: "prize name required", status: 400 };
    wheel.prizes.free.name = prizeName;
    return { ok: true };
  }
  if (action === "setLimit") {
    const limit = Math.floor(Number(data?.limit));
    if (!Number.isFinite(limit) || limit < 0 || limit > 1000) {
      return { error: "invalid limit", status: 400 };
    }
    wheel.prizes.free.limit = limit;
    return { ok: true };
  }
  if (action === "setWhitelistPrize") {
    const prizeName = String(data?.prizeName || "").trim().slice(0, 48);
    if (!prizeName) return { error: "whitelist prize name required", status: 400 };
    wheel.prizes.whitelist.name = prizeName;
    return { ok: true };
  }
  if (action === "setWhitelistLimit") {
    const limit = Math.floor(Number(data?.limit));
    if (!Number.isFinite(limit) || limit < 0 || limit > 5000) {
      return { error: "invalid whitelist limit", status: 400 };
    }
    wheel.prizes.whitelist.limit = limit;
    return { ok: true };
  }
  if (action === "setPassword") {
    const next = String(data?.newPassword || "").trim();
    if (next.length < 6) return { error: "password too short", status: 400 };
    wheel.adminPassword = next;
    return { ok: true };
  }
  return { error: "unknown action", status: 400 };
}

async function handleChecker(request) {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const wallet = normalizeWallet(body?.wallet);
  if (!wallet) return json({ error: "valid wallet address required (0x…)" }, 400);

  return json({ whitelisted: isMintWhitelisted(wallet) });
}

async function handleWlApply(request, env) {
  if (request.method === "OPTIONS") return json({ ok: true });

  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === "/api/wl-apply" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad json" }, 400);
    }

    const wallet = normalizeWallet(body?.wallet);
    if (!wallet) return json({ error: "valid wallet address required (0x…)" }, 400);
    if (!body?.followed || !body?.retweetedLiked) {
      return json({ error: "confirm follow + retweet & like first" }, 400);
    }

    const twitter = normalizeTwitterUser(body?.twitter) || null;
    const list = await readWlApplies(env);
    const idx = list.findIndex((row) => normalizeWallet(row.wallet) === wallet);
    const entry = {
      wallet,
      twitter,
      followed: true,
      retweetedLiked: true,
      at: Date.now(),
    };

    let updated = false;
    if (idx >= 0) {
      list[idx] = entry;
      updated = true;
    } else {
      list.unshift(entry);
    }

    await writeWlApplies(env, list);
    return json({ ok: true, updated });
  }

  if (pathname === "/api/wl-apply/admin" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad json" }, 400);
    }

    const wheel = await readWheel(env);
    if (String(body?.password || "") !== wheel.adminPassword) {
      return json({ error: "bad password" }, 401);
    }

    const action = String(body?.action || "list");
    if (action === "clear") {
      await writeWlApplies(env, []);
      return json({ ok: true, applications: [] });
    }

    const applications = await readWlApplies(env);
    return json({ ok: true, applications, count: applications.length });
  }

  return json({ error: "method not allowed" }, 405);
}

async function handleLeaderboard(request, env) {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method === "GET") {
    return json({ scores: (await readBoard(env)).slice(0, TOP_PUBLIC) });
  }
  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad json" }, 400);
    }
    const name = normalizeTwitterUser(body?.name);
    const score = Number(body?.score);
    if (!name) return json({ error: "twitter username required" }, 400);
    if (!Number.isFinite(score) || score < 0 || score > 1_000_000) {
      return json({ error: "invalid score" }, 400);
    }
    const list = mergeLeaderboard(await readBoard(env), {
      name,
      score,
      at: Date.now(),
      mfer: body?.mfer ?? null,
    });
    await writeBoard(env, list);
    return json({ ok: true, scores: list.slice(0, TOP_PUBLIC) });
  }
  return json({ error: "method not allowed" }, 405);
}

async function handleWheel(request, env, pathname) {
  if (request.method === "OPTIONS") return json({ ok: true });

  if (pathname === "/api/wheel" && request.method === "GET") {
    return json(wheelPublicStatus(await readWheel(env)));
  }

  if (pathname === "/api/wheel/spin" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad json" }, 400);
    }
    const twitter = normalizeTwitterUser(body?.twitter);
    if (!twitter) return json({ error: "twitter username required" }, 400);
    const wheel = await readWheel(env);
    const rolled = rollWheelPrize(wheel, twitter);
    if (rolled.result !== "prize") return json(rolled);

    const claimToken = newClaimToken();
    wheel.pending[claimToken] = {
      twitter,
      prizeId: rolled.prizeId,
      at: Date.now(),
    };
    await writeWheel(env, wheel);
    return json({
      result: "prize",
      prizeId: rolled.prizeId,
      prizeName: rolled.prizeName,
      claimToken,
      ...wheelPublicStatus(wheel),
    });
  }

  if (pathname === "/api/wheel/claim" && request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad json" }, 400);
    }
    const twitter = normalizeTwitterUser(body?.twitter);
    const wallet = normalizeWallet(body?.wallet);
    const claimToken = String(body?.claimToken || "");
    const wheel = await readWheel(env);
    if (!twitter) return json({ error: "twitter username required" }, 400);
    if (!wallet) return json({ error: "valid wallet address required (0x…)" }, 400);
    if (!claimToken || !wheel.pending[claimToken]) {
      return json({ error: "invalid or expired claim" }, 400);
    }
    const pending = wheel.pending[claimToken];
    if (pending.twitter !== twitter) {
      return json({ error: "twitter does not match spin" }, 400);
    }
    const prizeId = pending.prizeId || "free";
    const prize = wheel.prizes[prizeId];
    if (!prize) {
      delete wheel.pending[claimToken];
      await writeWheel(env, wheel);
      return json({ error: "unknown prize" }, 400);
    }
    if (wheel.winners.some((w) => w.twitter === twitter && (w.prizeId || "free") === prizeId)) {
      delete wheel.pending[claimToken];
      await writeWheel(env, wheel);
      return json({ error: "already claimed this prize" }, 400);
    }
    if (wheel.winners.some((w) => normalizeWallet(w.wallet) === wallet)) {
      return json({ error: "this wallet already claimed a prize" }, 400);
    }
    if (countPrizeClaims(wheel, prizeId) >= prize.limit) {
      delete wheel.pending[claimToken];
      await writeWheel(env, wheel);
      return json({ result: "unavailable", ...wheelPublicStatus(wheel) });
    }
    delete wheel.pending[claimToken];
    wheel.winners.push({
      twitter,
      wallet,
      prizeId,
      prizeName: prize.name,
      at: Date.now(),
    });
    await writeWheel(env, wheel);
    return json({
      ok: true,
      prizeId,
      prizeName: prize.name,
      ...wheelPublicStatus(wheel),
    });
  }

  if (pathname === "/api/wheel/admin") {
    if (request.method === "GET") {
      const wheel = await readWheel(env);
      const board = await readBoard(env);
      return json({
        ...wheelPublicStatus(wheel),
        winners: wheel.winners,
        leaderboard: board.slice(0, TOP_PUBLIC),
        leaderboardCount: board.length,
      });
    }
    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "bad json" }, 400);
      }
      const wheel = await readWheel(env);
      if (String(body?.password || "") !== wheel.adminPassword) {
        return json({ error: "bad password" }, 401);
      }

      const action = String(body?.action || "");
      if (action === "resetLeaderboard") {
        await writeBoard(env, []);
      } else if (action === "removeLeaderboardName") {
        const name = normalizeTwitterUser(body?.name);
        if (!name) return json({ error: "twitter username required" }, 400);
        const board = (await readBoard(env)).filter(
          (row) => normalizeTwitterUser(row.name) !== name
        );
        await writeBoard(env, board);
      } else {
        const result = applyAdminAction(wheel, body);
        if (result.error) return json({ error: result.error }, result.status);
        await writeWheel(env, wheel);
      }

      // Persist wheel after reset / prize edits
      if (action === "reset") await writeWheel(env, wheel);

      const board = await readBoard(env);
      return json({
        ok: true,
        ...wheelPublicStatus(wheel),
        winners: wheel.winners,
        leaderboard: board.slice(0, TOP_PUBLIC),
        leaderboardCount: board.length,
      });
    }
  }

  return json({ error: "method not allowed" }, 405);
}

async function requireWhitelistedWallet(body) {
  const wallet = normalizeWallet(body?.wallet);
  if (!wallet) return { error: "valid wallet address required (0x…)", status: 400 };
  if (!isMintWhitelisted(wallet)) {
    return { error: "wallet not on mint whitelist — access denied", status: 403, wallet };
  }
  return { wallet };
}

async function handlePrediction(request, env, pathname) {
  if (request.method === "OPTIONS") return json({ ok: true });
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  // Admin only — same password as wheel admin (keeps one secret for ops)
  if (pathname === "/api/prediction/admin") {
    const wheel = await readWheel(env);
    const prediction = await readPrediction(env);
    const password = String(body?.password || "");
    if (password !== wheel.adminPassword && password !== prediction.adminPassword) {
      return json({ error: "bad password" }, 401);
    }

    const action = String(body?.action || "");
    if (action === "forceResolve") {
      const forced = forceResolveOpenMarket(prediction);
      if (forced.error) return json({ error: forced.error }, forced.status);
      await writePrediction(env, prediction);
      return json({
        ok: true,
        ...snapshotState(prediction, body?.wallet),
        playerCount: Object.keys(prediction.players).length,
        marketCount: prediction.markets.length,
      });
    }
    if (action === "status") {
      ensureOpenMarkets(prediction);
      resolveExpiredMarkets(prediction);
      await writePrediction(env, prediction);
      return json({
        ok: true,
        publicOpen: prediction.publicOpen,
        ...snapshotState(prediction, body?.wallet),
        playerCount: Object.keys(prediction.players).length,
        marketCount: prediction.markets.length,
      });
    }
    if (action === "reset") {
      // Wipe desk for a clean public test
      const fresh = createPredictionState({
        adminPassword: prediction.adminPassword,
      });
      ensureOpenMarkets(fresh);
      await writePrediction(env, fresh);
      return json({
        ok: true,
        reset: true,
        ...snapshotState(fresh, null),
        playerCount: 0,
        marketCount: fresh.markets.length,
      });
    }
    return json({ error: "unknown action" }, 400);
  }

  if (pathname === "/api/prediction/enter") {
    const gate = await requireWhitelistedWallet(body);
    if (gate.error) return json({ error: gate.error, whitelisted: false }, gate.status);
    const prediction = await readPrediction(env);
    ensureOpenMarkets(prediction);
    resolveExpiredMarkets(prediction);
    await writePrediction(env, prediction);
    return json({
      ok: true,
      whitelisted: true,
      ...snapshotState(prediction, gate.wallet),
    });
  }

  if (pathname === "/api/prediction/faucet") {
    const gate = await requireWhitelistedWallet(body);
    if (gate.error) return json({ error: gate.error }, gate.status);
    const prediction = await readPrediction(env);
    const result = claimFaucet(prediction, gate.wallet);
    if (result.error) return json({ error: result.error }, result.status);
    await writePrediction(env, prediction);
    return json({ ...result, ...snapshotState(prediction, gate.wallet) });
  }

  if (pathname === "/api/prediction/bet") {
    const gate = await requireWhitelistedWallet(body);
    if (gate.error) return json({ error: gate.error }, gate.status);
    const prediction = await readPrediction(env);
    ensureOpenMarkets(prediction);
    const result = placeBet(prediction, {
      wallet: gate.wallet,
      marketId: body?.marketId,
      side: body?.side,
      amount: body?.amount,
    });
    if (result.error) return json({ error: result.error }, result.status);
    await writePrediction(env, prediction);
    return json({ ...result, ...snapshotState(prediction, gate.wallet) });
  }

  if (pathname === "/api/prediction/state") {
    const gate = await requireWhitelistedWallet(body);
    if (gate.error) return json({ error: gate.error }, gate.status);
    const prediction = await readPrediction(env);
    ensureOpenMarkets(prediction);
    resolveExpiredMarkets(prediction);
    await writePrediction(env, prediction);
    return json(snapshotState(prediction, gate.wallet));
  }

  return json({ error: "not found" }, 404);
}

function rewriteAssetPath(pathname) {
  if (pathname === "/mint" || pathname === "/mint/") return "/mint.html";
  if (pathname === "/game" || pathname === "/game/") return "/game.html";
  if (pathname === "/game-admin" || pathname === "/game-admin/") return "/game-admin.html";
  if (pathname === "/checker" || pathname === "/checker/") return "/checker.html";
  if (pathname === "/prediction" || pathname === "/prediction/") return "/prediction.html";
  if (pathname === "/prediction-admin" || pathname === "/prediction-admin/") return "/prediction-admin.html";
  if (pathname === "/portfolio" || pathname === "/portfolio/") return "/portfolio.html";
  if (pathname === "/apply" || pathname === "/apply/") return "/apply.html";
  if (pathname === "/apply-admin" || pathname === "/apply-admin/") return "/apply-admin.html";
  if (pathname === "/" || pathname === "") return "/index.html";
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/checker") return handleChecker(request);
    if (pathname.startsWith("/api/wl-apply")) return handleWlApply(request, env);
    if (pathname === "/api/leaderboard") return handleLeaderboard(request, env);
    if (pathname.startsWith("/api/wheel")) return handleWheel(request, env, pathname);
    if (pathname.startsWith("/api/prediction")) return handlePrediction(request, env, pathname);

    const rewritten = rewriteAssetPath(pathname);
    if (rewritten && env.ASSETS) {
      return env.ASSETS.fetch(new Request(new URL(rewritten, url.origin), request));
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
