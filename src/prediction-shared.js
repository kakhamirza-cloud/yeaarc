/**
 * Local-first prediction market helpers (points pool, multi-markets, faucet).
 * Year-locked templates use 2026 only.
 *
 * Payout rules (parimutuel):
 * - Stake is taken when you bet
 * - Wrong side → payout 0 (stake stays in the pool)
 * - Right side → winners share the full pool by stake %
 */

import { normalizeWallet } from "./game-shared.js";

export const FAUCET_AMOUNT = 500;
/** Share reward — once per UTC day only (stops spam / fake infinite shares) */
export const SHARE_AMOUNT = 100;
export const LEADERBOARD_TOP = 25;
export const MARKET_DURATION_MS = 24 * 60 * 60 * 1000;
export const OPEN_MARKET_COUNT = 3;
export const DEFAULT_PREDICTION_PASSWORD = "arc-wheel-2026";
/** Hard cap per bet — stops fat-finger / absurd payloads even if balance is high */
export const MAX_BET_AMOUNT = 2000;
/** Soft cap on wallet balance so a bad write can't explode points forever */
export const MAX_POINTS_BALANCE = 50_000;
/**
 * Planned later conversion: test points → real points.
 * Rate not decided yet — UI shows xxx:1 / TBA.
 */
export const TEST_TO_REAL_RATE = null;

const QUESTIONS = [
  (ctx) => `Will BTC close above $95,000 on ${fmtDate(ctx.closeDay)}?`,
  (ctx) => `Will ETH close above $3,500 on ${fmtDate(ctx.closeDay)}?`,
  (ctx) => `Will SOL close above $180 on ${fmtDate(ctx.closeDay)}?`,
  (ctx) => `Will BTC outperform ETH over the next 24 hours?`,
  (ctx) => `Will ETH gas average stay under 20 gwei for the next 24 hours?`,
  (ctx) => `Will total crypto market cap stay above $2.5T through ${fmtDate(ctx.closeDay)}?`,
  (ctx) => `Will Arc Chain TVL exceed $10M by Dec 31, ${ctx.year}?`,
  (ctx) => `Will an Arc Chain mainnet milestone drop before Dec 31, ${ctx.year}?`,
  (ctx) => `Will BTC dominate ETH dominance gap by more than 30% on ${fmtDate(ctx.closeDay)}?`,
  (ctx) => `Will a major L2 announce Arc integration before Dec 31, ${ctx.year}?`,
];

