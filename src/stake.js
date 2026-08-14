const WALLET_KEY = "arc-predict-wallet";
const CIRC = 2 * Math.PI * 52;

const els = {
  gatePanel: document.getElementById("gatePanel"),
  soonCopy: document.getElementById("soonCopy"),
  walletPanel: document.getElementById("walletPanel"),
  gateEyebrow: document.getElementById("gateEyebrow"),
  deskPanel: document.getElementById("deskPanel"),
  enterForm: document.getElementById("enterForm"),
  walletInput: document.getElementById("walletInput"),
  enterNote: document.getElementById("enterNote"),
  walletLabel: document.getElementById("walletLabel"),
  availLabel: document.getElementById("availLabel"),
  stakedLabel: document.getElementById("stakedLabel"),
  rewardLabel: document.getElementById("rewardLabel"),
  claimHint: document.getElementById("claimHint"),
  tickLabel: document.getElementById("tickLabel"),
  aprBadge: document.getElementById("aprBadge"),
  dialFill: document.getElementById("dialFill"),
  availBar: document.getElementById("availBar"),
  stakedBar: document.getElementById("stakedBar"),
  rewardBar: document.getElementById("rewardBar"),
  stakeForm: document.getElementById("stakeForm"),
  stakeAmount: document.getElementById("stakeAmount"),
  btnMax: document.getElementById("btnMax"),
  btnAction: document.getElementById("btnAction"),
  btnClaim: document.getElementById("btnClaim"),
  btnRefresh: document.getElementById("btnRefresh"),
  btnLogout: document.getElementById("btnLogout"),
  deskNote: document.getElementById("deskNote"),
  modeStake: document.getElementById("modeStake"),
  modeUnstake: document.getElementById("modeUnstake"),
  quickAmounts: document.getElementById("quickAmounts"),
};

let wallet = localStorage.getItem(WALLET_KEY) || "";
let available = 0;
let staked = 0;
let rewards = 0;
let mode = "stake";
let aprDaily = 0.05;
let tickTimer = 0;

/** Public /stake is coming soon. Vault only with ?desk=1 on localhost. */
function deskIsOpen() {
  const host = location.hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  return local && new URLSearchParams(location.search).get("desk") === "1";
}

function show(panel) {
  const soon = panel === "soon";
  const wallet = panel === "wallet";
  const desk = panel === "desk";

  els.gatePanel?.classList.toggle("hidden", desk);
  els.soonCopy?.classList.toggle("hidden", !soon);
  els.walletPanel?.classList.toggle("hidden", !wallet);
  els.deskPanel.classList.toggle("hidden", !desk);

  if (els.gateEyebrow) {
    els.gateEyebrow.textContent = soon ? "coming soon" : "arc mfers";
  }

  if (desk) {
    els.deskPanel.classList.add("is-in");
    startTick();
  } else {
    stopTick();
  }
}

function note(el, message, ok = false) {
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("ok", Boolean(ok && message));
  el.classList.toggle("error", Boolean(!ok && message));
}

function shortWallet(w) {
  if (!w || w.length < 12) return w || "—";
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}

