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
  WHEEL_ZONK_CHANCE,
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

          const status = wheelPublicStatus(wheel);
          if (!status.available) {
            return send(res, 200, { result: "unavailable", ...status });
          }

          const already = wheel.winners.some((w) => w.twitter === twitter);
          if (already) {
            return send(res, 200, {
              result: "zonk",
              reason: "already_won",
              message: `You already claimed ${wheel.prizeName}.`,
              ...status,
            });
          }

          const roll = Math.random();
          if (roll < WHEEL_ZONK_CHANCE) {
            return send(res, 200, { result: "zonk", ...status });
          }

          const claimToken = newClaimToken();
          wheel.pending[claimToken] = { twitter, at: Date.now() };
          return send(res, 200, {
            result: "prize",
            prizeName: wheel.prizeName,
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
          if (wheel.pending[claimToken].twitter !== twitter) {
            return send(res, 400, { error: "twitter does not match spin" });
          }
          if (wheel.winners.some((w) => w.twitter === twitter)) {
            delete wheel.pending[claimToken];
            return send(res, 400, { error: "already claimed" });
          }
          if (wheel.winners.some((w) => normalizeWallet(w.wallet) === wallet)) {
            return send(res, 400, { error: "this wallet already claimed a prize" });
          }
          if (wheel.winners.length >= wheel.limit) {
            delete wheel.pending[claimToken];
            return send(res, 200, { result: "unavailable", ...wheelPublicStatus(wheel) });
          }

          delete wheel.pending[claimToken];
          wheel.winners.push({
            twitter,
            wallet,
            prizeName: wheel.prizeName,
            at: Date.now(),
          });
          return send(res, 200, {
            ok: true,
            prizeName: wheel.prizeName,
            ...wheelPublicStatus(wheel),
          });
        }

        if (url === "/api/wheel/admin") {
          if (req.method === "OPTIONS") return send(res, 200, { ok: true });
          if (req.method === "GET") {
            // no secrets on GET — public-ish status for admin UI bootstrap
            return send(res, 200, {
              ...wheelPublicStatus(wheel),
              winners: wheel.winners.map((w) => ({
                twitter: w.twitter,
                wallet: w.wallet,
                prizeName: w.prizeName,
                at: w.at,
              })),
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

          const action = String(data?.action || "");
          if (action === "reset") {
            wheel.winners = [];
            wheel.pending = {};
          } else if (action === "resetLeaderboard") {
            scores = [];
          } else if (action === "removeLeaderboardName") {
            const name = normalizeTwitterUser(data?.name);
            if (!name) return send(res, 400, { error: "twitter username required" });
            scores = scores.filter((row) => normalizeTwitterUser(row.name) !== name);
          } else if (action === "setLimit") {
            const limit = Math.floor(Number(data?.limit));
            if (!Number.isFinite(limit) || limit < 0 || limit > 1000) {
              return send(res, 400, { error: "invalid limit" });
            }
            wheel.limit = limit;
          } else if (action === "setPrize") {
            const prizeName = String(data?.prizeName || "").trim().slice(0, 48);
            if (!prizeName) return send(res, 400, { error: "prize name required" });
            wheel.prizeName = prizeName;
          } else if (action === "setPassword") {
            const next = String(data?.newPassword || "").trim();
            if (next.length < 6) return send(res, 400, { error: "password too short" });
            wheel.adminPassword = next;
          } else {
            return send(res, 400, { error: "unknown action" });
          }

          return send(res, 200, {
            ok: true,
            ...wheelPublicStatus(wheel),
            winners: wheel.winners,
            leaderboard: scores.slice(0, TOP_PUBLIC),
            leaderboardCount: scores.length,
          });
        }

        next();
      });
    },
  };
}
