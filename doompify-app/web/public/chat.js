const $ = (id) => document.getElementById(id);
const EMOJIS = ["🐸", "🔥", "💀", "🚀", "😂", "👀", "🤮", "🧪"];

const state = {
  me: { loggedIn: false, isAdmin: false, isHolder: false },
  channels: [],
  active: null,
  lastId: 0,
  file: null,
  poll: null,
  seen: new Set(),
};

async function api(path, opts) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  let data = {}; try { data = await res.json(); } catch (_) {}
  return { ok: res.ok, status: res.status, data };
}
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- boot ---------------- */
async function boot() {
  const me = await api("/auth/user/me");
  state.me.loggedIn = me.data.authenticated;
  if (me.data.authenticated) {
    $("btnLogin").hidden = true; $("whoami").hidden = false; $("btnLogout").hidden = false;
    $("whoami").textContent = "@" + me.data.user.username;
  }
  await loadChannels();
  wireComposer();
  wireMisc();
}

$("btnLogout").addEventListener("click", async () => { await api("/auth/user/logout", { method: "POST" }); location.reload(); });

async function loadChannels() {
  const res = await api("/api/chat/channels");
  if (!res.ok) return;
  state.me = { ...state.me, ...(res.data.me || {}) };
  state.channels = res.data.channels || [];
  renderChannels();
  // pick first channel
  if (state.channels.length && !state.active) selectChannel(state.channels[0]);
  const foot = $("sidebarFoot");
  if (!state.me.loggedIn) foot.innerHTML = "Log in to post.";
  else if (state.me.isAdmin) foot.innerHTML = "Admin — you can post anywhere.";
  else if (state.me.isHolder) foot.innerHTML = "Holder — welcome to the swamp.";
  else foot.innerHTML = "Verify a DOOMPS wallet to post.";
}

function renderChannels() {
  const list = $("channelList");
  list.innerHTML = "";
  const cats = {};
  state.channels.forEach((c) => { (cats[c.category] ??= []).push(c); });
  Object.entries(cats).forEach(([cat, chans]) => {
    const label = document.createElement("div");
    label.className = "cat-label"; label.textContent = cat;
    list.appendChild(label);
    chans.forEach((c) => {
      const item = document.createElement("div");
      item.className = "chan-item" + (state.active && c.id === state.active.id ? " active" : "") + (c.canPost ? "" : " locked");
      item.innerHTML = `<span class="hash">#</span><span class="cname">${esc(c.name)}</span>${c.canPost ? "" : '<span class="chan-lock">🔒</span>'}`;
      item.addEventListener("click", () => { selectChannel(c); $("sidebar").classList.remove("open"); });
      list.appendChild(item);
    });
  });
}

function selectChannel(c) {
  state.active = c; state.lastId = 0; state.seen.clear();
  $("chanName").textContent = "# " + c.name;
  $("chanTopic").textContent = c.topic || "";
  $("msgScroll").querySelectorAll(".msg").forEach((n) => n.remove());
  $("msgEmpty").hidden = true;
  renderChannels();
  updateComposer();
  loadMessages(true);
  restartPoll();
}

function updateComposer() {
  const c = state.active;
  const locked = $("composerLocked");
  const canPost = c && c.canPost;
  $("msgInput").disabled = !canPost;
  $("btnSend").disabled = !canPost;
  if (canPost) { locked.hidden = true; }
  else {
    locked.hidden = false;
    locked.textContent = !state.me.loggedIn ? "Log in with Discord to post."
      : !state.me.isHolder ? "Only DOOMPS holders can post here."
      : "You don't have the role to post in this channel.";
  }
}

/* ---------------- messages ---------------- */
async function loadMessages(reset) {
  if (!state.active) return;
  const after = reset ? 0 : state.lastId;
  const res = await api(`/api/chat/channels/${state.active.id}/messages?after=${after}`);
  if (!res.ok) return;
  const msgs = res.data.messages || [];
  if (reset && msgs.length === 0) { $("msgEmpty").hidden = false; return; }
  if (msgs.length) $("msgEmpty").hidden = true;
  const scroll = $("msgScroll");
  const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80;
  msgs.forEach((m) => {
    if (state.seen.has(m.id)) return;
    state.seen.add(m.id);
    scroll.appendChild(renderMsg(m));
    state.lastId = Math.max(state.lastId, m.id);
  });
  if (reset || atBottom) scroll.scrollTop = scroll.scrollHeight;
}

