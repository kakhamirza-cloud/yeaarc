import { MAX_BET_AMOUNT } from "./prediction-shared.js";

const WALLET_KEY = "arc-predict-wallet";

const els = {
  walletPanel: document.getElementById("walletPanel"),
  deskPanel: document.getElementById("deskPanel"),
  enterForm: document.getElementById("enterForm"),
  walletInput: document.getElementById("walletInput"),
  enterNote: document.getElementById("enterNote"),
  pointsLabel: document.getElementById("pointsLabel"),
  walletLabel: document.getElementById("walletLabel"),
  btnFaucet: document.getElementById("btnFaucet"),
  btnBuy: document.getElementById("btnBuy"),
  btnBuyClose: document.getElementById("btnBuyClose"),
  buySoon: document.getElementById("buySoon"),
  shopTitle: document.getElementById("shopTitle"),
  shopBody: document.getElementById("shopBody"),
  btnShare: document.getElementById("btnShare"),
  btnShareWallet: document.getElementById("btnShareWallet"),
  btnRefresh: document.getElementById("btnRefresh"),
  btnLogout: document.getElementById("btnLogout"),
  deskNote: document.getElementById("deskNote"),
  marketsList: document.getElementById("marketsList"),
  historyList: document.getElementById("historyList"),
  lbMeta: document.getElementById("lbMeta"),
  lbList: document.getElementById("lbList"),
  deskTabs: document.getElementById("deskTabs"),
};

let wallet = localStorage.getItem(WALLET_KEY) || "";
let shopOpen = false;
let shareAmount = 100;
let faucetAmount = 500;
let lastDesk = null;
/** Inline ticket: which market + side the user is pricing. */
let ticket = { marketId: null, side: "yes", amount: 50 };
let activeTab = "markets";
let tickTimer = null;

function show(panel) {
  els.walletPanel.classList.toggle("hidden", panel !== "wallet");
  els.deskPanel.classList.toggle("hidden", panel !== "desk");
}

function note(el, message, ok = false) {
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("ok", Boolean(ok && message));
  el.classList.toggle("error", Boolean(!ok && message));
}

function shareUrl() {
  return `${window.location.origin}/prediction`;
}

function openInviteTweet() {
  const text = "Come try the prediction market from ARC mfers";
  const intent = new URL("https://twitter.com/intent/tweet");
  intent.searchParams.set("text", text);
  intent.searchParams.set("url", shareUrl());
  window.open(intent.toString(), "_blank", "noopener,noreferrer");
}

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || "request failed");
    err.status = res.status;
    throw err;
  }
  return data;
}