function animateNumber(el, to, { decimals = 0 } = {}) {
  if (!el) return;
  // Skip tween on small screens / reduced motion — snappier, less jank
  const skip =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    window.matchMedia("(max-width: 820px)").matches;
  if (skip) {
    el.textContent = decimals ? Number(to).toFixed(decimals) : String(Math.round(to));
    el.dataset.v = String(to);
    return;
  }
  const from = Number(el.dataset.v || 0);
  const start = performance.now();
  const dur = 420;
  function frame(now) {
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = from + (to - from) * eased;
    el.textContent = decimals ? val.toFixed(decimals) : String(Math.round(val));
    if (t < 1) requestAnimationFrame(frame);
    else el.dataset.v = String(to);
  }
  requestAnimationFrame(frame);
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

function setMode(next) {
  mode = next;
  els.modeStake.classList.toggle("is-on", mode === "stake");
  els.modeUnstake.classList.toggle("is-on", mode === "unstake");
  els.btnAction.textContent = mode === "stake" ? "stake points" : "unstake points";
  els.deskPanel.classList.toggle("mode-unstake", mode === "unstake");
}

function poolTotal() {
  return Math.max(1, available + staked + rewards);
}

function renderDesk(data) {
  const player = data.player;
  if (!player) return;

  available = player.points ?? 0;
  staked = player.staked ?? 0;
  rewards = player.stakeRewards ?? 0;
  aprDaily = player.softAprDaily || 0.05;

  els.walletLabel.textContent = shortWallet(player.wallet);
  if (els.aprBadge) els.aprBadge.textContent = player.softAprLabel || data.softAprLabel || "5%/day";
  if (els.claimHint) els.claimHint.textContent = `+${rewards}`;

  animateNumber(els.availLabel, available);
  animateNumber(els.stakedLabel, staked);
  animateNumber(els.rewardLabel, rewards);

  const total = poolTotal();
  els.availBar.style.setProperty("--fill", `${(available / total) * 100}%`);
  els.stakedBar.style.setProperty("--fill", `${(staked / total) * 100}%`);
  els.rewardBar.style.setProperty("--fill", `${(rewards / total) * 100}%`);

  // Dial = share of wealth currently locked
  const ratio = Math.min(1, staked / total);
  if (els.dialFill) {
    els.dialFill.style.strokeDasharray = `${CIRC}`;
    els.dialFill.style.strokeDashoffset = `${CIRC * (1 - ratio)}`;
  }

  els.deskPanel.classList.toggle("has-stake", staked > 0);
  els.deskPanel.classList.toggle("has-rewards", rewards > 0);
}

function perSecondYield() {
  return (staked * aprDaily) / (24 * 60 * 60);
}

function startTick() {
  stopTick();
  const base = perSecondYield();
  if (els.tickLabel) els.tickLabel.textContent = base.toFixed(4);

  // 1s interval instead of rAF — keeps yield feel without burning mobile CPU
  let live = rewards;
  tickTimer = window.setInterval(() => {
    if (document.hidden || staked <= 0) return;
    live += base;
    const shown = Math.floor(live);
    if (els.rewardLabel) els.rewardLabel.textContent = String(shown);
    if (els.claimHint) els.claimHint.textContent = `+${shown}`;
  }, 1000);
}

function stopTick() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = 0;
  }
}

async function enterDesk() {
  const data = await api("/api/stake/enter", { wallet });
  localStorage.setItem(WALLET_KEY, wallet);
  show("desk");
  renderDesk(data);
  note(els.deskNote, "", true);
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

els.modeStake.addEventListener("click", () => setMode("stake"));
els.modeUnstake.addEventListener("click", () => setMode("unstake"));

els.btnMax.addEventListener("click", () => {
  els.stakeAmount.value = String(mode === "stake" ? available : staked);
});

els.quickAmounts.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-pct]");
  if (!btn) return;
  const pct = Number(btn.dataset.pct) / 100;
  const base = mode === "stake" ? available : staked;
  els.stakeAmount.value = String(Math.max(1, Math.floor(base * pct)));
});

els.stakeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = Number(els.stakeAmount.value);
  note(els.deskNote, "…");
  try {
    const path = mode === "unstake" ? "/api/stake/unstake" : "/api/stake/stake";
    const data = await api(path, { wallet, amount });
    renderDesk(data);
    startTick();
    note(
      els.deskNote,
      mode === "unstake" ? `pulled ${data.unstaked} back` : `locked ${data.staked} in the vault`,
      true
    );
    els.stakeAmount.value = "";
  } catch (err) {
    note(els.deskNote, err.message || "Stake failed");
  }
});

els.btnClaim.addEventListener("click", async () => {
  note(els.deskNote, "…");
  try {
    const data = await api("/api/stake/claim", { wallet });
    renderDesk(data);
    startTick();
    note(els.deskNote, `claimed +${data.claimed}`, true);
  } catch (err) {
    note(els.deskNote, err.message || "Claim failed");
  }
});

els.btnRefresh.addEventListener("click", async () => {
  try {
    const data = await api("/api/stake/state", { wallet });
    renderDesk(data);
    startTick();
    note(els.deskNote, "synced.", true);
  } catch (err) {
    note(els.deskNote, err.message || "Refresh failed");
  }
});

els.btnLogout.addEventListener("click", () => {
  wallet = "";
  localStorage.removeItem(WALLET_KEY);
  show("wallet");
  note(els.enterNote, "");
});

async function boot() {
  setMode("stake");
  if (els.dialFill) {
    els.dialFill.style.strokeDasharray = `${CIRC}`;
    els.dialFill.style.strokeDashoffset = `${CIRC}`;
  }
  if (deskIsOpen()) {
    show("wallet");
    if (wallet) els.walletInput.value = wallet;
    return;
  }
  show("soon");
}

boot();
