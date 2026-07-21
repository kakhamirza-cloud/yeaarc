/** Collab / manual mint whitelist (not game wheel prizes). */
import wallets from "../data/mint-whitelist.json";
import { normalizeWallet } from "./game-shared.js";

const SET = new Set(
  (Array.isArray(wallets) ? wallets : [])
    .map((w) => normalizeWallet(w) || String(w).trim().toLowerCase())
    .filter(Boolean)
);

export function isMintWhitelisted(wallet) {
  const normalized = normalizeWallet(wallet);
  return Boolean(normalized && SET.has(normalized));
}

export function mintWhitelistCount() {
  return SET.size;
}
