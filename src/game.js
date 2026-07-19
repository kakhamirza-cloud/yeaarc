/** ARC mfers — Ladder Climb (light, local-first + live API) */

import {
  PICKUP_EMOJI,
  TWITTER_HANDLE,
  normalizeTwitterUser,
  buildScoreTweet,
  buildPrizeTweet,
  tweetIntentUrl,
} from "./game-shared.js";

const CHAR_IDS = [0, 1, 2, 3, 7, 12, 21, 42, 55, 69, 100, 420];
const ROUND_SECONDS = 30;
const RUNG_GAP = 46;
const STUN_MS = 2000;
const LB_POLL_MS = 3000;
const LB_TOP = 10;
const PICKUP_TYPES = ["boost", "hazard"];
const WHEEL_SPAWN_CHANCE = 0.2; // slight chance per run
const WHEEL_MIN_HEIGHT = 100;

const els = {
  select: document.getElementById("screenSelect"),
  tutorial: document.getElementById("screenTutorial"),
  play: document.getElementById("screenPlay"),
  results: document.getElementById("screenResults"),
  charGrid: document.getElementById("charGrid"),
  btnConfirmChar: document.getElementById("btnConfirmChar"),
  btnStart: document.getElementById("btnStart"),
  btnBackSelect: document.getElementById("btnBackSelect"),
  tutorialPortrait: document.getElementById("tutorialPortrait"),
  canvas: document.getElementById("gameCanvas"),
  countdown: document.getElementById("countdownOverlay"),
  hudTime: document.getElementById("hudTime"),
  hudHeight: document.getElementById("hudHeight"),
  hudStatus: document.getElementById("hudStatus"),
  btnLeft: document.getElementById("btnLeft"),
  btnRight: document.getElementById("btnRight"),
  stunOverlay: document.getElementById("stunOverlay"),
  stunTimer: document.getElementById("stunTimer"),
  finalScore: document.getElementById("finalScore"),
  scoreForm: document.getElementById("scoreForm"),
  playerName: document.getElementById("playerName"),
  btnTweet: document.getElementById("btnTweet"),
  submitNote: document.getElementById("submitNote"),
  leaderboard: document.getElementById("leaderboard"),
  selectTop3: document.getElementById("selectTop3"),
  btnReplay: document.getElementById("btnReplay"),
  wheelPanel: document.getElementById("wheelPanel"),
  wheelTitle: document.getElementById("wheelTitle"),
  wheelCopy: document.getElementById("wheelCopy"),
  prizeWheel: document.getElementById("prizeWheel"),
  wheelResult: document.getElementById("wheelResult"),
  wheelActions: document.getElementById("wheelActions"),
  btnSpin: document.getElementById("btnSpin"),
  btnSkipWheel: document.getElementById("btnSkipWheel"),
  claimForm: document.getElementById("claimForm"),
  claimWallet: document.getElementById("claimWallet"),
  wheelNote: document.getElementById("wheelNote"),
};

const ctx = els.canvas.getContext("2d");

let selectedId = null;
let sprite = null;
let raf = 0;
let running = false;
let canControl = false;
let lastSide = null;
let rung = 0; // player stands on this ladder line (score = rungs climbed)
let cameraY = 0;
let timeLeft = ROUND_SECONDS;
let lastTs = 0;
let stunUntil = 0;
let entities = [];
let nextSpawnRung = 2;
let submitted = false;
let liveScores = [];
let lbPollTimer = 0;
let highlightScore = null;
let boostDepth = 0; // prevent ⚡ from chaining forever
let hasWheelToken = false; // collected this run only — does not accumulate
let wheelRung = null;
let wheelSpawned = false;
let wheelSpent = false; // spun or skipped this results screen
let claimToken = null;
let wheelRotation = 0;

function worldY() {
  return rung * RUNG_GAP;
}

function artUrl(id) {
  return `/gallery/${id}.png`;
}

