const els = {
  form: document.getElementById("applyForm"),
  wallet: document.getElementById("walletInput"),
  twitter: document.getElementById("twitterInput"),
  follow: document.getElementById("checkFollow"),
  rtLike: document.getElementById("checkRtLike"),
  result: document.getElementById("applyResult"),
  btn: document.getElementById("btnApply"),
};

function showResult(ok, message) {
  els.result.className = `apply-result ${ok ? "ok" : "error"}`;
  els.result.textContent = message;
  els.result.classList.remove("hidden");
}

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.result.classList.add("hidden");
  els.btn.disabled = true;

  try {
    const res = await fetch("/api/wl-apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        wallet: els.wallet.value.trim(),
        twitter: els.twitter.value.trim(),
        followed: els.follow.checked,
        retweetedLiked: els.rtLike.checked,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      showResult(false, data?.error || "Could not submit. Try again.");
      return;
    }
    showResult(
      true,
      data.updated
        ? "Updated — your application was already on file; we refreshed it."
        : "Submitted. We'll review your WL application."
    );
    els.form.reset();
  } catch {
    showResult(false, "Could not submit right now. Try again.");
  } finally {
    els.btn.disabled = false;
  }
});
