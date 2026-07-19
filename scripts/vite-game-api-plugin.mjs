/**
 * Local game APIs for `npm run dev`: leaderboard + prize wheel.
 * Production uses the Cloudflare Worker + KV instead.
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
} from "../src/game-shared.js";

const TOP_PUBLIC = 10;

function readBody(req) {
  return new Promise(async (resolve) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      resolve(JSON.parse(body || "{}"));
    } catch {
      resolve(null);
    }
  });
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

function newClaimToken() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function applyAdminAction(wheel, scores, data) {
  const action = String(data?.action || "");
  if (action === "reset") {
    wheel.winners = [];
    wheel.pending = {};
  } else if (action === "resetLeaderboard") {
    scores.length = 0;
  } else if (action === "removeLeaderboardName") {
    const name = normalizeTwitterUser(data?.name);
    if (!name) return { error: "twitter username required", status: 400 };
    const kept = scores.filter((row) => normalizeTwitterUser(row.name) !== name);
    scores.length = 0;
    scores.push(...kept);
  } else if (action === "setPrize") {
    // Free Mfer Arc name
    const prizeName = String(data?.prizeName || "").trim().slice(0, 48);
    if (!prizeName) return { error: "prize name required", status: 400 };
    wheel.prizes.free.name = prizeName;
  } else if (action === "setLimit") {
    // Free Mfer Arc limit
    const limit = Math.floor(Number(data?.limit));
    if (!Number.isFinite(limit) || limit < 0 || limit > 1000) {
      return { error: "invalid limit", status: 400 };
    }
    wheel.prizes.free.limit = limit;
  } else if (action === "setWhitelistPrize") {
    const prizeName = String(data?.prizeName || "").trim().slice(0, 48);
    if (!prizeName) return { error: "whitelist prize name required", status: 400 };
    wheel.prizes.whitelist.name = prizeName;
  } else if (action === "setWhitelistLimit") {
    const limit = Math.floor(Number(data?.limit));
    if (!Number.isFinite(limit) || limit < 0 || limit > 5000) {
      return { error: "invalid whitelist limit", status: 400 };
    }
    wheel.prizes.whitelist.limit = limit;
  } else if (action === "setPassword") {
    const next = String(data?.newPassword || "").trim();
    if (next.length < 6) return { error: "password too short", status: 400 };
    wheel.adminPassword = next;
  } else {
    return { error: "unknown action", status: 400 };
  }
  return { ok: true };
}

export function viteGameApiPlugin() {
  /** @type {Array<{ name: string, score: number, at: number, mfer: number|null }>} */
  let scores = [];
  let wheel = createWheelState();

  return {
    name: "arc-mfers-game-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] || "";

        if (url === "/api/leaderboard") {
          if (req.method === "OPTIONS") return send(res, 200, { ok: true });
          if (req.method === "GET") {
            return send(res, 200, { scores: scores.slice(0, TOP_PUBLIC) });
          }
          if (req.method === "POST") {
            const data = await readBody(req);
            if (!data) return send(res, 400, { error: "bad json" });
            const name = normalizeTwitterUser(data?.name);
            const score = Number(data?.score);
            if (!name) return send(res, 400, { error: "twitter username required" });
            if (!Number.isFinite(score) || score < 0 || score > 1_000_000) {
              return send(res, 400, { error: "invalid score" });
            }
            scores = mergeLeaderboard(scores, {
              name,
              score,
              at: Date.now(),
              mfer: data?.mfer ?? null,
            });
            return send(res, 200, { ok: true, scores: scores.slice(0, TOP_PUBLIC) });
          }
          return send(res, 405, { error: "method not allowed" });
        }

        if (url === "/api/wheel") {
          if (req.method === "OPTIONS") return send(res, 200, { ok: true });
          if (req.method === "GET") return send(res, 200, wheelPublicStatus(wheel));
          return send(res, 405, { error: "method not allowed" });
        }

        if (url === "/api/wheel/spin") {
          if (req.method === "OPTIONS") return send(res, 200, { ok: true });
          if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
          const data = await readBody(req);
          if (!data) return send(res, 400, { error: "bad json" });
          const twitter = normalizeTwitterUser(data?.twitter);
          if (!twitter) return send(res, 400, { error: "twitter username required" });

          const rolled = rollWheelPrize(wheel, twitter);
          if (rolled.result !== "prize") return send(res, 200, rolled);

          const claimToken = newClaimToken();
          wheel.pending[claimToken] = {
            twitter,
            prizeId: rolled.prizeId,
            at: Date.now(),
          };
          return send(res, 200, {
            result: "prize",
            prizeId: rolled.prizeId,
            prizeName: rolled.prizeName,
            claimToken,
            ...wheelPublicStatus(wheel),
          });
        }

        if (url === "/api/wheel/claim") {
          if (req.method === "OPTIONS") return send(res, 200, { ok: true });
          if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
          const data = await readBody(req);
          if (!data) return send(res, 400, { error: "bad json" });
          const twitter = normalizeTwitterUser(data?.twitter);
          const wallet = normalizeWallet(data?.wallet);
          const claimToken = String(data?.claimToken || "");
          if (!twitter) return send(res, 400, { error: "twitter username required" });
          if (!wallet) return send(res, 400, { error: "valid wallet address required (0x…)" });
          if (!claimToken || !wheel.pending[claimToken]) {
            return send(res, 400, { error: "invalid or expired claim" });
          }
          const pending = wheel.pending[claimToken];
          if (pending.twitter !== twitter) {
            return send(res, 400, { error: "twitter does not match spin" });
          }
          const prizeId = pending.prizeId || "free";
          const prize = wheel.prizes[prizeId];
          if (!prize) {
            delete wheel.pending[claimToken];
            return send(res, 400, { error: "unknown prize" });
          }
          if (wheel.winners.some((w) => w.twitter === twitter && (w.prizeId || "free") === prizeId)) {
            delete wheel.pending[claimToken];
            return send(res, 400, { error: "already claimed this prize" });
          }
          if (wheel.winners.some((w) => normalizeWallet(w.wallet) === wallet)) {
            return send(res, 400, { error: "this wallet already claimed a prize" });
          }
          if (countPrizeClaims(wheel, prizeId) >= prize.limit) {
            delete wheel.pending[claimToken];
            return send(res, 200, { result: "unavailable", ...wheelPublicStatus(wheel) });
          }

          delete wheel.pending[claimToken];
          wheel.winners.push({
            twitter,
            wallet,
            prizeId,
            prizeName: prize.name,
            at: Date.now(),
          });
          return send(res, 200, {
            ok: true,
            prizeId,
            prizeName: prize.name,
            ...wheelPublicStatus(wheel),
          });
        }

        if (url === "/api/wheel/admin") {
          if (req.method === "OPTIONS") return send(res, 200, { ok: true });
          if (req.method === "GET") {
            return send(res, 200, {
              ...wheelPublicStatus(wheel),
              winners: wheel.winners,
              leaderboard: scores.slice(0, TOP_PUBLIC),
              leaderboardCount: scores.length,
            });
          }
          if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
          const data = await readBody(req);
          if (!data) return send(res, 400, { error: "bad json" });
          if (String(data?.password || "") !== wheel.adminPassword) {
            return send(res, 401, { error: "bad password" });
          }

          const result = applyAdminAction(wheel, scores, data);
          if (result.error) return send(res, result.status, { error: result.error });

          return send(res, 200, {
            ok: true,
            ...wheelPublicStatus(wheel),
            winners: wheel.winners,
            leaderboard: scores.slice(0, TOP_PUBLIC),
            leaderboardCount: scores.length,
            saved: serializeWheelState(wheel),
          });
        }

        next();
      });
    },
  };
}