function show(screen) {
  for (const key of ["select", "tutorial", "play", "results"]) {
    els[key].classList.toggle("hidden", els[key] !== screen);
  }
  // Keep top 3 fresh on select + results
  if (screen === els.results || screen === els.select) startLbPoll();
  else stopLbPoll();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function renderCharSelect() {
  els.charGrid.innerHTML = "";
  for (const id of CHAR_IDS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "char-card";
    btn.setAttribute("aria-label", `mfer #${id}`);
    const img = document.createElement("img");
    img.src = artUrl(id);
    img.alt = `mfer #${id}`;
    img.loading = "lazy";
    btn.appendChild(img);
    btn.addEventListener("click", () => {
      selectedId = id;
      els.charGrid.querySelectorAll(".char-card").forEach((c) => c.classList.remove("selected"));
      btn.classList.add("selected");
      els.btnConfirmChar.disabled = false;
    });
    els.charGrid.appendChild(btn);
  }
}

async function fetchLeaderboard() {
  try {
    const res = await fetch("/api/leaderboard", { cache: "no-store" });
    if (!res.ok) throw new Error("lb fetch failed");
    const data = await res.json();
    liveScores = Array.isArray(data.scores) ? data.scores : [];
    return liveScores;
  } catch {
    return liveScores;
  }
}

async function submitScore(name, score) {
  const res = await fetch("/api/leaderboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, score, mfer: selectedId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "submit failed");
  }
  liveScores = Array.isArray(data.scores) ? data.scores : liveScores;
  return liveScores;
}

function renderLeaderboard(hl = highlightScore) {
  highlightScore = hl;
  const list = [...liveScores].sort((a, b) => b.score - a.score).slice(0, LB_TOP);
  els.leaderboard.innerHTML = "";
  if (!list.length) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="rank">—</span><span>no climbs yet</span><span class="pts">0</span>`;
    els.leaderboard.appendChild(li);
  } else {
    const hlIndex =
      hl != null ? list.findIndex((r) => r.score === hl) : -1;
    list.forEach((row, i) => {
      const li = document.createElement("li");
      if (i === hlIndex) li.style.color = "var(--accent)";
      li.innerHTML = `<span class="rank">#${i + 1}</span><span>@${escapeHtml(row.name)}</span><span class="pts">${row.score}</span>`;
      els.leaderboard.appendChild(li);
    });
  }
  renderSelectTop3();
}