function shortWallet(w) {
  if (!w || w.length < 12) return w || "—";
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

function marketCategory(question) {
  const q = String(question || "").toLowerCase();
  if (q.includes("arc chain") || q.includes("arc ")) return "Arc";
  if (/\bbtc\b|\beth\b|\bsol\b|crypto|gwei|market cap/.test(q)) return "Crypto";
  return "Event";
}

function timeLeft(ts) {
  const ms = Number(ts) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "Closed";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h left`;
  if (h >= 1) return `${h}h ${m % 60}m left`;
  return `${Math.max(1, m)}m left`;
}

function fmtPts(n) {
  const v = Math.floor(Number(n) || 0);
  return v.toLocaleString("en-US");
}

/**
 * Parimutuel preview: if this stake lands on the winning side of the *current* pool.
 * Actual payout moves if others bet after you — that's the product, so we label it "est."
 */
function estPayout(market, side, amount) {
  const amt = Math.floor(Number(amount) || 0);
  if (amt < 1) return 0;
  const yes = market.yesPool + (side === "yes" ? amt : 0);
  const no = market.noPool + (side === "no" ? amt : 0);
  const total = yes + no;
  const win = side === "yes" ? yes : no;
  if (win <= 0) return 0;
  return Math.floor((amt / win) * total);
}

function amountChips(selected) {
  const chips = [50, 100, 250, 500];
  return chips
    .map(
      (n) =>
        `<button type="button" class="pm-chip${selected === n ? " is-on" : ""}" data-amt="${n}">${n}</button>`
    )
    .join("");
}

function ticketHtml(market) {
  const open = ticket.marketId === market.id && market.canBet;
  if (!open) return "";
  const side = ticket.side === "no" ? "no" : "yes";
  const amt = Math.max(1, Math.floor(Number(ticket.amount) || 50));
  const payout = estPayout(market, side, amt);
  const profit = payout - amt;
  return `<form class="pm-ticket" data-market-id="${market.id}">
    <div class="pm-ticket-head">
      <span>Buy <strong class="${side}">${side.toUpperCase()}</strong></span>
      <span class="pm-ticket-odds">${side === "yes" ? market.yesPct : market.noPct}% of pool</span>
    </div>
    <label class="apply-label" for="amt-${market.id}">Amount</label>
    <div class="pm-chips">${amountChips(amt)}<button type="button" class="pm-chip" data-amt="max">Max</button></div>
    <input
      id="amt-${market.id}"
      class="apply-input bet-amount"
      type="number"
      min="1"
      max="${MAX_BET_AMOUNT}"
      step="1"
      value="${amt}"
      required
    />
    <p class="pm-ticket-est">
      Est. if ${side.toUpperCase()} wins: <strong>${fmtPts(payout)} pts</strong>
      ${profit > 0 ? `(+${fmtPts(profit)})` : profit < 0 ? `(${profit})` : "(even if you’re alone)"}
    </p>
    <p class="pm-ticket-rule">Wrong side pays 0. Winners split the full pool by stake.</p>
    <button type="submit" class="btn primary pm-confirm">Confirm ${side.toUpperCase()}</button>
  </form>`;
}

function marketCardHtml(market) {
  const locked = market.hasBet || market.status !== "open";
  const live = market.status === "open";
  const yesOn = ticket.marketId === market.id && ticket.side === "yes";
  const noOn = ticket.marketId === market.id && ticket.side === "no";

  const actions = market.canBet
    ? `<div class="pm-sides">
        <button type="button" class="pm-side yes${yesOn ? " is-on" : ""}" data-side="yes" data-market-id="${market.id}">
          Yes <em>${market.yesPct}%</em>
        </button>
        <button type="button" class="pm-side no${noOn ? " is-on" : ""}" data-side="no" data-market-id="${market.id}">
          No <em>${market.noPct}%</em>
        </button>
      </div>
      ${ticketHtml(market)}`
    : `<p class="pm-locked">${
        market.hasBet
          ? "Position locked — one bet per market."
          : "This market is closed."
      }</p>`;

  const my = market.myBets?.length
    ? market.myBets
        .map((b) => {
          let extra = "";
          if (b.result === "lose") extra = ` · lost ${fmtPts(b.amount)}`;
          else if (b.result === "refund") extra = " · refunded";
          else if (b.result === "win_even" || (b.payout != null && b.payout === b.amount))
            extra = " · stake returned";
          else if (b.payout != null) extra = ` · paid ${fmtPts(b.payout)}`;
          return `<p class="pm-position">Your position: <strong class="${b.side}">${b.side.toUpperCase()}</strong> · ${fmtPts(b.amount)} pts${extra}</p>`;
        })
        .join("")
    : "";

  const status = live
    ? `<span class="pm-live">Live</span>`
    : `<span class="pm-resolved">Resolved ${String(market.outcome || "").toUpperCase()}</span>`;

  return `<article class="pm-card${locked && market.hasBet ? " is-locked" : ""}" data-id="${market.id}">
    <div class="pm-card-top">
      <div class="pm-card-tags">
        <span class="pm-cat">${marketCategory(market.question)}</span>
        ${status}
      </div>
      <div class="pm-chance" title="Share of the current pool on Yes">
        <strong>${market.yesPct}%</strong>
        <span>Yes</span>
      </div>
    </div>
    <h2 class="pm-question">${market.question}</h2>
    <div class="pm-bar" aria-hidden="true">
      <span class="yes" style="width:${market.yesPct}%"></span>
      <span class="no" style="width:${market.noPct}%"></span>
    </div>
    <p class="pm-card-meta">
      <span>${fmtPts(market.totalPool)} pts pool</span>
      <span>${market.betCount} bet${market.betCount === 1 ? "" : "s"}</span>
      <span data-close="${market.closesAt}">${live ? timeLeft(market.closesAt) : "Settled"}</span>
    </p>
    ${actions}
    <div class="pm-mine">${my}</div>
  </article>`;
}

function setTab(tab) {
  activeTab = tab;
  els.deskTabs?.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("is-on", btn.dataset.tab === tab);
  });
  document.getElementById("tabMarkets")?.classList.toggle("is-active", tab === "markets");
  document.getElementById("tabPositions")?.classList.toggle("is-active", tab === "positions");
  document.getElementById("tabRank")?.classList.toggle("is-active", tab === "rank");
}

function renderDesk(data) {
  lastDesk = data;
  const player = data.player;
  const markets = data.openMarkets?.length
    ? data.openMarkets
    : (data.markets || []).filter((m) => m.status === "open").slice(0, 3);

  shareAmount = player?.shareAmount || data.shareAmount || 100;
  faucetAmount = player?.faucetAmount || data.faucetAmount || 500;
  shopOpen = Boolean(player?.shopOpen || player?.isMfer);

  if (player) {
    els.pointsLabel.textContent = fmtPts(player.points ?? 0);
    els.walletLabel.textContent = shortWallet(player.wallet);
    els.btnFaucet.disabled = !player.canFaucet;
    els.btnFaucet.textContent = player.canFaucet
      ? `Claim +${faucetAmount}`
      : "Faucet claimed";
    els.btnShare.disabled = false;
    els.btnShare.textContent = player.canShare ? `Share +${shareAmount}` : "Shared today";
  }

  // Drop ticket if that market is gone / already bet
  if (ticket.marketId && !markets.some((m) => m.id === ticket.marketId && m.canBet)) {
    ticket.marketId = null;
  }

  els.marketsList.innerHTML = markets.length
    ? markets.map(marketCardHtml).join("")
    : `<p class="pm-empty">No open markets.</p>`;

  const lb = data.leaderboard || {};
  const top = lb.top || [];
  if (els.lbMeta) {
    const you =
      lb.yourRank != null ? ` · you #${lb.yourRank}` : player ? " · unranked" : "";
    els.lbMeta.textContent = `${lb.scoredCount ?? 0} scored · ${lb.playerCount ?? 0} players${you}`;
  }
  if (els.lbList) {
    els.lbList.innerHTML = top.length
      ? top
          .map(
            (row) =>
              `<li class="${row.you ? "is-you" : ""}"><span class="rank">#${row.rank}</span><span class="addr">${shortWallet(
                row.wallet
              )}</span><span class="pts">${fmtPts(row.points)}</span></li>`
          )
          .join("")
      : `<li class="muted">No scores yet — claim faucet to appear.</li>`;
  }

  const history = player?.history || [];
  const openPositions = markets.flatMap((m) =>
    (m.myBets || []).map((b) => ({
      live: true,
      question: m.question,
      side: b.side,
      amount: b.amount,
    }))
  );

  const rows = [
    ...openPositions.map(
      (p) =>
        `<li class="is-live"><strong>${p.side.toUpperCase()}</strong> ${fmtPts(p.amount)} pts · open · ${p.question}</li>`
    ),
    ...history.map((h) => {
      const profit = h.profit ?? (h.payout ?? 0) - h.amount;
      const label =
        h.result === "refund" || (h.payout === h.amount && profit === 0)
          ? "returned"
          : profit > 0
            ? `+${fmtPts(profit)}`
            : profit < 0
              ? String(profit)
              : "even";
      return `<li><strong>${label}</strong> · ${String(h.side || "").toUpperCase()} ${fmtPts(h.amount)} · ${String(
        h.outcome || ""
      ).toUpperCase()}</li>`;
    }),
  ];

  els.historyList.innerHTML = rows.length
    ? rows.join("")
    : `<li class="muted">No positions yet.</li>`;
}

