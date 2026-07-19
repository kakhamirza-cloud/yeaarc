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

// Prefer sibling ARC Mfers output; fall back if Netlify/CI already has public/art
const SOURCES = [
  join(PROJECT, "..", "ARC Mfers", "output", "mfers"),
  join(PROJECT, "art-source"),
];

const source = SOURCES.find((p) => existsSync(p));

if (!source) {
  if (existsSync(DEST) && readdirSync(DEST).some((f) => f.endsWith(".png"))) {
    writeIds(DEST);
    console.log(`Using existing ${DEST}`);
    process.exit(0);
  }
  // Site uses /gallery samples in git — skip full art sync on Netlify/CI
  console.log(
    "No art source found; skipping sync (gallery samples are enough for deploy)."
  );
  process.exit(0);
}

mkdirSync(DEST, { recursive: true });

// Clean old PNGs so deleted tokens don't linger, keep folder
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

function writeIds(dir) {
  const ids = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .map((f) => Number(f.replace(/\.png$/i, "")))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  writeFileSync(join(dir, "ids.json"), JSON.stringify({ count: ids.length, ids }));
}
