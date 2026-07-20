const $ = (id) => document.getElementById(id);
const state = { user: null, selected: null, notifyDisabled: false };

async function api(path, opts = {}) {
  try {
    const res = await fetch(path, { credentials: "same-origin", ...opts });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (e) {
    return { ok: false, data: { error: "Network error." } };
  }
}

async function boot() {
  const me = await api("/auth/user/me");
  state.user = me.ok && me.data.authenticated ? me.data.user : null;

  if (!state.user) {
    $("needLogin").hidden = false;
    $("btnLogin").hidden = false;
    return;
  }
  $("btnLogin").hidden = true;
  $("whoami").hidden = false;
  $("whoami").textContent = state.user.username;
  $("btnLogout").hidden = false;
  $("btnLogout").addEventListener("click", async () => {
    await api("/auth/user/logout", { method: "POST" });
    location.reload();
  });

  $("profileForm").hidden = false;
  await loadProfile();
  await loadAvatars();
  wire();
}

async function loadProfile() {
  const r = await api("/api/profile/me");
  if (!r.ok) return;
  const p = r.data;
  $("displayName").value = p.displayName || "";
  $("bio").value = p.bio || "";
  $("headName").textContent = p.displayName || state.user.username;
  if (p.avatarUrl) {
    $("avPreview").src = p.avatarUrl;
    state.selected = { image: p.avatarUrl, tokenId: p.avatarToken };
  }
  state.notifyDisabled = !!p.notdisabled;
  $("notifyToggle").checked = !state.notifyDisabled;
  updateNotifyHint();
}

async function loadAvatars() {
  const grid = $("avatarGrid");
  const hint = $("avatarHint");
  const r = await api("/api/profile/avatars");
  if (!r.ok) {
    hint.textContent = "Couldn't load your DOOMPS right now.";
    return;
  }
  const nfts = r.data.nfts || [];
  if (!nfts.length) {
    hint.textContent =
      r.data.reason === "no linked wallets"
        ? "No verified wallet yet — verify a DOOMPS wallet to pick an avatar."
        : "No DOOMPS with images found in your linked wallets.";
    return;
  }
  hint.textContent = "Tap a DOOMP to make it your avatar.";
  grid.innerHTML = "";
  for (const n of nfts) {
    const div = document.createElement("div");
    div.className = "avatar-opt";
    if (state.selected && String(state.selected.tokenId) === String(n.tokenId)) div.classList.add("selected");
    div.innerHTML = `<img src="${n.image}" alt="${n.name}" loading="lazy" /><span class="tok">#${n.tokenId}</span>`;
    div.addEventListener("click", () => {
      state.selected = { image: n.image, tokenId: n.tokenId };
      $("avPreview").src = n.image;
      document.querySelectorAll(".avatar-opt").forEach((el) => el.classList.remove("selected"));
      div.classList.add("selected");
    });
    grid.appendChild(div);
  }
}

function updateNotifyHint() {
  const on = $("notifyToggle").checked;
  $("notifyHint").textContent = on
    ? "On — you'll get browser notifications when tagged"
    : "Off — no pings, even when tagged";
}

function wire() {
  $("notifyToggle").addEventListener("change", async () => {
    updateNotifyHint();
    // If turning on, request browser notification permission up front.
    if ($("notifyToggle").checked && "Notification" in window && Notification.permission === "default") {
      try { await Notification.requestPermission(); } catch (_) {}
    }
  });
  $("btnSave").addEventListener("click", save);
}

async function save() {
  const hint = $("saveHint");
  hint.className = "hint";
  hint.textContent = "Saving…";
  $("btnSave").disabled = true;
  const body = {
    displayName: $("displayName").value.trim(),
    bio: $("bio").value,
    notifyDisabled: !$("notifyToggle").checked,
  };
  if (state.selected) {
    body.avatarUrl = state.selected.image;
    body.avatarToken = state.selected.tokenId != null ? String(state.selected.tokenId) : null;
  }
  const r = await api("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  $("btnSave").disabled = false;
  if (!r.ok) {
    hint.className = "hint err";
    hint.textContent = r.data.error || "Couldn't save. Try again.";
    return;
  }
  hint.className = "hint ok";
  hint.textContent = "Saved. Your face is in the swamp.";
  $("headName").textContent = body.displayName || state.user.username;
}

boot();
