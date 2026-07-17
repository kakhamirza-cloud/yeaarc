import { CONFIG, formatPrice, shortAddress } from "./config.js";
import {
  connectWallet,
  fetchMinted,
  getAddress,
  hasContract,
  isConnected,
  mintNfts,
} from "./wallet.js";

const FALLBACK_IDS = [
  0, 1, 2, 3, 7, 10, 12, 21, 42, 55, 56, 69, 100, 111, 222, 301, 333, 420, 2178,
  2195, 2375, 2388, 2420, 2441, 2453, 2472, 2475, 2481,
];

const els = {
  connectBtn: document.getElementById("connectBtn"),
  connectLabel: document.getElementById("connectLabel"),
  marqueeTrack: document.getElementById("marqueeTrack"),
  collectionGrid: document.getElementById("collectionGrid"),
  mintPreview: document.getElementById("mintPreview"),
  navMark: document.getElementById("navMark"),
  qtyInput: document.getElementById("qtyInput"),
  qtyMinus: document.getElementById("qtyMinus"),
  qtyPlus: document.getElementById("qtyPlus"),
  mintBtn: document.getElementById("mintBtn"),
  mintStatus: document.getElementById("mintStatus"),
  mintedLabel: document.getElementById("mintedLabel"),
  mintPriceLabel: document.getElementById("mintPriceLabel"),
  progressBar: document.getElementById("progressBar"),
  supplyStat: document.getElementById("supplyStat"),
  priceStat: document.getElementById("priceStat"),
};

let artIds = [...FALLBACK_IDS];
let qty = 1;

function artUrl(id) {
  return `/art/${id}.png`;
}

function pick(ids, n) {
  const copy = [...ids];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function makeTile(id) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "tile";
  tile.setAttribute("aria-label", `ARC mfer #${id}`);

  const img = document.createElement("img");
  img.src = artUrl(id);
  img.alt = `mfer #${id}`;
  img.loading = "lazy";
  img.width = 200;
  img.height = 200;
  tile.appendChild(img);

  tile.addEventListener("click", () => setPreview(id));
  return tile;
}

function setPreview(id) {
  els.mintPreview.src = artUrl(id);
  if (els.navMark) els.navMark.src = artUrl(id);
}

function renderMarquee(ids) {
  els.marqueeTrack.innerHTML = "";
  // Duplicate strip so the CSS loop can scroll seamlessly
  const loop = [...ids, ...ids];
  loop.forEach((id) => els.marqueeTrack.appendChild(makeTile(id)));
}

function renderCollection(ids) {
  els.collectionGrid.innerHTML = "";
  ids.forEach((id) => els.collectionGrid.appendChild(makeTile(id)));
}

function setStatus(msg, kind = "") {
  els.mintStatus.textContent = msg;
  els.mintStatus.className = `mint-status${kind ? ` ${kind}` : ""}`;
}

function syncQtyUi() {
  const max = CONFIG.maxPerWallet;
  els.qtyInput.max = String(max);
  qty = Math.min(Math.max(1, qty), max);
  els.qtyInput.value = String(qty);
}

function syncWalletUi() {
  const addr = getAddress();
  if (addr) {
    els.connectBtn.classList.add("connected");
    els.connectLabel.textContent = shortAddress(addr);
    els.mintBtn.textContent = `Mint ${qty}`;
  } else {
    els.connectBtn.classList.remove("connected");
    els.connectLabel.textContent = "connect";
    els.mintBtn.textContent = "Connect to mint";
  }
}

async function refreshSupply() {
  const { minted, max } = await fetchMinted();
  const maxLabel = max.toLocaleString();
  els.supplyStat.textContent = maxLabel;

  if (minted == null) {
    els.mintedLabel.textContent = `— / ${maxLabel}`;
    els.progressBar.style.width = "0%";
  } else {
    els.mintedLabel.textContent = `${minted.toLocaleString()} / ${maxLabel}`;
    els.progressBar.style.width = `${Math.min(100, (minted / max) * 100)}%`;
  }
}

async function loadArtIds() {
  try {
    const res = await fetch("/art/ids.json");
    if (!res.ok) throw new Error("ids fetch failed");
    const data = await res.json();
    if (Array.isArray(data.ids) && data.ids.length) {
      artIds = data.ids;
    }
  } catch {
    /* fallback ids already set */
  }

  const marqueeIds = pick(artIds, 24);
  setPreview(marqueeIds[0] ?? 69);
  renderMarquee(marqueeIds);
  renderCollection(pick(artIds, 28));
}

async function onConnect() {
  try {
    setStatus("Connecting…");
    await connectWallet();
    syncWalletUi();
    setStatus(`Connected ${shortAddress(getAddress())}`, "ok");
    await refreshSupply();
  } catch (err) {
    setStatus(err?.message || "Connection failed", "error");
  }
}

async function onMint() {
  if (!isConnected()) {
    await onConnect();
    if (!isConnected()) return;
  }

  if (!hasContract()) {
    setStatus("Mint is warming up — try again in a moment.", "error");
    return;
  }

  try {
    els.mintBtn.disabled = true;
    setStatus(`Minting ${qty}… confirm in your wallet`);
    const { hash } = await mintNfts(qty);
    setStatus(`Minted! Tx ${hash.slice(0, 10)}…`, "ok");
    await refreshSupply();
  } catch (err) {
    const msg = err?.shortMessage || err?.reason || err?.message || "Mint failed";
    setStatus(msg, "error");
  } finally {
    els.mintBtn.disabled = false;
    syncWalletUi();
  }
}

function bindUi() {
  els.qtyInput.max = String(CONFIG.maxPerWallet);
  els.priceStat.textContent = formatPrice(CONFIG.mintPrice);
  els.mintPriceLabel.textContent = formatPrice(CONFIG.mintPrice);
  els.supplyStat.textContent = CONFIG.maxSupply.toLocaleString();

  els.connectBtn.addEventListener("click", onConnect);
  els.mintBtn.addEventListener("click", onMint);

  els.qtyMinus.addEventListener("click", () => {
    qty = Math.max(1, qty - 1);
    syncQtyUi();
    syncWalletUi();
  });
  els.qtyPlus.addEventListener("click", () => {
    qty = Math.min(CONFIG.maxPerWallet, qty + 1);
    syncQtyUi();
    syncWalletUi();
  });
  els.qtyInput.addEventListener("change", () => {
    qty = Number(els.qtyInput.value) || 1;
    syncQtyUi();
    syncWalletUi();
  });

  window.addEventListener("wallet:changed", () => {
    syncWalletUi();
  });

  syncQtyUi();
  syncWalletUi();
}

bindUi();
loadArtIds();
refreshSupply();
