/**
 * Cloudflare Worker: static site + leaderboard + prize wheel (KV).
 */
import {
  mergeLeaderboard,
  normalizeTwitterUser,
  normalizeWallet,
  createWheelState,
  wheelPublicStatus,
  WHEEL_ZONK_CHANCE,
} from "./game-shared.js";

const LB_KEY = "climb-v1";
const WHEEL_KEY = "wheel-v1";
const MAX_STORE = 50;
const TOP_PUBLIC = 10;

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
  await env.LEADERBOARD.put(
    WHEEL_KEY,
    JSON.stringify({
      prizeName: state.prizeName,
      limit: state.limit,
      winners: state.winners,
      pending: state.pending,
      adminPassword: state.adminPassword,
    })
  );
}

function newClaimToken() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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
    const status = wheelPublicStatus(wheel);
    if (!status.available) return json({ result: "unavailable", ...status });
    if (wheel.winners.some((w) => w.twitter === twitter)) {
      return json({
        result: "zonk",
        reason: "already_won",
        message: `You already claimed ${wheel.prizeName}.`,
        ...status,
      });
    }
    if (Math.random() < WHEEL_ZONK_CHANCE) return json({ result: "zonk", ...status });
    const claimToken = newClaimToken();
    wheel.pending[claimToken] = { twitter, at: Date.now() };
    await writeWheel(env, wheel);
    return json({
      result: "prize",
      prizeName: wheel.prizeName,
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
    if (wheel.pending[claimToken].twitter !== twitter) {
      return json({ error: "twitter does not match spin" }, 400);
    }
    if (wheel.winners.some((w) => w.twitter === twitter)) {
      delete wheel.pending[claimToken];
      await writeWheel(env, wheel);
      return json({ error: "already claimed" }, 400);
    }
    if (wheel.winners.some((w) => normalizeWallet(w.wallet) === wallet)) {
      return json({ error: "this wallet already claimed a prize" }, 400);
    }
    if (wheel.winners.length >= wheel.limit) {
      delete wheel.pending[claimToken];
      await writeWheel(env, wheel);
      return json({ result: "unavailable", ...wheelPublicStatus(wheel) });
    }
    delete wheel.pending[claimToken];
    wheel.winners.push({ twitter, wallet, prizeName: wheel.prizeName, at: Date.now() });
    await writeWheel(env, wheel);
    return json({ ok: true, prizeName: wheel.prizeName, ...wheelPublicStatus(wheel) });
  }

  if (pathname === "/api/wheel/admin") {
    if (request.method === "GET") {
      const wheel = await readWheel(env);
      const board = await readBoard(env);
      return json({
        ...wheelPublicStatus(wheel),
        winners: wheel.winners.map((w) => ({
          twitter: w.twitter,
          wallet: w.wallet,
          prizeName: w.prizeName,
          at: w.at,
        })),
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
      let board = await readBoard(env);
      if (action === "reset") {
        wheel.winners = [];
        wheel.pending = {};
      } else if (action === "resetLeaderboard") {
        board = [];
        await writeBoard(env, board);
      } else if (action === "removeLeaderboardName") {
        const name = normalizeTwitterUser(body?.name);
        if (!name) return json({ error: "twitter username required" }, 400);
        board = board.filter((row) => normalizeTwitterUser(row.name) !== name);
        await writeBoard(env, board);
      } else if (action === "setLimit") {
        const limit = Math.floor(Number(body?.limit));
        if (!Number.isFinite(limit) || limit < 0 || limit > 1000) {
          return json({ error: "invalid limit" }, 400);
        }
        wheel.limit = limit;
      } else if (action === "setPrize") {
        const prizeName = String(body?.prizeName || "").trim().slice(0, 48);
        if (!prizeName) return json({ error: "prize name required" }, 400);
        wheel.prizeName = prizeName;
      } else if (action === "setPassword") {
        const next = String(body?.newPassword || "").trim();
        if (next.length < 6) return json({ error: "password too short" }, 400);
        wheel.adminPassword = next;
      } else {
        return json({ error: "unknown action" }, 400);
      }
      await writeWheel(env, wheel);
      board = await readBoard(env);
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

function rewriteAssetPath(pathname) {
  if (pathname === "/mint" || pathname === "/mint/") return "/mint.html";
  if (pathname === "/game" || pathname === "/game/") return "/game.html";
  if (pathname === "/game-admin" || pathname === "/game-admin/") return "/game-admin.html";
  if (pathname === "/" || pathname === "") return "/index.html";
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/leaderboard") return handleLeaderboard(request, env);
    if (pathname.startsWith("/api/wheel")) return handleWheel(request, env, pathname);

    const rewritten = rewriteAssetPath(pathname);
    if (rewritten && env.ASSETS) {
      return env.ASSETS.fetch(new Request(new URL(rewritten, url.origin), request));
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  },
};