function renderSelectTop3() {
  if (!els.selectTop3) return;
  const top = [...liveScores].sort((a, b) => b.score - a.score).slice(0, 3);
  els.selectTop3.innerHTML = "";
  if (!top.length) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="rank">—</span><span>be the first</span><span class="pts">0</span>`;
    els.selectTop3.appendChild(li);
    return;
  }
  top.forEach((row, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="rank">#${i + 1}</span><span>@${escapeHtml(row.name)}</span><span class="pts">${row.score}</span>`;
    els.selectTop3.appendChild(li);
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function startLbPoll() {
  stopLbPoll();
  const tick = async () => {
    await fetchLeaderboard();
    renderLeaderboard();
  };
  tick();
  lbPollTimer = window.setInterval(tick, LB_POLL_MS);
}

function stopLbPoll() {
  if (lbPollTimer) {
    clearInterval(lbPollTimer);
    lbPollTimer = 0;
  }
}

function resetRound() {
  rung = 0;
  cameraY = 0;
  timeLeft = ROUND_SECONDS;
  lastSide = null;
  stunUntil = 0;
  boostDepth = 0;
  entities = [];
  nextSpawnRung = 2;
  hasWheelToken = false;
  wheelSpent = false;
  claimToken = null;
  canControl = false;
  running = false;
  submitted = false;
  els.submitNote.textContent = "";
  els.hudTime.textContent = "30.0";
  els.hudHeight.textContent = "0";
  els.hudStatus.textContent = "wait";
  hideStun();
  planWheelToken();
  seedEntities();
}

function planWheelToken() {
  wheelRung = null;
  wheelSpawned = false;
  // Slight chance each run; random height at/above 100 (e.g. 100, 111, 200, 300…)
  if (Math.random() > WHEEL_SPAWN_CHANCE) return;
  wheelRung = WHEEL_MIN_HEIGHT + Math.floor(Math.random() * 401); // 100–500
}

function seedEntities() {
  // Place pickups on ladder lines ahead of the player
  for (let r = 2; r < 24; r += 1) {
    if (wheelRung === r) {
      spawnWheel(r);
      wheelSpawned = true;
    } else if (Math.random() < 0.78) {
      spawnLine(r);
    }
  }
  nextSpawnRung = 24;
}

function pickType(exclude = null) {
  const pool = PICKUP_TYPES.filter((t) => t !== exclude);
  return pool[Math.floor(Math.random() * pool.length)];
}

function spawnLine(rungIndex) {
  // One ladder line: L and/or R items, never the same category on both sides
  const y = rungIndex * RUNG_GAP;
  const roll = Math.random();
  if (roll < 0.18) return; // empty line

  if (roll < 0.62) {
    // single side
    entities.push({
      y,
      rung: rungIndex,
      side: Math.random() < 0.5 ? "L" : "R",
      type: pickType(),
      hit: false,
    });
    return;
  }

  // both sides — different types only (e.g. 💥 right + ⚡ left is ok; two 💥 is not)
  const leftType = pickType();
  const rightType = pickType(leftType);
  entities.push({ y, rung: rungIndex, side: "L", type: leftType, hit: false });
  entities.push({ y, rung: rungIndex, side: "R", type: rightType, hit: false });
}

function spawnWheel(rungIndex) {
  // Only one 🎡 per game — occupies one side; other side can still have boost/hazard
  const y = rungIndex * RUNG_GAP;
  const side = Math.random() < 0.5 ? "L" : "R";
  entities.push({ y, rung: rungIndex, side, type: "wheel", hit: false });
  const other = side === "L" ? "R" : "L";
  if (Math.random() < 0.55) {
    entities.push({
      y,
      rung: rungIndex,
      side: other,
      type: pickType(),
      hit: false,
    });
  }
}

function ensureSpawns() {
  while (nextSpawnRung < rung + 22) {
    if (wheelRung != null && nextSpawnRung === wheelRung && !wheelSpawned) {
      spawnWheel(nextSpawnRung);
      wheelSpawned = true;
    } else {
      spawnLine(nextSpawnRung);
    }
    nextSpawnRung += 1;
  }
  entities = entities.filter((e) => e.rung > rung - 4);
}

function statusLabel(now) {
  if (now < stunUntil) {
    return `${PICKUP_EMOJI.hazard} stun`;
  }
  return "climb";
}

function showStun(secondsLeft) {
  if (!els.stunOverlay) return;
  els.stunOverlay.classList.remove("hidden");
  els.stunTimer.textContent = secondsLeft.toFixed(1);
}

function hideStun() {
  if (!els.stunOverlay) return;
  els.stunOverlay.classList.add("hidden");
}

/** Advance one ladder line. During boost travel, skip pickup effects on those free lines. */
function advanceOneLine(side, { fromBoost = false } = {}) {
  rung += 1;
  lastSide = side;
  ensureSpawns();
  if (fromBoost) {
    // Free +2 lines: clear anything on this rung/side without activating it
    passThroughPickups(side);
  } else {
    checkPickups(performance.now(), side);
  }
  els.hudHeight.textContent = String(rung);
  els.hudStatus.textContent = statusLabel(performance.now());
}

function passThroughPickups(playerSide) {
  // Move through the line — clear ⚡/💥 without effect; 🎡 still counts as found
  for (const e of entities) {
    if (e.hit) continue;
    if (e.rung !== rung) continue;
    if (e.side !== playerSide) continue;
    e.hit = true;
    if (e.type === "wheel") {
      hasWheelToken = true;
      els.hudStatus.textContent = `${PICKUP_EMOJI.wheel} wheel!`;
    }
  }
}

function tryClimb(side) {
  if (!canControl || !running) return;

  const now = performance.now();
  if (now < stunUntil) return; // frozen after 💥 hit

  // Movement is always exactly one ladder line per tap
  advanceOneLine(side);
}

function consumeTypeOnRung(rungIndex, type) {
  // Same category on one row can't stack — collecting one clears the rest on that line
  for (const e of entities) {
    if (e.rung === rungIndex && e.type === type) e.hit = true;
  }
}

function checkPickups(now, playerSide) {
  for (const e of entities) {
    if (e.hit) continue;
    if (e.rung !== rung) continue; // only the line you're standing on
    if (e.side !== playerSide) continue;
    e.hit = true;

    if (e.type === "boost") {
      // One ⚡ only on this row
      consumeTypeOnRung(rung, "boost");

      els.hudStatus.textContent = `${PICKUP_EMOJI.boost} +2`;
      boostDepth += 1;
      for (let i = 0; i < 2; i++) {
        // Bonus lines never activate obstacles/boosts above the power-up
        advanceOneLine(playerSide, { fromBoost: true });
      }
      boostDepth -= 1;
      return;
    }

    if (e.type === "hazard") {
      // One 💥 only — clear any other obstacle on this row, stun once (no stack)
      consumeTypeOnRung(rung, "hazard");
      const t = performance.now();
      if (t < stunUntil) return; // already stunned; don't refresh/stack
      stunUntil = t + STUN_MS;
      showStun(STUN_MS / 1000);
      return;
    }

    if (e.type === "wheel") {
      hasWheelToken = true;
      els.hudStatus.textContent = `${PICKUP_EMOJI.wheel} wheel!`;
      return;
    }
  }
}

function draw(now) {
  const w = els.canvas.width;
  const h = els.canvas.height;
  ctx.clearRect(0, 0, w, h);

  const playerY = worldY();
  const targetCam = playerY - h * 0.35;
  cameraY += (targetCam - cameraY) * 0.22;

  ctx.fillStyle = "#07131f";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 8; i++) {
    const gy = ((i * 80 - cameraY * 0.3) % (h + 80)) - 40;
    ctx.fillStyle = i % 2 ? "rgba(30,70,110,0.12)" : "rgba(20,50,80,0.08)";
    ctx.fillRect(0, gy, w, 40);
  }

  const mid = w / 2;
  const railL = mid - 54;
  const railR = mid + 54;

  ctx.strokeStyle = "rgba(120,180,230,0.55)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(railL, 0);
  ctx.lineTo(railL, h);
  ctx.moveTo(railR, 0);
  ctx.lineTo(railR, h);
  ctx.stroke();

  const first = Math.floor(cameraY / RUNG_GAP) * RUNG_GAP;
  for (let y = first; y < cameraY + h + RUNG_GAP; y += RUNG_GAP) {
    const sy = h - (y - cameraY);
    ctx.strokeStyle = "rgba(160,200,240,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(railL, sy);
    ctx.lineTo(railR, sy);
    ctx.stroke();
  }

  for (const e of entities) {
    if (e.hit) continue;
    const sy = h - (e.y - cameraY);
    if (sy < -30 || sy > h + 30) continue;
    const x = e.side === "L" ? railL - 28 : railR + 28;
    drawEntity(x, sy, e.type);
  }

  const py = h - (playerY - cameraY);
  const px = mid;
  if (sprite) {
    const size = 56;
    ctx.drawImage(sprite, px - size / 2, py - size + 8, size, size);
  } else {
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(px, py - 28, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  // Stun flash on the mfer
  if (now < stunUntil) {
    ctx.fillStyle = "rgba(255, 80, 80, 0.28)";
    ctx.fillRect(px - 32, py - 56, 64, 64);
  }

  ctx.fillStyle = lastSide === "L" ? "rgba(62,176,255,0.85)" : "rgba(255,255,255,0.2)";
  ctx.fillRect(12, h - 18, 40, 6);
  ctx.fillStyle = lastSide === "R" ? "rgba(62,176,255,0.85)" : "rgba(255,255,255,0.2)";
  ctx.fillRect(w - 52, h - 18, 40, 6);
}

function drawEntity(x, y, type) {
  // Bright badge behind emoji so they read on the dark navy ladder
  const badge =
    type === "boost"
      ? "rgba(40, 90, 60, 0.95)"
      : type === "wheel"
        ? "rgba(90, 70, 20, 0.95)"
        : "rgba(90, 35, 40, 0.95)";
  const ring =
    type === "boost" ? "#6ee7a8" : type === "wheel" ? "#f5d76e" : "#ff6b6b";

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.fillStyle = badge;
  ctx.fill();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = "20px 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(PICKUP_EMOJI[type] || "?", x, y + 1);
  ctx.restore();
}

function loop(ts) {
  if (!running) return;
  if (!lastTs) lastTs = ts;
  const dt = Math.min(0.05, (ts - lastTs) / 1000);
  lastTs = ts;

  const now = performance.now();

  if (canControl) {
    timeLeft = Math.max(0, timeLeft - dt);
    els.hudTime.textContent = timeLeft.toFixed(1);
    if (timeLeft <= 0) {
      hideStun();
      endRound();
      return;
    }
  }

  if (now < stunUntil) {
    const left = (stunUntil - now) / 1000;
    showStun(left);
    els.hudStatus.textContent = statusLabel(now);
  } else if (els.stunOverlay && !els.stunOverlay.classList.contains("hidden")) {
    hideStun();
    els.hudStatus.textContent = statusLabel(now);
  }

  draw(now);
  raf = requestAnimationFrame(loop);
}

async function startCountdown() {
  show(els.play);
  resetRound();
  els.countdown.classList.remove("hidden");
  draw(performance.now());

  const steps = ["3", "2", "1", "GO!"];
  for (const s of steps) {
    els.countdown.textContent = s;
    await wait(s === "GO!" ? 450 : 700);
  }
  els.countdown.classList.add("hidden");
  canControl = true;
  running = true;
  lastTs = 0;
  els.hudStatus.textContent = "climb";
  raf = requestAnimationFrame(loop);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function endRound() {
  running = false;
  canControl = false;
  cancelAnimationFrame(raf);
  const score = rung;
  els.finalScore.textContent = String(score);
  setupWheelPanel();
  show(els.results);
  fetchLeaderboard().then(() => renderLeaderboard(score));
}

function setupWheelPanel() {
  claimToken = null;
  wheelSpent = false;
  els.wheelResult.textContent = "";
  els.wheelNote.textContent = "";
  els.claimForm.classList.add("hidden");
  els.claimWallet.value = "";
  els.wheelActions.classList.remove("hidden");
  els.btnSpin.disabled = false;
  els.prizeWheel.style.transition = "none";
  els.prizeWheel.style.transform = `rotate(${wheelRotation}deg)`;

  if (!hasWheelToken) {
    els.wheelPanel.classList.add("hidden");
    return;
  }

  els.wheelPanel.classList.remove("hidden");
  els.wheelTitle.textContent = "You found a wheel!";
  els.wheelCopy.textContent = "Free Mfer Arc or Zonk";
  els.wheelCopy.classList.remove("hidden");
  fetch("/api/wheel", { cache: "no-store" })
    .then((r) => r.json())
    .then((data) => {
      if (!data.available) {
        els.wheelTitle.textContent = "Spin is unavailable";
        els.wheelCopy.textContent = `All ${data.prizeName} prizes have been claimed.`;
        els.btnSpin.disabled = true;
      } else {
        els.wheelCopy.textContent = `${data.prizeName} or Zonk`;
      }
    })
    .catch(() => {});
}

function discardWheelToken() {
  hasWheelToken = false;
  wheelSpent = true;
  claimToken = null;
  els.wheelPanel.classList.add("hidden");
}

async function spinWheel() {
  if (!hasWheelToken || wheelSpent) return;
  const twitter = normalizeTwitterUser(els.playerName.value);
  if (!twitter) {
    els.wheelNote.textContent = "Enter your Twitter username above first.";
    els.playerName.focus();
    return;
  }

  els.btnSpin.disabled = true;
  els.wheelNote.textContent = "Spinning…";
  els.wheelResult.textContent = "";

  let data;
  try {
    const res = await fetch("/api/wheel/spin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ twitter }),
    });
    data = await res.json();
  } catch {
    els.wheelNote.textContent = "Spin failed — is the local server running?";
    els.btnSpin.disabled = false;
    return;
  }

  if (data.result === "unavailable") {
    els.wheelTitle.textContent = "Spin is unavailable";
    els.wheelResult.textContent = "No prizes left";
    els.wheelNote.textContent = `All ${data.prizeName || "prizes"} claimed.`;
    discardWheelToken();
    els.wheelPanel.classList.remove("hidden");
    els.wheelActions.classList.add("hidden");
    return;
  }

  // Animate wheel: prize segment is ~18–36deg; zonk lands elsewhere
  const isPrize = data.result === "prize";
  const land = isPrize ? 24 + Math.random() * 8 : 80 + Math.random() * 250;
  wheelRotation += 360 * (5 + Math.floor(Math.random() * 3)) + (360 - land);
  els.prizeWheel.style.transition = "transform 4s cubic-bezier(0.12, 0.75, 0.12, 1)";
  els.prizeWheel.style.transform = `rotate(${wheelRotation}deg)`;

  await wait(4100);
  wheelSpent = true;
  hasWheelToken = false; // used — can't accumulate or reuse

  if (isPrize) {
    claimToken = data.claimToken;
    els.wheelResult.textContent = `🎉 ${data.prizeName}!`;
    els.wheelNote.textContent = "Enter your wallet to claim. Same Twitter can’t win twice.";
    els.wheelActions.classList.add("hidden");
    els.claimForm.classList.remove("hidden");
  } else {
    els.wheelResult.textContent = data.reason === "already_won" ? "Already won" : "Zonk";
    els.wheelNote.textContent =
      data.message || "Better luck next climb — find another 🎡 token.";
    els.wheelActions.classList.add("hidden");
  }
}

async function claimPrize(e) {
  e.preventDefault();
  if (!claimToken) return;
  const twitter = normalizeTwitterUser(els.playerName.value);
  const wallet = els.claimWallet.value.trim();
  els.wheelNote.textContent = "Claiming…";
  try {
    const res = await fetch("/api/wheel/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ twitter, wallet, claimToken }),
    });
    const data = await res.json();
    if (!res.ok) {
      els.wheelNote.textContent = data.error || "Claim failed";
      return;
    }
    if (data.result === "unavailable") {
      els.wheelResult.textContent = "Spin is unavailable";
      els.wheelNote.textContent = "Prizes just ran out.";
      els.claimForm.classList.add("hidden");
      return;
    }
    els.wheelNote.textContent = `Claimed ${data.prizeName}! We'll use @${twitter} + your wallet.`;
    els.claimForm.classList.add("hidden");
    claimToken = null;
    // Offer a brag tweet for the win
    const brag = document.createElement("a");
    brag.className = "btn play";
    brag.href = tweetIntentUrl(buildPrizeTweet({ prizeName: data.prizeName, username: twitter }));
    brag.target = "_blank";
    brag.rel = "noopener noreferrer";
    brag.textContent = "Brag on X";
    brag.style.marginTop = "0.65rem";
    brag.style.display = "inline-flex";
    els.wheelNote.after(brag);
  } catch {
    els.wheelNote.textContent = "Claim failed — try again.";
  }
}

function currentTweetText() {
  const score = rung;
  const username = normalizeTwitterUser(els.playerName.value);
  return buildScoreTweet({ score, username });
}

function bindControls() {
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      tryClimb("L");
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      tryClimb("R");
    }
  });

  const press = (btn, side) => {
    const down = (ev) => {
      ev.preventDefault();
      btn.classList.add("pressed");
      tryClimb(side);
    };
    const up = () => btn.classList.remove("pressed");
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointerleave", up);
    btn.addEventListener("pointercancel", up);
  };
  press(els.btnLeft, "L");
  press(els.btnRight, "R");
}