function renderMsg(m) {
  const row = document.createElement("div");
  row.className = "msg"; row.dataset.id = m.id;
  const initial = (m.username || "?")[0].toUpperCase();
  const time = new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const img = m.image ? `<img class="msg-img" src="${m.image}" alt="image" loading="lazy" />` : "";
  const text = m.body ? `<div class="msg-text">${esc(m.body)}</div>` : "";
  const delBtn = (m.mine || state.me.isAdmin) ? `<button class="msg-del" title="Delete">delete</button>` : "";
  row.innerHTML = `
    <div class="msg-av">${esc(initial)}</div>
    <div class="msg-body">
      <div class="msg-head"><span class="msg-user">${esc(m.username || "unknown")}</span><span class="msg-time">${time}</span></div>
      ${text}${img}
      <div class="msg-rx"></div>
    </div>${delBtn}`;
  renderReactions(row.querySelector(".msg-rx"), m);
  if (delBtn) row.querySelector(".msg-del").addEventListener("click", () => deleteMsg(m.id, row));
  return row;
}

function renderReactions(container, m) {
  container.innerHTML = "";
  const rx = m.reactions || {};
  Object.entries(rx).forEach(([emoji, count]) => {
    const chip = document.createElement("span");
    const mine = (m.myReactions || []).includes(emoji);
    chip.className = "rx-chip" + (mine ? " mine" : "");
    chip.innerHTML = `${emoji} <b>${count}</b>`;
    chip.addEventListener("click", () => react(m.id, emoji));
    container.appendChild(chip);
  });
  if (state.me.loggedIn) {
    const add = document.createElement("span");
    add.className = "rx-add"; add.textContent = "＋";
    add.addEventListener("click", (e) => openPicker(e, m.id));
    container.appendChild(add);
  }
}

async function react(messageId, emoji) {
  const res = await api(`/api/chat/messages/${messageId}/react`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emoji }),
  });
  if (res.ok) refreshOne(messageId);
}

async function refreshOne(messageId) {
  // cheap refresh: re-pull recent messages for reaction state
  const res = await api(`/api/chat/channels/${state.active.id}/messages?after=0`);
  if (!res.ok) return;
  (res.data.messages || []).forEach((m) => {
    const row = $("msgScroll").querySelector(`.msg[data-id="${m.id}"]`);
    if (row) renderReactions(row.querySelector(".msg-rx"), m);
  });
}

async function deleteMsg(id, row) {
  if (!confirm("Delete this message?")) return;
  const res = await api(`/api/chat/messages/${id}`, { method: "DELETE" });
  if (res.ok) row.remove();
}

/* reaction picker */
function openPicker(e, messageId) {
  const picker = $("rxPicker");
  picker.innerHTML = "";
  EMOJIS.forEach((em) => {
    const b = document.createElement("button"); b.textContent = em;
    b.addEventListener("click", () => { picker.hidden = true; react(messageId, em); });
    picker.appendChild(b);
  });
  picker.hidden = false;
  const r = e.target.getBoundingClientRect();
  picker.style.left = Math.min(r.left, window.innerWidth - 260) + "px";
  picker.style.top = (r.bottom + 6) + "px";
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".rx-picker") && !e.target.classList.contains("rx-add")) $("rxPicker").hidden = true;
});

/* ---------------- composer ---------------- */
function wireComposer() {
  $("chatFile").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    state.file = f;
    $("composerImg").src = URL.createObjectURL(f);
    $("composerPreview").hidden = false;
  });
  $("composerImgX").addEventListener("click", () => {
    state.file = null; $("composerPreview").hidden = true; $("chatFile").value = "";
  });
  $("btnSend").addEventListener("click", send);
  $("msgInput").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
}

async function send() {
  const text = $("msgInput").value.trim();
  if (!text && !state.file) return;
  if (!state.active || !state.active.canPost) return;
  $("btnSend").disabled = true;
  const form = new FormData();
  form.append("body", text);
  if (state.file) form.append("image", state.file);
  const res = await api(`/api/chat/channels/${state.active.id}/messages`, { method: "POST", body: form });
  $("btnSend").disabled = false;
  if (!res.ok) { $("composerLocked").hidden = false; $("composerLocked").textContent = res.data.error || "Couldn't send."; return; }
  $("msgInput").value = ""; state.file = null; $("composerPreview").hidden = true; $("chatFile").value = "";
  loadMessages(false);
}

/* ---------------- polling ---------------- */
function restartPoll() {
  if (state.poll) clearInterval(state.poll);
  state.poll = setInterval(() => loadMessages(false), 3000);
}

function wireMisc() {
  $("hamburger").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { if (state.poll) clearInterval(state.poll); }
    else restartPoll();
  });
}

boot();
