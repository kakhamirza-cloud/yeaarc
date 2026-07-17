/** Arc Chain network config for wallet connect. */
export const ARC_CHAIN = {
  chainId: 5042002,
  chainIdHex: "0x4CF4B2",
  name: "Arc",
  rpcUrl: "https://rpc.testnet.arc.network",
  explorer: "https://testnet.arcscan.app",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
};

/** Minimal ERC-721 mint ABI — adjust to match your deployed contract. */
export const MINT_ABI = [
  "function mint(uint256 quantity) payable",
  "function publicMint(uint256 quantity) payable",
  "function totalSupply() view returns (uint256)",
  "function maxSupply() view returns (uint256)",
];

export const CONFIG = {
  contractAddress: (import.meta.env.VITE_CONTRACT_ADDRESS || "").trim(),
  mintPrice: parseMintPrice(import.meta.env.VITE_MINT_PRICE),
  maxPerWallet: Number(import.meta.env.VITE_MAX_PER_WALLET ?? 10),
  maxSupply: Number(import.meta.env.VITE_MAX_SUPPLY ?? 5000),
  mintFn: "mint",
};

function parseMintPrice(raw) {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || s === "tba") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function shortAddress(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatPrice(price) {
  if (price == null) return "TBA";
  const n = Number(price);
  if (!Number.isFinite(n)) return "TBA";
  return `${n} USDC`;
}