function refreshCountdowns() {
  els.marketsList?.querySelectorAll("[data-close]").forEach((el) => {
    el.textContent = timeLeft(Number(el.dataset.close));
  });
}

function startTicks() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(refreshCountdowns, 1000);
}

async function enterDesk() {
  const data = await api("/api/prediction/enter", { wallet });
  localStorage.setItem(WALLET_KEY, wallet);
  show("desk");
  renderDesk(data);
  setTab(activeTab);
  startTicks();
  note(els.deskNote, "", true);
}

async function shareAndReward(noteEl, grantPoints) {
  openInviteTweet();
  if (!grantPoints || !wallet) {
    note(noteEl, "Opening share…", true);
    return;
  }
  note(noteEl, "…");
  try {
    const data = await api("/api/prediction/share", { wallet });
    renderDesk(data);
    note(noteEl, `Shared · +${data.granted} points`, true);
  } catch (err) {
    note(noteEl, err.message || "Share opened (bonus already used today)");
  }
}

els.enterForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  note(els.enterNote, "…");
  wallet = els.walletInput.value.trim();
  try {
    await enterDesk();
    note(els.enterNote, "");
  } catch (err) {
    note(els.enterNote, err.message || "Could not enter");
  }
});

els.btnFaucet.addEventListener("click", async () => {
  note(els.deskNote, "…");
  try {
    const data = await api("/api/prediction/faucet", { wallet });
    renderDesk(data);
    note(els.deskNote, `+${data.granted} points`, true);
  } catch (err) {
    note(els.deskNote, err.message || "Faucet failed");
  }
});

