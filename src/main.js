import { CONFIG, formatPrice } from "./config.js";

/** Only these PNGs ship with the site (full 5k stays offline for mint/IPFS). */
const GALLERY_IDS = [
  0, 1, 2, 3, 7, 10, 12, 21, 42, 55, 56, 69, 100, 111, 222, 301, 333, 420, 690,
  1000, 1337, 2000, 2500, 3000, 3333, 4000, 4200, 4500, 4999,
];

const els = {
  heroCollage: document.getElementById("heroCollage"),
  collectionGrid: document.getElementById("collectionGrid"),
  mintPreview: document.getElementById("mintPreview"),
  navMark: document.getElementById("navMark"),
  mintedLabel: document.getElementById("mintedLabel"),
  mintPriceLabel: document.getElementById("mintPriceLabel"),
  progressBar: document.getElementById("progressBar"),
  supplyStat: document.getElementById("supplyStat"),
  priceStat: document.getElementById("priceStat"),
};

function artUrl(id) {
  // New path avoids poisoned /art/* CDN cache (was immutable for 1 year)
  return `/gallery/${id}.png`;
}

function pick(ids, n) {
  const copy = [...ids];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length));
}

function makeTile(id, { interactive = true } = {}) {
  const tile = document.createElement(interactive ? "button" : "div");
  if (interactive) tile.type = "button";
  tile.className = "tile";
  tile.setAttribute("aria-label", `ARC mfer #${id}`);

  const img = document.createElement("img");
  img.src = artUrl(id);
  img.alt = `ARC mfer #${id}`;
  img.loading = "lazy";
  img.width = 200;
  img.height = 200;
  tile.appendChild(img);

  if (interactive) {
    tile.addEventListener("click", () => setPreview(id));
  }

  return tile;
}

function setPreview(id) {
  els.mintPreview.src = artUrl(id);
  if (els.navMark) els.navMark.src = artUrl(id);
}

function renderCollage(ids) {
  els.heroCollage.innerHTML = "";
  ids.slice(0, 18).forEach((id, i) => {
    const tile = makeTile(id, { interactive: false });
    tile.style.animationDelay = `${i * 40}ms`;
    els.heroCollage.appendChild(tile);
  });
}

function renderCollection(ids) {
  els.collectionGrid.innerHTML = "";
  ids.forEach((id) => els.collectionGrid.appendChild(makeTile(id)));
}

function bootGallery() {
  const collageIds = pick(GALLERY_IDS, 18);
  setPreview(collageIds[0] ?? 69);
  renderCollage(collageIds);
  renderCollection(pick(GALLERY_IDS, 24));
}

els.priceStat.textContent = formatPrice(CONFIG.mintPrice);
els.mintPriceLabel.textContent = formatPrice(CONFIG.mintPrice);
els.supplyStat.textContent = CONFIG.maxSupply.toLocaleString();
els.mintedLabel.textContent = `— / ${CONFIG.maxSupply.toLocaleString()}`;
els.progressBar.style.width = "0%";

bootGallery();
