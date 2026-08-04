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
};

let wallet = localStorage.getItem(WALLET_KEY) || "";
let shopOpen = false;
let shareAmount = 100;

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

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "—";
  }
}

function marketCardHtml(market) {
  const locked = market.hasBet || market.status !== "open";
  const betForm = market.canBet
    ? `<form class="bet-form" data-market-id="${market.id}">
        <label class="apply-label">bet amount (points)</label>
        <input class="apply-input bet-amount" type="number" min="1" step="1" value="50" required />
        <div class="bet-sides">
          <button type="submit" class="btn primary" name="side" value="yes">Bet YES</button>
          <button type="submit" class="btn ghost" name="side" value="no">Bet NO</button>
        </div>
      </form>`
    : `<p class="muted">${
        market.hasBet
          ? "You already predicted on this market (one bet only)."
          : "Market closed."
      }</p>`;

  const my = market.myBets?.length
    ? market.myBets
        .map((b) => {
          let extra = "";
          if (b.result === "lose") extra = ` · lost ${b.amount}`;
          else if (b.result === "refund") extra = ` · refunded (no winners on other side)`;
          else if (b.result === "win_even" || (b.payout != null && b.payout === b.amount))
            extra = ` · got stake back (you were alone in the pool)`;
          else if (b.payout != null) extra = ` · payout ${b.payout} (net +${b.payout - b.amount})`;
          return `<p>Your bet: <strong>${b.side.toUpperCase()}</strong> · ${b.amount} pts${extra}</p>`;
        })
        .join("")
    : "";

  const status =
    market.status === "open"
      ? "open · 24h"
      : `resolved · ${String(market.outcome || "").toUpperCase()}`;

  return `<article class="market-card${locked && market.hasBet ? " is-locked" : ""}" data-id="${market.id}">
    <p class="market-status ${market.status}">${status}</p>
    <h2 class="market-question">${market.question}</h2>
    <p class="market-meta">Pool ${market.totalPool} pts · ${market.betCount} bet(s) · closes ${fmtTime(market.closesAt)}</p>
    <div class="odds-row">
      <div class="odds yes"><span>YES</span><strong>${market.yesPct}%</strong><small>${market.yesPool} pts</small></div>
      <div class="odds no"><span>NO</span><strong>${market.noPct}%</strong><small>${market.noPool} pts</small></div>
    </div>
    ${betForm}
    <div class="my-bets">${my}</div>
  </article>`;
}

function renderDesk(data) {
  const player = data.player;
  const markets = data.openMarkets?.length
    ? data.openMarkets
    : (data.markets || []).filter((m) => m.status === "open").slice(0, 3);

  shareAmount = player?.shareAmount || data.shareAmount || 100;
  shopOpen = Boolean(player?.shopOpen || player?.isMfer);

  if (player) {
    els.pointsLabel.textContent = String(player.points ?? 0);
    els.walletLabel.textContent = shortWallet(player.wallet);
    els.btnFaucet.disabled = !player.canFaucet;
    els.btnFaucet.textContent = player.canFaucet
      ? `Claim faucet (+${player.faucetAmount || 500})`
      : "Faucet claimed today";
    els.btnShare.disabled = false;
    els.btnShare.textContent = player.canShare
      ? `Share with a friend (+${shareAmount})`
      : "Share bonus claimed today";
  }

  els.marketsList.innerHTML = markets.length
    ? markets.map(marketCardHtml).join("")
    : `<p class="muted">No open markets.</p>`;

  const history = player?.history || [];
  els.historyList.innerHTML = history.length
    ? history
        .map((h) => {
          const profit = h.profit ?? (h.payout ?? 0) - h.amount;
          const label =
            h.result === "refund" || (h.payout === h.amount && profit === 0)
              ? "stake returned"
              : profit > 0
                ? `net +${profit}`
                : profit < 0
                  ? `net ${profit}`
                  : "net 0";
          return `<li><strong>${label}</strong> · bet ${h.side.toUpperCase()} ${h.amount} · outcome ${String(
            h.outcome || ""
          ).toUpperCase()}</li>`;
        })
        .join("")
    : `<li class="muted">No settled bets yet.</li>`;
}

async function enterDesk() {
  const data = await api("/api/prediction/enter", { wallet });
  localStorage.setItem(WALLET_KEY, wallet);
  show("desk");
  renderDesk(data);
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
    // Still opened the tweet; bonus may already be claimed today
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
    els.shopTitle.textContent = "coming soon";
    els.shopBody.textContent =
      "ARC mfer shop unlocked for you. Spend points on rewards here soon.";
  } else {
    els.shopTitle.textContent = "holders only";
    els.shopBody.textContent =
      "Shop is for ARC mfers only. Anyone can play predictions — holders unlock the shop.";
  }
  els.buySoon.classList.remove("hidden");
});

els.btnBuyClose.addEventListener("click", () => {
  els.buySoon.classList.add("hidden");
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
  localStorage.removeItem(WALLET_KEY);
  els.buySoon.classList.add("hidden");
  show("wallet");
  note(els.enterNote, "");
});

els.marketsList.addEventListener("submit", async (e) => {
  const form = e.target.closest("form.bet-form");
  if (!form) return;
  e.preventDefault();
  const side = e.submitter?.value || "yes";
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
    renderDesk(data);
    note(els.deskNote, `${side.toUpperCase()} · ${amount} pts locked`, true);
  } catch (err) {
    note(els.deskNote, err.message || "Bet failed");
  }
});

async function boot() {
  show("wallet");
  if (wallet) els.walletInput.value = wallet;
}

boot();
