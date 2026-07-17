import { BrowserProvider, Contract, parseEther } from "ethers";
import { ARC_CHAIN, CONFIG, MINT_ABI, shortAddress } from "./config.js";

let provider = null;
let signer = null;
let address = null;

export function getAddress() {
  return address;
}

export function isConnected() {
  return Boolean(address);
}

export function hasContract() {
  return Boolean(CONFIG.contractAddress && /^0x[a-fA-F0-9]{40}$/.test(CONFIG.contractAddress));
}

function getEthereum() {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

export async function connectWallet() {
  const eth = getEthereum();
  if (!eth) {
    throw new Error("No wallet found. Install MetaMask or another injected wallet.");
  }

  provider = new BrowserProvider(eth);
  await provider.send("eth_requestAccounts", []);
  await ensureArcNetwork();
  signer = await provider.getSigner();
  address = await signer.getAddress();

  eth.removeListener?.("accountsChanged", onAccountsChanged);
  eth.removeListener?.("chainChanged", onChainChanged);
  eth.on?.("accountsChanged", onAccountsChanged);
  eth.on?.("chainChanged", onChainChanged);

  return address;
}

async function onAccountsChanged(accounts) {
  if (!accounts?.length) {
    address = null;
    signer = null;
    window.dispatchEvent(new CustomEvent("wallet:changed", { detail: { address: null } }));
    return;
  }
  address = accounts[0];
  if (provider) signer = await provider.getSigner();
  window.dispatchEvent(new CustomEvent("wallet:changed", { detail: { address } }));
}

function onChainChanged() {
  window.location.reload();
}

export async function ensureArcNetwork() {
  const eth = getEthereum();
  if (!eth) throw new Error("No wallet found.");

  const current = await eth.request({ method: "eth_chainId" });
  if (current?.toLowerCase() === ARC_CHAIN.chainIdHex.toLowerCase()) return;

  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ARC_CHAIN.chainIdHex }],
    });
  } catch (err) {
    if (err?.code === 4902 || String(err?.message || "").includes("4902")) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: ARC_CHAIN.chainIdHex,
            chainName: ARC_CHAIN.name,
            nativeCurrency: ARC_CHAIN.nativeCurrency,
            rpcUrls: [ARC_CHAIN.rpcUrl],
            blockExplorerUrls: [ARC_CHAIN.explorer],
          },
        ],
      });
      return;
    }
    throw err;
  }
}

export async function fetchMinted() {
  if (!hasContract()) return { minted: null, max: CONFIG.maxSupply };

  const eth = getEthereum();
  let p = eth ? new BrowserProvider(eth) : null;
  if (!p) {
    const { JsonRpcProvider } = await import("ethers");
    p = new JsonRpcProvider(ARC_CHAIN.rpcUrl);
  }

  const contract = new Contract(CONFIG.contractAddress, MINT_ABI, p);
  try {
    const minted = Number(await contract.totalSupply());
    let max = CONFIG.maxSupply;
    try {
      max = Number(await contract.maxSupply());
    } catch {
      /* optional */
    }
    return { minted, max };
  } catch {
    return { minted: null, max: CONFIG.maxSupply };
  }
}

export async function mintNfts(quantity) {
  if (!hasContract()) {
    throw new Error("Mint isn’t available yet. Try again shortly.");
  }
  if (!signer || !address) {
    throw new Error("Connect your wallet first.");
  }

  await ensureArcNetwork();
  const contract = new Contract(CONFIG.contractAddress, MINT_ABI, signer);
  const value =
    CONFIG.mintPrice != null && CONFIG.mintPrice > 0
      ? parseEther(String(CONFIG.mintPrice * quantity))
      : 0n;

  let tx;
  try {
    tx = await contract[CONFIG.mintFn](quantity, { value });
  } catch (err) {
    if (CONFIG.mintFn !== "publicMint") {
      tx = await contract.publicMint(quantity, { value });
    } else {
      throw err;
    }
  }

  const receipt = await tx.wait();
  return { hash: tx.hash, receipt };
}

export { shortAddress };