function fmtDate(d) {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function questionContext(now = Date.now()) {
  // Use the market close day so dated questions stay current (never “yesterday”)
  const closeDay = new Date(now + MARKET_DURATION_MS);
  return {
    closeDay,
    year: closeDay.getUTCFullYear(),
  };
}

export function utcDayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function createPredictionState(overrides = {}) {
  return {
    adminPassword: overrides.adminPassword || DEFAULT_PREDICTION_PASSWORD,
    publicOpen: Boolean(overrides.publicOpen),
    players: overrides.players && typeof overrides.players === "object" ? overrides.players : {},
    markets: Array.isArray(overrides.markets) ? overrides.markets : [],
  };
}

export function ensurePlayer(state, wallet) {
  const w = normalizeWallet(wallet);
  if (!w) return null;
  if (!state.players[w]) {
    state.players[w] = {
      points: 0,
      lastFaucetDay: null,
      lastShareDay: null,
      history: [],
    };
  }
  // Clamp corrupted / raced balances so the desk can't go negative or infinite
  const p = state.players[w];
  if (!Number.isFinite(p.points) || p.points < 0) p.points = 0;
  if (p.points > MAX_POINTS_BALANCE) p.points = MAX_POINTS_BALANCE;
  if (!Array.isArray(p.history)) p.history = [];
  if (p.lastShareDay === undefined) p.lastShareDay = null;
  return p;
}

export function claimFaucet(state, wallet, now = Date.now()) {
  const w = normalizeWallet(wallet);
  const player = ensurePlayer(state, w);
  if (!player) return { error: "valid wallet required", status: 400 };

  const day = utcDayKey(now);
  if (player.lastFaucetDay === day) {
    return { error: "faucet already claimed today — come back tomorrow", status: 400 };
  }

  player.lastFaucetDay = day;
  player.points = Math.min(MAX_POINTS_BALANCE, player.points + FAUCET_AMOUNT);
  return {
    ok: true,
    granted: FAUCET_AMOUNT,
    points: player.points,
    nextDay: day,
  };
}

/**
 * Share reward — server grants at most once per UTC day.
 * Client cannot pass a points amount; opening tweet intent is soft-trust,
 * but the daily cap blocks farming 9999999 via spam clicks.
 */
export function claimShareReward(state, wallet, now = Date.now()) {
  const w = normalizeWallet(wallet);
  const player = ensurePlayer(state, w);
  if (!player) return { error: "valid wallet required", status: 400 };

  const day = utcDayKey(now);
  if (player.lastShareDay === day) {
    return { error: "share bonus already claimed today — come back tomorrow", status: 400 };
  }

  player.lastShareDay = day;
  player.points = Math.min(MAX_POINTS_BALANCE, player.points + SHARE_AMOUNT);
  return {
    ok: true,
    granted: SHARE_AMOUNT,
    points: player.points,
    nextDay: day,
  };
}

function openMarkets(state, now = Date.now()) {
  return state.markets.filter((m) => m.status === "open" && now < m.closesAt);
}

function pickQuestion(state, seed, now = Date.now()) {
  const ctx = questionContext(now);
  const used = new Set(openMarkets(state, now).map((m) => m.question));
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[Math.abs(seed + i) % QUESTIONS.length](ctx);
    if (!used.has(q)) return q;
  }
  return QUESTIONS[Math.abs(seed) % QUESTIONS.length](ctx);
}

export function createMarket(state, now = Date.now()) {
  const seed = Math.floor(now / 1000) + state.markets.length * 17 + Math.floor(Math.random() * 1000);
  const market = {
    id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    dayKey: utcDayKey(now),
    question: pickQuestion(state, seed, now),
    createdAt: now,
    closesAt: now + MARKET_DURATION_MS,
    status: "open",
    outcome: null,
    yesPool: 0,
    noPool: 0,
    bets: [],
  };
  state.markets.unshift(market);
  state.markets = state.markets.slice(0, 40);
  return market;
}

/** Keep OPEN_MARKET_COUNT live markets. After resolve / 24h, refill. */
export function ensureOpenMarkets(state, now = Date.now(), count = OPEN_MARKET_COUNT) {
  resolveExpiredMarkets(state, now);
  while (openMarkets(state, now).length < count) {
    createMarket(state, now);
  }
  return openMarkets(state, now);
}

export function ensureOpenMarket(state, now = Date.now()) {
  return ensureOpenMarkets(state, now)[0] || null;
}

export function ensureDailyMarket(state, now = Date.now()) {
  return ensureOpenMarket(state, now);
}

function walletAlreadyBet(market, wallet) {
  const w = normalizeWallet(wallet);
  return market.bets.some((b) => b.wallet === w);
}

export function placeBet(state, { wallet, marketId, side, amount }, now = Date.now()) {
  const w = normalizeWallet(wallet);
  const player = ensurePlayer(state, w);
  if (!player) return { error: "valid wallet required", status: 400 };

  resolveExpiredMarkets(state, now);

  const market = state.markets.find((m) => m.id === marketId);
  if (!market) return { error: "market not found", status: 404 };
  if (market.status !== "open" || now >= market.closesAt) {
    return { error: "market is closed", status: 400 };
  }

  // One prediction only — Yes OR No, then locked for this market
  if (walletAlreadyBet(market, w)) {
    return { error: "already predicted on this market — one bet only", status: 400 };
  }

  const sideNorm = String(side || "").toLowerCase();
  if (sideNorm !== "yes" && sideNorm !== "no") {
    return { error: "side must be yes or no", status: 400 };
  }

  const amt = Math.floor(Number(amount));
  if (!Number.isFinite(amt) || amt < 1 || amt > MAX_BET_AMOUNT) {
    return { error: `invalid bet amount (1–${MAX_BET_AMOUNT})`, status: 400 };
  }
  if (player.points < amt) {
    return { error: "not enough points — use the faucet", status: 400 };
  }

  // Deduct then record — never credit client-supplied balances
  player.points -= amt;
  if (sideNorm === "yes") market.yesPool += amt;
  else market.noPool += amt;

  market.bets.push({
    wallet: w,
    side: sideNorm,
    amount: amt,
    at: now,
  });

  return {
    ok: true,
    points: player.points,
    market: publicMarket(market, w),
  };
}

