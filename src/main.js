import { CONFIG, formatPrice } from "./config.js";

const GALLERY_IDS = [
  0, 1, 2, 3, 7, 10, 12, 21, 42, 55, 56, 69, 100, 111, 222, 301, 333, 420, 690,
  1000, 1337, 2000, 2500, 3000, 3333, 4000, 4200, 4500, 4999,
];

const els = {
  heroFeature: document.getElementById("heroFeature"),
  collectionGrid: document.getElementById("collectionGrid"),
  mintPreview: document.getElementById("mintPreview"),
  navMark: document.getElementById("navMark"),
  mintedLabel: document.getElementById("mintedLabel"),
  mintPriceLabel: document.getElementById("mintPriceLabel"),
  progressBar: document.getElementById("progressBar"),
  supplyStat: document.getElementById("supplyStat"),
  priceStat: document.getElementById("priceStat"),
  menuBtn: document.getElementById("menuBtn"),
  topnav: document.getElementById("topnav"),
};

function artUrl(id) {
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

function makeTile(id) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "tile";
  tile.dataset.id = String(id);
  tile.setAttribute("aria-label", `ARC mfer #${id}`);
  const img = document.createElement("img");
  img.src = artUrl(id);
  img.alt = `ARC mfer #${id}`;
  img.loading = "lazy";
  img.width = 280;
  img.height = 280;
  tile.appendChild(img);
  tile.addEventListener("click", () => setPreview(id));
  return tile;
}

function markActive(id) {
  if (!els.collectionGrid) return;
  els.collectionGrid.querySelectorAll(".tile").forEach((tile) => {
    tile.classList.toggle("is-on", tile.dataset.id === String(id));
  });
}

function setPreview(id) {
  const url = artUrl(id);
  if (els.mintPreview) els.mintPreview.src = url;
  if (els.heroFeature) els.heroFeature.src = url;
  if (els.navMark) els.navMark.src = url;
  markActive(id);
}

function boot() {
  const narrow = window.matchMedia("(max-width: 760px)").matches;
  const ids = pick(GALLERY_IDS, narrow ? 14 : 24);
  setPreview(ids[0] ?? 420);

  if (els.collectionGrid) {
    els.collectionGrid.innerHTML = "";
    ids.forEach((id) => els.collectionGrid.appendChild(makeTile(id)));
    markActive(ids[0] ?? 420);
  }

  if (els.priceStat) els.priceStat.textContent = formatPrice(CONFIG.mintPrice);
  if (els.mintPriceLabel) els.mintPriceLabel.textContent = formatPrice(CONFIG.mintPrice);
  if (els.supplyStat) els.supplyStat.textContent = CONFIG.maxSupply.toLocaleString();
  if (els.mintedLabel) els.mintedLabel.textContent = `— / ${CONFIG.maxSupply.toLocaleString()}`;
  if (els.progressBar) els.progressBar.style.width = "0%";

  if (els.menuBtn && els.topnav) {
    els.menuBtn.addEventListener("click", () => {
      const open = els.topnav.classList.toggle("open");
      els.menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    els.topnav.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        els.topnav.classList.remove("open");
        els.menuBtn.setAttribute("aria-expanded", "false");
      });
    });
  }
}

boot();

async function loadLadderKing() {
  const line = document.getElementById("ladderKingLine");
  if (!line) return;
  try {
    const res = await fetch("/api/leaderboard", { cache: "no-store" });
    const data = await res.json();
    const top = Array.isArray(data.scores) ? data.scores[0] : null;
    line.textContent = top ? `Last #1 @${top.name} — ${top.score}` : "Season closed.";
  } catch {
    line.textContent = "Season closed.";
  }
}

loadLadderKing();
