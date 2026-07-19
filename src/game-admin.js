/** Secret game admin UI — wheel + leaderboard */

const els = {
  password: document.getElementById("adminPassword"),
  prizeName: document.getElementById("prizeName"),
  prizeLimit: document.getElementById("prizeLimit"),
  wlPrizeName: document.getElementById("wlPrizeName"),
  wlPrizeLimit: document.getElementById("wlPrizeLimit"),
  newPassword: document.getElementById("newPassword"),
  removeName: document.getElementById("removeName"),
  status: document.getElementById("adminStatus"),
  lbStatus: document.getElementById("lbStatus"),
  note: document.getElementById("adminNote"),
  freeWinners: document.getElementById("freeWinnersList"),
  wlWinners: document.getElementById("wlWinnersList"),
  lbList: document.getElementById("lbList"),
  btnSetPrize: document.getElementById("btnSetPrize"),
  btnSetLimit: document.getElementById("btnSetLimit"),
  btnSetWlPrize: document.getElementById("btnSetWlPrize"),
  btnSetWlLimit: document.getElementById("btnSetWlLimit"),
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

function prizeById(prizes, id) {
  return (Array.isArray(prizes) ? prizes : []).find((p) => p.id === id);
}

async function loadStatus() {
  const res = await fetch("/api/wheel/admin", { cache: "no-store" });
  const data = await res.json();
  const free = prizeById(data.prizes, "free");
  const wl = prizeById(data.prizes, "whitelist");

  const lines = [];
  if (free) {
    lines.push(
      free.available
        ? `Free: ${free.name} — ${free.remaining}/${free.limit} left`
        : `Free: ${free.name} — sold out (${free.claimed}/${free.limit})`
    );
  }
  if (wl) {
    lines.push(
      wl.available
        ? `WL: ${wl.name} — ${wl.remaining}/${wl.limit} left`
        : `WL: ${wl.name} — sold out (${wl.claimed}/${wl.limit})`
    );
  }
  els.status.textContent = lines.join(" · ") || (data.available ? "Spin available" : "Spin unavailable");

  els.prizeName.value = free?.name || "";
  els.prizeLimit.value = String(free?.limit ?? 3);
  els.wlPrizeName.value = wl?.name || "";
  els.wlPrizeLimit.value = String(wl?.limit ?? 50);
  els.lbStatus.textContent = `${data.leaderboardCount ?? 0} score(s) stored`;

  const allWinners = Array.isArray(data.winners) ? data.winners : [];
  const freeWins = allWinners.filter((w) => (w.prizeId || "free") === "free");
  const wlWins = allWinners.filter((w) => w.prizeId === "whitelist");

  renderList(
    els.freeWinners,
    freeWins,
    "no free mfer winners yet",
    (w, i) =>
      `<span class="rank">#${i + 1}</span><span>@${w.twitter}<br><small>${w.wallet}</small></span><span class="pts">${w.prizeName || "Free"}</span>`
  );

  renderList(
    els.wlWinners,
    wlWins,
    "no whitelist wallets yet",
    (w, i) =>
      `<span class="rank">#${i + 1}</span><span>@${w.twitter}<br><small>${w.wallet}</small></span><span class="pts">WL</span>`
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
els.btnSetWlPrize.addEventListener("click", () =>
  adminAction("setWhitelistPrize", { prizeName: els.wlPrizeName.value })
);
els.btnSetWlLimit.addEventListener("click", () =>
  adminAction("setWhitelistLimit", { limit: Number(els.wlPrizeLimit.value) })
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
