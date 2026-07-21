/**
 * Reads data/mint-whitelist.txt → data/mint-whitelist.json
 * Run: npm run whitelist:parse
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TXT = join(ROOT, "data", "mint-whitelist.txt");
const JSON_OUT = join(ROOT, "data", "mint-whitelist.json");

function parseWhitelist(content) {
  const wallets = [];
  const seen = new Set();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/0x[a-fA-F0-9]{40}/);
    if (!match) {
      console.warn(`Skipped invalid line: ${trimmed}`);
      continue;
    }

    const wallet = match[0].toLowerCase();
    if (seen.has(wallet)) continue;
    seen.add(wallet);
    wallets.push(wallet);
  }

  return wallets;
}

const wallets = parseWhitelist(readFileSync(TXT, "utf8"));
writeFileSync(JSON_OUT, `${JSON.stringify(wallets, null, 2)}\n`);
console.log(`Whitelist: ${wallets.length} wallet(s) → data/mint-whitelist.json`);