/**
 * Parimutuel payout:
 * - Losers get 0 (their stake stays in the pool)
 * - Winners share totalPool proportional to their stake
 * - If nobody bet the winning side, refund everyone
 */
export function resolveMarket(market, outcome, state) {
  if (market.status === "resolved") return market;

  const winSide = outcome === "yes" || outcome === "no" ? outcome : Math.random() < 0.5 ? "yes" : "no";
  market.outcome = winSide;
  market.status = "resolved";
  market.resolvedAt = Date.now();

  const totalPool = market.yesPool + market.noPool;
  const winPool = winSide === "yes" ? market.yesPool : market.noPool;

  if (totalPool === 0) return market;

  if (winPool === 0) {
    // Nobody on the winning side — refund stakes (no winners to take the pool)
    for (const bet of market.bets) {
      const player = ensurePlayer(state, bet.wallet);
      if (!player) continue;
      player.points += bet.amount;
      bet.payout = bet.amount;
      bet.profit = 0;
      bet.result = "refund";
      player.history.unshift({
        marketId: market.id,
        question: market.question,
        side: bet.side,
        amount: bet.amount,
        payout: bet.amount,
        profit: 0,
        outcome: winSide,
        result: "refund",
        at: market.resolvedAt,
      });
      player.history = player.history.slice(0, 30);
    }
    return market;
  }

  for (const bet of market.bets) {
    const player = ensurePlayer(state, bet.wallet);
    if (!player) continue;

    if (bet.side === winSide) {
      // Payout = share of full pool. Solo winner → payout equals stake (net 0).
      const payout = Math.floor((bet.amount / winPool) * totalPool);
      const profit = payout - bet.amount;
      player.points += payout;
      bet.payout = payout;
      bet.profit = profit;
      bet.result = profit > 0 ? "win" : "win_even";
      player.history.unshift({
        marketId: market.id,
        question: market.question,
        side: bet.side,
        amount: bet.amount,
        payout,
        profit,
        outcome: winSide,
        at: market.resolvedAt,
      });
    } else {
      // Wrong side: payout stays 0 — stake already deducted
      bet.payout = 0;
      bet.profit = -bet.amount;
      bet.result = "lose";
      player.history.unshift({
        marketId: market.id,
        question: market.question,
        side: bet.side,
        amount: bet.amount,
        payout: 0,
        profit: -bet.amount,
        outcome: winSide,
        at: market.resolvedAt,
      });
    }
    player.history = player.history.slice(0, 30);
  }

  return market;
}

export function resolveExpiredMarkets(state, now = Date.now()) {
  let resolvedAny = false;
  for (const market of state.markets) {
    if (market.status === "open" && now >= market.closesAt) {
      resolveMarket(market, null, state);
      resolvedAny = true;
    }
  }
  if (resolvedAny) {
    while (openMarkets(state, now).length < OPEN_MARKET_COUNT) {
      createMarket(state, now);
    }
  }
}

export function forceResolveOpenMarket(state, now = Date.now()) {
  const open = openMarkets(state, now);
  if (!open.length) return { error: "no open market", status: 400 };
  // Resolve all open markets for testing, then refill to 3
  for (const market of open) {
    market.closesAt = now - 1;
  }
  resolveExpiredMarkets(state, now);
  return { ok: true, resolved: open.length };
}

