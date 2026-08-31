import { verifyMessage } from "ethers";

export const STAKE_AUTH_TTL_MS = 15 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 60 * 1000;

export function buildStakeAuthMessage(wallet, issuedAt) {
  const normalized = String(wallet || "").trim().toLowerCase();
  return [
    "ARC mfers soft stake beta",
    `Wallet: ${normalized}`,
    `Issued at: ${Number(issuedAt)}`,
    "Purpose: Authorize off-chain staking actions for this wallet.",
    "This is not a blockchain transaction and cannot transfer tokens.",
  ].join("\n");
}

export function verifyStakeAuthorization({ wallet, signature, issuedAt }, now = Date.now()) {
  const issued = Number(issuedAt);
  if (!Number.isFinite(issued)) {
    return { ok: false, error: "wallet authorization required", status: 401 };
  }
  if (issued > now + MAX_FUTURE_SKEW_MS || now - issued > STAKE_AUTH_TTL_MS) {
    return { ok: false, error: "wallet authorization expired — sign in again", status: 401 };
  }
  if (typeof signature !== "string" || !signature.startsWith("0x")) {
    return { ok: false, error: "wallet signature required", status: 401 };
  }

  try {
    const recovered = verifyMessage(buildStakeAuthMessage(wallet, issued), signature).toLowerCase();
    if (recovered !== String(wallet).toLowerCase()) {
      return { ok: false, error: "wallet signature does not match", status: 401 };
    }
  } catch {
    return { ok: false, error: "invalid wallet signature", status: 401 };
  }

  return { ok: true };
}