els.btnConfirmChar.addEventListener("click", async () => {
  if (selectedId == null) return;
  els.tutorialPortrait.src = artUrl(selectedId);
  try {
    sprite = await loadImage(artUrl(selectedId));
  } catch {
    sprite = null;
  }
  show(els.tutorial);
});

els.btnBackSelect.addEventListener("click", () => show(els.select));
els.btnStart.addEventListener("click", () => startCountdown());
els.btnReplay.addEventListener("click", () => {
  // Leaving results without spinning burns the token
  if (hasWheelToken && !wheelSpent) discardWheelToken();
  show(els.tutorial);
});

els.btnSpin.addEventListener("click", () => spinWheel());
els.btnSkipWheel.addEventListener("click", () => {
  discardWheelToken();
  els.wheelNote.textContent = "Token discarded. Find another 🎡 above height 100.";
});
els.claimForm.addEventListener("submit", claimPrize);

els.btnTweet.addEventListener("click", () => {
  const username = normalizeTwitterUser(els.playerName.value);
  if (!username) {
    els.submitNote.textContent = `Enter your @${TWITTER_HANDLE} Twitter username first.`;
    els.playerName.focus();
    return;
  }
  window.open(tweetIntentUrl(currentTweetText()), "_blank", "noopener,noreferrer");
  els.submitNote.textContent = `Tweet opened — tag @${TWITTER_HANDLE}, then submit below.`;
});

els.scoreForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (submitted) {
    els.submitNote.textContent = "Already submitted this run.";
    return;
  }
  const name = normalizeTwitterUser(els.playerName.value);
  if (!name) {
    els.submitNote.textContent = "Twitter username is required.";
    els.playerName.focus();
    return;
  }
  const score = rung;
  els.submitNote.textContent = "Submitting…";
  try {
    await submitScore(name, score);
    submitted = true;
    els.submitNote.textContent = `Posted as @${name}. Board updates live — if someone passes you, ranks reshuffle.`;
    renderLeaderboard(score);
  } catch (err) {
    els.submitNote.textContent = err?.message || "Could not submit. Is the local server running?";
  }
});

fitCanvas();
renderCharSelect();
bindControls();
fetchLeaderboard().then(() => renderLeaderboard());
show(els.select);

function fitCanvas() {
  els.canvas.width = 400;
  els.canvas.height = 640;
}
