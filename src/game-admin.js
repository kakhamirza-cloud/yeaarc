/** Secret game admin UI — wheel + leaderboard */

const els = {
  password: document.getElementById("adminPassword"),
  prizeName: document.getElementById("prizeName"),
  prizeLimit: document.getElementById("prizeLimit"),
  newPassword: document.getElementById("newPassword"),
  removeName: document.getElementById("removeName"),
  status: document.getElementById("adminStatus"),
  lbStatus: document.getElementById("lbStatus"),
  note: document.getElementById("adminNote"),
  winners: document.getElementById("winnersList"),
  lbList: document.getElementById("lbList"),
  btnSetPrize: document.getElementById("btnSetPrize"),
  btnSetLimit: document.getElementById("btnSetLimit"),
  btnReset: document.getElementById("btnReset"),
  btnResetLb: document.getElementById("btnResetLb"),
  btnRemoveName: document.getElementById("btnRemoveName"),
  btnSetPassword: document.getElementById("btnSetPassword"),
};

function renderList(el, rows, emptyLabel, mapRow) {
  el.innerHTML = "";
  if (!rows.length) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="rank">—</span><span>${emptyLabel}</span><span class="pts">0</span>`;
    el.appendChild(li);
    return;
  }
  rows.forEach((row, i) => {
    const li = document.createElement("li");
    li.innerHTML = mapRow(row, i);
    el.appendChild(li);
  });
}

async function loadStatus() {
  const res = await fetch("/api/wheel/admin", { cache: "no-store" });
  const data = await res.json();
  els.status.textContent = data.available
    ? `${data.prizeName} — ${data.remaining} / ${data.limit} left`
    : `${data.prizeName} — Spin is unavailable (${data.claimed}/${data.limit})`;
  els.prizeName.value = data.prizeName || "";
  els.prizeLimit.value = String(data.limit ?? 3);
  els.lbStatus.textContent = `${data.leaderboardCount ?? 0} score(s) stored`;

  renderList(
    els.winners,
    Array.isArray(data.winners) ? data.winners : [],
    "no winners yet",
    (w, i) =>
      `<span class="rank">#${i + 1}</span><span>@${w.twitter}<br><small>${w.wallet}</small></span><span class="pts">${w.prizeName || ""}</span>`
  );

  renderList(
    els.lbList,
    Array.isArray(data.leaderboard) ? data.leaderboard : [],
    "no climbs yet",
    (row, i) =>
      `<span class="rank">#${i + 1}</span><span>@${row.name}</span><span class="pts">${row.score}</span>`
  );
}

async function adminAction(action, extra = {}) {
  els.note.textContent = "Saving…";
  const res = await fetch("/api/wheel/admin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      password: els.password.value,
      action,
      ...extra,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    els.note.textContent = data.error || "Failed";
    return;
  }
  els.note.textContent = "Saved.";
  await loadStatus();
}

els.btnSetPrize.addEventListener("click", () =>
  adminAction("setPrize", { prizeName: els.prizeName.value })
);
els.btnSetLimit.addEventListener("click", () =>
  adminAction("setLimit", { limit: Number(els.prizeLimit.value) })
);
els.btnReset.addEventListener("click", () => {
  if (confirm("Reset all wheel winners?")) adminAction("reset");
});
els.btnResetLb.addEventListener("click", () => {
  if (confirm("Clear the entire live leaderboard?")) adminAction("resetLeaderboard");
});
els.btnRemoveName.addEventListener("click", () => {
  const name = els.removeName.value.trim();
  if (!name) {
    els.note.textContent = "Enter a Twitter username to remove.";
    return;
  }
  adminAction("removeLeaderboardName", { name });
});
els.btnSetPassword.addEventListener("click", () =>
  adminAction("setPassword", { newPassword: els.newPassword.value })
);

loadStatus().catch(() => {
  els.status.textContent = "Could not load status. Is the local server running?";
});
