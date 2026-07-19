/**
 * Cloudflare Worker: static site + leaderboard + prize wheel (KV).
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
  await env.LEADERBOARD.put(WHEEL_KEY, JSON.stringify(serializeWheelState(state)));
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
