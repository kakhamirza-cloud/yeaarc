const X_URL = "https://x.com/Arc_Mfers";

const els = {
  form: document.getElementById("checkerForm"),
  input: document.getElementById("walletInput"),
  result: document.getElementById("checkerResult"),
  btn: document.getElementById("btnCheck"),
};

function showError(message) {
  els.result.className = "checker-result error";
  els.result.innerHTML = `<p class="checker-verdict">${message}</p>`;
  els.result.classList.remove("hidden");
}

function showWhitelisted() {
  els.result.className = "checker-result wl-yes";
  els.result.innerHTML = `
    <p class="checker-verdict">You're Whitelisted</p>
    <a class="btn notify" href="${X_URL}" target="_blank" rel="noopener noreferrer">Notify me</a>
  `;
  els.result.classList.remove("hidden");
}

function showPublic() {
  els.result.className = "checker-result wl-no";
  els.result.innerHTML = `<p class="checker-verdict">Mfer still in Public Phase</p>`;
  els.result.classList.remove("hidden");
}

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const wallet = els.input.value.trim();
  els.result.classList.add("hidden");
  els.btn.disabled = true;

  try {
    const res = await fetch("/api/checker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet }),
    });
    const data = await res.json();

    if (!res.ok) {
      showError(data?.error || "Could not check wallet.");
      return;
    }

    if (data.whitelisted) showWhitelisted();
    else showPublic();
  } catch {
    showError("Could not check right now. Try again.");
  } finally {
    els.btn.disabled = false;
  }
});