els.btnBuy.addEventListener("click", () => {
  if (shopOpen) {
    els.shopTitle.textContent = "Coming soon";
    els.shopBody.textContent =
      "ARC mfer shop unlocked for you. Spend points on rewards here soon.";
  } else {
    els.shopTitle.textContent = "Holders only";
    els.shopBody.textContent =
      "Shop is for ARC mfers only. Anyone can play predictions — holders unlock the shop.";
  }
  els.buySoon.classList.remove("hidden");
});

els.btnBuyClose.addEventListener("click", () => {
  els.buySoon.classList.add("hidden");
});

els.buySoon.addEventListener("click", (e) => {
  if (e.target === els.buySoon) els.buySoon.classList.add("hidden");
});

els.btnShare?.addEventListener("click", () => shareAndReward(els.deskNote, true));
els.btnShareWallet?.addEventListener("click", () => shareAndReward(els.enterNote, false));

els.btnRefresh.addEventListener("click", async () => {
  try {
    const data = await api("/api/prediction/state", { wallet });
    renderDesk(data);
    note(els.deskNote, "Refreshed.", true);
  } catch (err) {
    note(els.deskNote, err.message || "Refresh failed");
  }
});

els.btnLogout.addEventListener("click", () => {
  wallet = "";
  shopOpen = false;
  lastDesk = null;
  ticket = { marketId: null, side: "yes", amount: 50 };
  localStorage.removeItem(WALLET_KEY);
  els.buySoon.classList.add("hidden");
  if (tickTimer) clearInterval(tickTimer);
  show("wallet");
  note(els.enterNote, "");
});

els.deskTabs?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (!btn) return;
  setTab(btn.dataset.tab);
});

els.marketsList.addEventListener("click", (e) => {
  const sideBtn = e.target.closest(".pm-side");
  if (sideBtn) {
    ticket.marketId = sideBtn.dataset.marketId;
    ticket.side = sideBtn.dataset.side === "no" ? "no" : "yes";
    if (lastDesk) renderDesk(lastDesk);
    return;
  }

  const chip = e.target.closest(".pm-chip");
  if (chip) {
    const card = chip.closest(".pm-card");
    const input = card?.querySelector(".bet-amount");
    const pts = lastDesk?.player?.points ?? 0;
    if (chip.dataset.amt === "max") {
      ticket.amount = Math.max(1, Math.min(MAX_BET_AMOUNT, Math.floor(pts)));
    } else {
      ticket.amount = Number(chip.dataset.amt) || 50;
    }
    if (input) input.value = String(ticket.amount);
    if (lastDesk) renderDesk(lastDesk);
  }
});

els.marketsList.addEventListener("input", (e) => {
  if (!e.target.classList.contains("bet-amount")) return;
  ticket.amount = Number(e.target.value) || 0;
  const form = e.target.closest(".pm-ticket");
  const market = (lastDesk?.openMarkets || []).find((m) => m.id === form?.dataset.marketId);
  if (!market || !form) return;
  const side = ticket.side === "no" ? "no" : "yes";
  const amt = Math.max(1, Math.floor(ticket.amount || 0));
  const payout = estPayout(market, side, amt);
  const profit = payout - amt;
  const est = form.querySelector(".pm-ticket-est");
  if (est) {
    est.innerHTML = `Est. if ${side.toUpperCase()} wins: <strong>${fmtPts(payout)} pts</strong> ${
      profit > 0 ? `(+${fmtPts(profit)})` : profit < 0 ? `(${profit})` : "(even if you’re alone)"
    }`;
  }
});

els.marketsList.addEventListener("submit", async (e) => {
  const form = e.target.closest("form.pm-ticket");
  if (!form) return;
  e.preventDefault();
  const side = ticket.side === "no" ? "no" : "yes";
  const amount = Number(form.querySelector(".bet-amount")?.value);
  const marketId = form.dataset.marketId;
  note(els.deskNote, "…");
  try {
    const data = await api("/api/prediction/bet", {
      wallet,
      marketId,
      side,
      amount,
    });
    ticket = { marketId: null, side: "yes", amount: 50 };
    renderDesk(data);
    note(els.deskNote, `${side.toUpperCase()} · ${fmtPts(amount)} pts locked`, true);
  } catch (err) {
    note(els.deskNote, err.message || "Bet failed");
  }
});

async function boot() {
  show("wallet");
  if (wallet) els.walletInput.value = wallet;
  setTab("markets");
}

boot();
