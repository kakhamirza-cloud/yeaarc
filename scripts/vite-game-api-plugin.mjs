/**
 * Local game APIs for `npm run dev`: leaderboard + prize wheel.
 * Production uses the Cloudflare Worker + KV instead.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
import { isMintWhitelisted } from "../src/mint-whitelist.js";
import {
  createPredictionState,
  claimFaucet,
  placeBet,
  ensureOpenMarkets,
  resolveExpiredMarkets,
  forceResolveOpenMarket,
  snapshotState,
} from "../src/prediction-shared.js";

const TOP_PUBLIC = 10;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREDICTION_FILE = join(ROOT, "data", "prediction-local.json");

function loadPredictionState() {
  try {
    if (existsSync(PREDICTION_FILE)) {
      return createPredictionState(JSON.parse(readFileSync(PREDICTION_FILE, "utf8")));
    }
  } catch {
    /* fresh state */
  }
  return createPredictionState();
}

function savePredictionState(state) {
  try {
    mkdirSync(dirname(PREDICTION_FILE), { recursive: true });
    writeFileSync(PREDICTION_FILE, `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    /* ignore local persist errors */
  }
}

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
  /** @type {Array<{ wallet: string, twitter: string|null, followed: boolean, retweetedLiked: boolean, at: number }>} */
  let wlApplies = [];
  let prediction = loadPredictionState();

  return {
    name: "arc-mfers-game-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0] || "";

        if (url === "/api/wl-apply") {
          if (req.method === "OPTIONS") return send(res, 200, { ok: true });
          if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
          const data = await readBody(req);
          if (!data) return send(res, 400, { error: "bad json" });
          const wallet = normalizeWallet(data?.wallet);
          if (!wallet) return send(res, 400, { error: "valid wallet address required (0x…)" });
          if (!data?.followed || !data?.retweetedLiked) {
            return send(res, 400, { error: "confirm follow + retweet & like first" });
          }
          const twitter = normalizeTwitterUser(data?.twitter) || null;
          const entry = {
            wallet,
            twitter,
            followed: true,
            retweetedLiked: true,
            at: Date.now(),
          };
          const idx = wlApplies.findIndex((row) => normalizeWallet(row.wallet) === wallet);
          let updated = false;
          if (idx >= 0) {
            wlApplies[idx] = entry;
            updated = true;
          } else {
            wlApplies.unshift(entry);
          }
          return send(res, 200, { ok: true, updated });
        }

        if (url === "/api/wl-apply/admin") {
          if (req.method === "OPTIONS") return send(res, 200, { ok: true });
          if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
          const data = await readBody(req);
          if (!data) return send(res, 400, { error: "bad json" });
          if (String(data?.password || "") !== wheel.adminPassword) {
            return send(res, 401, { error: "bad password" });
          }
          if (String(data?.action || "list") === "clear") {
            wlApplies = [];
            return send(res, 200, { ok: true, applications: [] });
          }
          return send(res, 200, {
            ok: true,
            applications: wlApplies,
            count: wlApplies.length,
          });
        }

        if (url === "/api/checker") {
          if (req.method === "OPTIONS") return send(res, 200, { ok: true });
          if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
          const data = await readBody(req);
          if (!data) return send(res, 400, { error: "bad json" });
          const wallet = normalizeWallet(data?.wallet);
          if (!wallet) return send(res, 400, { error: "valid wallet address required (0x…)" });
          return send(res, 200, { whitelisted: isMintWhitelisted(wallet) });
        }

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

        // ── Prediction market (local) ──
        // Password only on /api/prediction/admin — public routes need mint whitelist wallet
        if (url === "/api/prediction/admin") {
          if (req.method === "OPTIONS") return send(res, 200, { ok: true });
          if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
          const data = await readBody(req);
          if (!data) return send(res, 400, { error: "bad json" });
          if (String(data?.password || "") !== prediction.adminPassword) {
            return send(res, 401, { error: "bad password" });
          }
          const action = String(data?.action || "");
          if (action === "openPublic") {
            prediction.publicOpen = true;
            savePredictionState(prediction);
            return send(res, 200, { ok: true, publicOpen: true });
          }
          if (action === "lockPublic") {
            prediction.publicOpen = false;
            savePredictionState(prediction);
            return send(res, 200, { ok: true, publicOpen: false });
          }
          if (action === "forceResolve") {
            const forced = forceResolveOpenMarket(prediction);
            if (forced.error) return send(res, forced.status, { error: forced.error });
            savePredictionState(prediction);
            return send(res, 200, {
              ok: true,
              ...snapshotState(prediction, data?.wallet),
              playerCount: Object.keys(prediction.players).length,
              marketCount: prediction.markets.length,
            });
          }
          if (action === "reset") {
            prediction = createPredictionState({
              adminPassword: prediction.adminPassword,
            });
            ensureOpenMarkets(prediction);
            savePredictionState(prediction);
            return send(res, 200, {
              ok: true,
              reset: true,
              ...snapshotState(prediction, null),
              playerCount: 0,
              marketCount: prediction.markets.length,
            });
          }
          if (action === "status") {
            ensureOpenMarkets(prediction);
            resolveExpiredMarkets(prediction);
            savePredictionState(prediction);
            return send(res, 200, {
              ok: true,
              publicOpen: prediction.publicOpen,
              ...snapshotState(prediction, data?.wallet),
              playerCount: Object.keys(prediction.players).length,
              marketCount: prediction.markets.length,
            });
          }
          return send(res, 400, { error: "unknown action" });
        }

        if (url === "/api/prediction/enter") {
          if (req.method === "OPTIONS") return send(res, 200, { ok: true });
          if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
          const data = await readBody(req);
          if (!data) return send(res, 400, { error: "bad json" });

          const wallet = normalizeWallet(data?.wallet);
          if (!wallet) return send(res, 400, { error: "valid wallet address required (0x…)" });
          if (!isMintWhitelisted(wallet)) {
            return send(res, 403, {
              error: "wallet not on mint whitelist — access denied",
              whitelisted: false,
            });
          }

          ensureOpenMarkets(prediction);
          resolveExpiredMarkets(prediction);
          savePredictionState(prediction);
          return send(res, 200, {
            ok: true,
            whitelisted: true,
            ...snapshotState(prediction, wallet),
          });
        }

        if (url === "/api/prediction/faucet") {
          if (req.method === "OPTIONS") return send(res, 200, { ok: true });
          if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
          const data = await readBody(req);
          if (!data) return send(res, 400, { error: "bad json" });

          const wallet = normalizeWallet(data?.wallet);
          if (!wallet) return send(res, 400, { error: "valid wallet address required (0x…)" });
          if (!isMintWhitelisted(wallet)) {
            return send(res, 403, { error: "wallet not on mint whitelist" });
          }

          const result = claimFaucet(prediction, wallet);
          if (result.error) return send(res, result.status, { error: result.error });
          savePredictionState(prediction);
          return send(res, 200, { ...result, ...snapshotState(prediction, wallet) });
        }

        if (url === "/api/prediction/bet") {
          if (req.method === "OPTIONS") return send(res, 200, { ok: true });
          if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
          const data = await readBody(req);
          if (!data) return send(res, 400, { error: "bad json" });

          const wallet = normalizeWallet(data?.wallet);
          if (!wallet) return send(res, 400, { error: "valid wallet address required (0x…)" });
          if (!isMintWhitelisted(wallet)) {
            return send(res, 403, { error: "wallet not on mint whitelist" });
          }

          ensureOpenMarkets(prediction);
          const result = placeBet(prediction, {
            wallet,
            marketId: data?.marketId,
            side: data?.side,
            amount: data?.amount,
          });
          if (result.error) return send(res, result.status, { error: result.error });
          savePredictionState(prediction);
          return send(res, 200, { ...result, ...snapshotState(prediction, wallet) });
        }

        if (url === "/api/prediction/state") {
          if (req.method === "OPTIONS") return send(res, 200, { ok: true });
          if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
          const data = await readBody(req);
          if (!data) return send(res, 400, { error: "bad json" });

          const wallet = normalizeWallet(data?.wallet);
          if (!wallet) return send(res, 400, { error: "valid wallet address required (0x…)" });
          if (!isMintWhitelisted(wallet)) {
            return send(res, 403, { error: "wallet not on mint whitelist" });
          }

          ensureOpenMarkets(prediction);
          resolveExpiredMarkets(prediction);
          savePredictionState(prediction);
          return send(res, 200, snapshotState(prediction, wallet));
        }

        next();
      });
    },
  };
}
