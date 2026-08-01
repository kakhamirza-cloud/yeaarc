const els = {
  form: document.getElementById("adminForm"),
  password: document.getElementById("adminPassword"),
  status: document.getElementById("adminStatus"),
  meta: document.getElementById("adminMeta"),
  question: document.getElementById("adminQuestion"),
  marketStatus: document.getElementById("adminMarketStatus"),
  btnForceResolve: document.getElementById("btnForceResolve"),
  btnRefresh: document.getElementById("btnRefresh"),
  btnReset: document.getElementById("btnReset"),
  note: document.getElementById("adminNote"),
};

let password = "";

function note(message, ok = false) {
  els.note.textContent = message || "";
  els.note.classList.toggle("ok", Boolean(ok && message));
  els.note.classList.toggle("error", Boolean(!ok && message));
}

async function api(body) {
  const res = await fetch("/api/prediction/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "request failed");
  return data;
}

function render(data) {
  const opens = data.openMarkets?.length
    ? data.openMarkets
    : (data.markets || []).filter((m) => m.status === "open");

  els.meta.textContent = `players ${data.playerCount ?? "—"} · open ${opens.length} · markets ${data.marketCount ?? "—"}`;

  if (opens.length) {
    els.question.textContent = opens.map((m, i) => `${i + 1}. ${m.question}`).join(" | ");
    els.marketStatus.textContent = opens
      .map((m) => `${m.id.slice(-4)} yes ${m.yesPct}%/no ${m.noPct}% pool ${m.totalPool}`)
      .join(" · ");
  } else {
    els.question.textContent = "No open markets";
    els.marketStatus.textContent = "—";
  }

  els.btnForceResolve.disabled = false;
  els.btnRefresh.disabled = false;
  if (els.btnReset) els.btnReset.disabled = false;
}

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  password = els.password.value;
  els.status.textContent = "Loading…";
  els.status.className = "admin-status";
  try {
    const data = await api({ password, action: "status" });
    els.status.textContent = "Loaded.";
    els.status.className = "admin-status ok";
    render(data);
    note("");
  } catch (err) {
    els.status.textContent = err.message || "Failed";
    els.status.className = "admin-status error";
    els.btnForceResolve.disabled = true;
    els.btnRefresh.disabled = true;
    if (els.btnReset) els.btnReset.disabled = true;
  }
});

els.btnRefresh.addEventListener("click", async () => {
  try {
    const data = await api({ password, action: "status" });
    render(data);
    note("Refreshed.", true);
  } catch (err) {
    note(err.message || "Refresh failed");
  }
});

els.btnForceResolve.addEventListener("click", async () => {
  if (!confirm("Force resolve ALL open markets now? Outcomes are random for testing. Then 3 new markets open."))
    return;
  note("Resolving…");
  try {
    const data = await api({ password, action: "forceResolve" });
    render(data);
    note("All open markets resolved — 3 new markets generated.", true);
  } catch (err) {
    note(err.message || "Force resolve failed");
  }
});

els.btnReset?.addEventListener("click", async () => {
  if (!confirm("Wipe ALL prediction players, bets, and markets? This cannot be undone.")) return;
  note("Resetting…");
  try {
    const data = await api({ password, action: "reset" });
    render(data);
    note("Prediction data wiped — fresh markets ready.", true);
  } catch (err) {
    note(err.message || "Reset failed");
  }
});
