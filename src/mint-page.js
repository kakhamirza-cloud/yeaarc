import { CONFIG } from "./config.js";
import { connectWallet, getAddress, shortAddress } from "./wallet.js";

const els = {
  connectBtn: document.getElementById("connectBtn"),
  connectLabel: document.getElementById("connectLabel"),
  pageConnectBtn: document.getElementById("pageConnectBtn"),
  mintStatus: document.getElementById("mintStatus"),
  mintedDisplay: document.getElementById("mintedDisplay"),
};

function setStatus(msg, kind = "") {
  els.mintStatus.textContent = msg;
  els.mintStatus.className = `mint-status${kind ? ` ${kind}` : ""}`;
}

function syncWalletUi() {
  const addr = getAddress();
  if (addr) {
    els.connectBtn.classList.add("connected");
    els.connectLabel.textContent = shortAddress(addr);
    els.pageConnectBtn.textContent = `Connected · ${shortAddress(addr)}`;
    setStatus("Wallet connected. Mint opens once the contract is live.", "ok");
  } else {
    els.connectBtn.classList.remove("connected");
    els.connectLabel.textContent = "connect";
    els.pageConnectBtn.textContent = "Connect Wallet";
  }
}

async function onConnect() {
  try {
    setStatus("Connecting…");
    await connectWallet();
    syncWalletUi();
  } catch (err) {
    setStatus(err?.message || "Connection failed", "error");
  }
}

els.mintedDisplay.textContent = `— / ${CONFIG.maxSupply.toLocaleString()}`;
els.connectBtn.addEventListener("click", onConnect);
els.pageConnectBtn.addEventListener("click", onConnect);
window.addEventListener("wallet:changed", syncWalletUi);
syncWalletUi();
