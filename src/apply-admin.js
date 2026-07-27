const els = {
  form: document.getElementById("adminForm"),
  password: document.getElementById("adminPassword"),
  status: document.getElementById("adminStatus"),
  count: document.getElementById("applyCount"),
  list: document.getElementById("applyList"),
  btnExport: document.getElementById("btnExport"),
  btnClear: document.getElementById("btnClear"),
};

let cached = [];

function formatWhen(at) {
  try {
    return new Date(at).toLocaleString();
  } catch {
    return "—";
  }
}

function render(apps) {
  cached = Array.isArray(apps) ? apps : [];
  els.count.textContent = `${cached.length} application(s)`;
  els.btnExport.disabled = cached.length === 0;
  els.btnClear.disabled = cached.length === 0;

  if (!cached.length) {
    els.list.innerHTML = `<li class="lb-empty">no applications yet</li>`;
    return;
  }

  els.list.innerHTML = cached
    .map(
      (a, i) =>
        `<li><span class="rank">#${i + 1}</span><span>${a.wallet}${
          a.twitter ? `<br><small>@${a.twitter}</small>` : ""
        }<br><small>${formatWhen(a.at)}</small></span><span class="pts">WL</span></li>`
    )
    .join("");
}

async function loadApps() {
  const password = els.password.value;
  const res = await fetch("/api/wl-apply/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password, action: "list" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "bad password");
  els.status.textContent = "Loaded.";
  els.status.className = "admin-status ok";
  render(data.applications);
}

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.status.textContent = "Loading…";
  els.status.className = "admin-status";
  try {
    await loadApps();
  } catch (err) {
    els.status.textContent = err?.message || "Failed";
    els.status.className = "admin-status error";
    render([]);
  }
});

els.btnExport.addEventListener("click", async () => {
  const text = cached.map((a) => a.wallet).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    els.status.textContent = `Copied ${cached.length} wallet(s).`;
    els.status.className = "admin-status ok";
  } catch {
    els.status.textContent = "Could not copy — select from the list instead.";
    els.status.className = "admin-status error";
  }
});

els.btnClear.addEventListener("click", async () => {
  if (!confirm("Clear ALL WL applications? This cannot be undone.")) return;
  const res = await fetch("/api/wl-apply/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: els.password.value, action: "clear" }),
  });
  const data = await res.json();
  if (!res.ok) {
    els.status.textContent = data?.error || "Clear failed";
    els.status.className = "admin-status error";
    return;
  }
  els.status.textContent = "Cleared.";
  els.status.className = "admin-status ok";
  render([]);
});