export function publicMarket(market, wallet = null) {
  const total = market.yesPool + market.noPool;
  const yesPct = total > 0 ? Math.round((market.yesPool / total) * 100) : 50;
  const noPct = total > 0 ? 100 - yesPct : 50;
  const w = wallet ? normalizeWallet(wallet) : null;
  const myBets = w ? market.bets.filter((b) => b.wallet === w) : [];
  const hasBet = myBets.length > 0;
  const canBet = market.status === "open" && !hasBet;

  return {
    id: market.id,
    dayKey: market.dayKey,
    question: market.question,
    createdAt: market.createdAt,
    closesAt: market.closesAt,
    status: market.status,
    outcome: market.outcome,
    yesPool: market.yesPool,
    noPool: market.noPool,
    totalPool: total,
    yesPct,
    noPct,
    betCount: market.bets.length,
    myBets,
    hasBet,
    canBet,
  };
}

export function publicPlayer(player, wallet, { isMfer = false } = {}) {
  const day = utcDayKey();
  if (!player) {
    return {
      wallet,
      points: 0,
      lastFaucetDay: null,
      lastShareDay: null,
      canFaucet: true,
      canShare: true,
      faucetAmount: FAUCET_AMOUNT,
      shareAmount: SHARE_AMOUNT,
      isMfer: Boolean(isMfer),
      shopOpen: Boolean(isMfer),
      testToRealRate: TEST_TO_REAL_RATE,
      history: [],
    };
  }
  return {
    wallet,
    points: player.points,
    lastFaucetDay: player.lastFaucetDay,
    lastShareDay: player.lastShareDay || null,
    canFaucet: player.lastFaucetDay !== day,
    canShare: player.lastShareDay !== day,
    faucetAmount: FAUCET_AMOUNT,
    shareAmount: SHARE_AMOUNT,
    isMfer: Boolean(isMfer),
    shopOpen: Boolean(isMfer),
    testToRealRate: TEST_TO_REAL_RATE,
    history: player.history || [],
  };
}

export function pointsLeaderboard(state, viewerWallet = null, limit = LEADERBOARD_TOP) {
  const viewer = normalizeWallet(viewerWallet);
  const rows = Object.entries(state.players || {})
    .map(([wallet, p]) => ({
      wallet,
      points: Math.max(0, Math.floor(Number(p?.points) || 0)),
    }))
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points || a.wallet.localeCompare(b.wallet));

  const yourIndex = viewer ? rows.findIndex((r) => r.wallet === viewer) : -1;

  return {
    playerCount: Object.keys(state.players || {}).length,
    scoredCount: rows.length,
    yourRank: yourIndex >= 0 ? yourIndex + 1 : null,
    yourPoints: yourIndex >= 0 ? rows[yourIndex].points : viewer ? state.players?.[viewer]?.points ?? 0 : null,
    top: rows.slice(0, limit).map((r, i) => ({
      rank: i + 1,
      wallet: r.wallet,
      points: r.points,
      you: Boolean(viewer && r.wallet === viewer),
    })),
  };
}

export function snapshotState(state, wallet, extras = {}) {
  const w = normalizeWallet(wallet);
  const opens = ensureOpenMarkets(state);
  const player = w ? ensurePlayer(state, w) : null;
  return {
    publicOpen: state.publicOpen,
    player: w ? publicPlayer(player, w, extras) : null,
    openMarkets: opens.map((m) => publicMarket(m, w)),
    openMarket: publicMarket(opens[0] || createMarket(state), w),
    markets: state.markets.map((m) => publicMarket(m, w)),
    lastResolved: publicMarket(
      state.markets.find((m) => m.status === "resolved") || opens[0],
      w
    ),
    leaderboard: pointsLeaderboard(state, w),
    testToRealRate: TEST_TO_REAL_RATE,
    shareAmount: SHARE_AMOUNT,
    faucetAmount: FAUCET_AMOUNT,
  };
}
