import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(ROOT, "..");
const DEST = join(PROJECT, "public", "art");
const GALLERY = join(PROJECT, "public", "gallery");

// Cloudflare / CI cannot ship ~9k PNGs — use gallery samples only
const lightDeploy =
  process.env.SKIP_FULL_ART === "1" ||
  process.env.CF_PAGES === "1" ||
  process.env.CI === "true";

const SOURCES = [
  join(PROJECT, "..", "ARC Mfers", "output", "mfers"),
  join(PROJECT, "art-source"),
];

const source = SOURCES.find((p) => existsSync(p));

if (lightDeploy || !source) {
  ensureLightArt();
  process.exit(0);
}

mkdirSync(DEST, { recursive: true });
for (const name of readdirSync(DEST)) {
  if (name.endsWith(".png") || name === "ids.json") {
    rmSync(join(DEST, name), { force: true });
  }
}

const files = readdirSync(source).filter((f) => f.toLowerCase().endsWith(".png"));
for (const file of files) {
  cpSync(join(source, file), join(DEST, file));
}

writeIds(DEST);
console.log(`Synced ${files.length} images → public/art`);

/** Copy gallery samples into /art so production deploys stay small. */
function ensureLightArt() {
  mkdirSync(DEST, { recursive: true });

  // Wipe previous full sync so Cloudflare doesn't upload 900MB
  for (const name of readdirSync(DEST)) {
    if (name.endsWith(".png") || name === "ids.json") {
      rmSync(join(DEST, name), { force: true });
    }
  }

  if (!existsSync(GALLERY)) {
    console.log("No gallery/ folder; public/art left empty for this build.");
    writeFileSync(join(DEST, "ids.json"), JSON.stringify({ count: 0, ids: [] }));
    return;
  }

  const files = readdirSync(GALLERY).filter((f) => f.toLowerCase().endsWith(".png"));
  for (const file of files) {
    cpSync(join(GALLERY, file), join(DEST, file));
  }
  writeIds(DEST);
  console.log(
    `Light deploy: copied ${files.length} gallery samples → public/art (full set skipped for Cloudflare).`
  );
}

function writeIds(dir) {
  const ids = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .map((f) => Number(f.replace(/\.png$/i, "")))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  writeFileSync(join(dir, "ids.json"), JSON.stringify({ count: ids.length, ids }));
}
