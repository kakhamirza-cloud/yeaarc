import { CONFIG, formatPrice } from "./config.js";

const FALLBACK_IDS = [
  0, 1, 2, 3, 7, 10, 12, 21, 42, 55, 56, 69, 100, 111, 222, 301, 333, 420, 2178,
  2195, 2375, 2388, 2420, 2441, 2453, 2472, 2475, 2481,
];

const COMING_SOON = "Mint is coming soon.";

const els = {
  connectBtn: document.getElementById("connectBtn"),
  connectLabel: document.getElementById("connectLabel"),
  heroMintBtn: document.getElementById("heroMintBtn"),
  heroStatus: document.getElementById("heroStatus"),
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
  const loop = [...ids, ...ids];
  loop.forEach((id) => els.marqueeTrack.appendChild(makeTile(id)));
}

function renderCollection(ids) {
  els.collectionGrid.innerHTML = "";
  ids.forEach((id) => els.collectionGrid.appendChild(makeTile(id)));
}

function showComingSoon(where = "mint") {
  if (where === "hero" && els.heroStatus) {
    els.heroStatus.textContent = COMING_SOON;
  }
  if (els.mintStatus) {
    els.mintStatus.textContent = COMING_SOON;
    els.mintStatus.className = "mint-status ok";
  }
}

function syncQtyUi() {
  const max = CONFIG.maxPerWallet;
  els.qtyInput.max = String(max);
  qty = Math.min(Math.max(1, qty), max);
  els.qtyInput.value = String(qty);
  els.mintBtn.textContent = "Connect to mint";
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

function bindUi() {
  els.qtyInput.max = String(CONFIG.maxPerWallet);
  els.priceStat.textContent = formatPrice(CONFIG.mintPrice);
  els.mintPriceLabel.textContent = formatPrice(CONFIG.mintPrice);
  els.supplyStat.textContent = CONFIG.maxSupply.toLocaleString();
  els.mintedLabel.textContent = `— / ${CONFIG.maxSupply.toLocaleString()}`;
  els.progressBar.style.width = "0%";
  els.connectLabel.textContent = "connect";

  els.connectBtn.addEventListener("click", () => showComingSoon("hero"));
  els.heroMintBtn.addEventListener("click", () => showComingSoon("hero"));
  els.mintBtn.addEventListener("click", () => showComingSoon("mint"));

  els.qtyMinus.addEventListener("click", () => {
    qty = Math.max(1, qty - 1);
    syncQtyUi();
  });
  els.qtyPlus.addEventListener("click", () => {
    qty = Math.min(CONFIG.maxPerWallet, qty + 1);
    syncQtyUi();
  });
  els.qtyInput.addEventListener("change", () => {
    qty = Number(els.qtyInput.value) || 1;
    syncQtyUi();
  });

  syncQtyUi();
}

bindUi();
loadArtIds();
