const $ = (id) => document.getElementById(id);

async function jget(path) {
  const r = await fetch(path, { credentials: "same-origin" });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}
async function jsend(path, method, body) {
  const r = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

let ROLES = [];
const roleName = (id) => (ROLES.find((r) => r.id === id)?.name) || id;

async function boot() {
  const me = await jget("/admin/api/me");
  if (!me.data.authenticated) {
    $("gate").hidden = false;
    $("console").hidden = true;
    return;
  }
  $("gate").hidden = true;
  $("console").hidden = false;
  $("whoami").textContent = `@${me.data.username}`;

  await loadRoles();
  await loadRules();
  await loadPrizes();
  await loadMods(true);
  await loadWins();
  await loadChannels();
}

async function loadRoles() {
  const res = await jget("/admin/api/roles");
  if (!res.ok) return;
  ROLES = res.data.roles || [];
  const sel = $("roleId");
  sel.innerHTML = '<option value="">Select a role…</option>';
  ROLES.forEach((r) => {
    const o = document.createElement("option");
    o.value = r.id;
    o.textContent = r.name;
    sel.appendChild(o);
  });
}

async function loadRules() {
  const res = await jget("/admin/api/rules");
  const rules = res.data.rules || [];
  const wrap = $("rulesWrap");
  if (!rules.length) {
    wrap.innerHTML = '<p class="instr">No rules yet.</p>';
    return;
  }
  wrap.innerHTML = "";
  rules.forEach((rule) => {
    const row = document.createElement("div");
    row.className = "rule-row";
    row.innerHTML = `
      <div class="rule-coll">
        <div class="name">${rule.collection_name || "Collection"}</div>
        <div class="addr">${rule.collection}</div>
      </div>
      <div class="rule-thresh">≥ ${rule.min_count} held</div>
      <div class="rule-role">${roleName(rule.role_id)}</div>
      <button class="btn-del" data-id="${rule.id}">Remove</button>
    `;
    row.querySelector(".btn-del").addEventListener("click", async () => {
      await jsend(`/admin/api/rules/${rule.id}`, "DELETE");
      loadRules();
    });
    wrap.appendChild(row);
  });
}

$("btnAddRule").addEventListener("click", async () => {
  const hint = $("ruleHint");
  hint.className = "hint";
  hint.textContent = "";
  const body = {
    collection: $("collection").value.trim(),
    collectionName: $("collectionName").value.trim(),
    minCount: parseInt($("minCount").value, 10),
    roleId: $("roleId").value,
  };
  if (!/^0x[0-9a-fA-F]{40}$/.test(body.collection)) {
    hint.className = "hint err"; hint.textContent = "Enter a valid collection contract address."; return;
  }
  if (!body.roleId) { hint.className = "hint err"; hint.textContent = "Pick a role."; return; }
  const res = await jsend("/admin/api/rules", "POST", body);
  if (!res.ok) { hint.className = "hint err"; hint.textContent = res.data.error || "Failed."; return; }
  hint.className = "hint ok"; hint.textContent = "Rule sealed.";
  $("collection").value = ""; $("collectionName").value = ""; $("minCount").value = "1"; $("roleId").value = "";
  loadRules();
});

$("btnLogout").addEventListener("click", async () => {
  await jsend("/admin/api/logout", "POST");
  location.reload();
});

/* ---------------- prizes ---------------- */
async function loadPrizes() {
  const res = await jget("/admin/api/prizes");
  if (!res.ok) return;
  const p = res.data.prizes || {};
  $("prizeBig").value = p.big || "";
  $("prizeMedium").value = p.medium || "";
  $("prizeSmall").value = p.small || "";
  $("prizeTiny").value = p.tiny || "";
}

$("btnSavePrizes").addEventListener("click", async () => {
  const hint = $("prizeHint");
  hint.className = "hint";
  const body = {
    big: $("prizeBig").value.trim(),
    medium: $("prizeMedium").value.trim(),
    small: $("prizeSmall").value.trim(),
    tiny: $("prizeTiny").value.trim(),
  };
  const res = await jsend("/admin/api/prizes", "POST", body);
  if (!res.ok) { hint.className = "hint err"; hint.textContent = res.data.error || "Failed."; return; }
  hint.className = "hint ok"; hint.textContent = "Prizes updated.";
});

/* ---------------- meme moderation ---------------- */
let modOffset = 0, modDone = false;
async function loadMods(reset) {
  if (reset) { $("modGrid").innerHTML = ""; modOffset = 0; modDone = false; }
  const res = await jget(`/admin/api/memes?limit=24&offset=${modOffset}`);
  if (!res.ok) return;
  const memes = res.data.memes || [];
  const grid = $("modGrid");
  memes.forEach((m) => {
    const cell = document.createElement("div");
    cell.className = "mod-cell";
    const cap = m.caption ? `<div class="mod-cap">${escapeHtml(m.caption)}</div>` : "";
    const user = m.username ? `<span class="mod-user">@${escapeHtml(m.username)}</span>` : "";
    cell.innerHTML = `<img src="${m.url}" alt="meme"/>${cap}<div class="mod-foot">${user}<button class="btn-del" data-id="${m.id}">Delete</button></div>`;
    cell.querySelector(".btn-del").addEventListener("click", async () => {
      if (!confirm("Delete this meme?")) return;
      await jsend(`/admin/api/memes/${m.id}`, "DELETE");
      cell.remove();
    });
    grid.appendChild(cell);
  });
  modOffset += memes.length;
  modDone = modOffset >= (res.data.total || 0);
  $("modEmpty").hidden = (res.data.total || 0) > 0;
  $("btnModMore").hidden = modDone;
}
$("btnModMore").addEventListener("click", () => loadMods(false));

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- winners / payouts ---------------- */
async function loadWins() {
  const pending = $("onlyPending").checked ? "1" : "0";
  const res = await jget(`/admin/api/wins?pending=${pending}`);
  const wins = (res.data && res.data.wins) || [];
  const wrap = $("winsWrap");
  if (!wins.length) { wrap.innerHTML = '<p class="instr">No winners yet.</p>'; return; }
  wrap.innerHTML = "";
  wins.forEach((w) => {
    const row = document.createElement("div");
    row.className = "win-row";
    const paid = w.status === "paid";
    const addr = w.address ? `<code class="win-addr">${escapeHtml(w.address)}</code>` : '<span class="win-noaddr">no wallet yet</span>';
    row.innerHTML = `
      <div class="win-who"><span class="win-user">@${escapeHtml(w.username || "unknown")}</span><span class="win-day">${escapeHtml(w.day)}</span></div>
      <div class="win-prize">${escapeHtml(w.prize || w.outcome)}</div>
      ${addr}
      <div class="win-action"></div>`;
    const action = row.querySelector(".win-action");
    if (paid) {
      action.innerHTML = '<span class="win-paid">PAID</span>';
    } else if (w.address) {
      const btn = document.createElement("button");
      btn.className = "btn-primary btn-paid"; btn.textContent = "Mark paid";
      btn.addEventListener("click", async () => {
        await jsend(`/admin/api/wins/${w.id}/paid`, "POST");
        loadWins();
      });
      action.appendChild(btn);
    } else {
      action.innerHTML = '<span class="win-wait">waiting on wallet</span>';
    }
    wrap.appendChild(row);
  });
}
$("onlyPending").addEventListener("change", loadWins);

/* ---------------- channels (The Swamp) ---------------- */
function fillPermSelect(sel, kind) {
  // kind: 'read' or 'post'
  sel.innerHTML = "";
  const opts = [];
  if (kind === "read") {
    opts.push(["", "Everyone"]);
    opts.push(["__admin__", "Admins only"]);
  } else {
    opts.push(["", "Any holder"]);
    opts.push(["__admin__", "Admins only"]);
  }
  ROLES.forEach((r) => opts.push([r.id, `Role: ${r.name}`]));
  opts.forEach(([v, label]) => {
    const o = document.createElement("option"); o.value = v; o.textContent = label; sel.appendChild(o);
  });
}

async function loadChannels() {
  // ensure roles are loaded for the selects
  if (!ROLES.length) await loadRoles();
  fillPermSelect($("chanRead"), "read");
  fillPermSelect($("chanPost"), "post");

  const res = await jget("/admin/api/channels");
  const chans = (res.data && res.data.channels) || [];
  const wrap = $("chansWrap");
  if (!chans.length) { wrap.innerHTML = '<p class="instr">No channels yet.</p>'; return; }
  wrap.innerHTML = "";
  chans.forEach((c) => {
    const row = document.createElement("div");
    row.className = "chan-admin-row";
    const readLabel = permLabel(c.read_roles, "read");
    const postLabel = permLabel(c.post_roles, "post");
    row.innerHTML = `
      <div class="ca-name"><span class="ca-cat">${escapeHtml(c.category)}</span> <strong>#${escapeHtml(c.name)}</strong></div>
      <div class="ca-perm">read: ${escapeHtml(readLabel)} · post: ${escapeHtml(postLabel)}</div>
      <button class="btn-del" data-id="${c.id}">Delete</button>`;
    row.querySelector(".btn-del").addEventListener("click", async () => {
      if (!confirm(`Delete #${c.name} and all its messages?`)) return;
      await jsend(`/admin/api/channels/${c.id}`, "DELETE");
      loadChannels();
    });
    wrap.appendChild(row);
  });
}

function permLabel(roles, kind) {
  if (!roles || roles.length === 0) return kind === "read" ? "everyone" : "any holder";
  if (roles.includes("__admin__")) return "admins";
  return roles.map((id) => { const r = ROLES.find((x) => x.id === id); return r ? r.name : id; }).join(", ");
}

$("btnAddChannel").addEventListener("click", async () => {
  const hint = $("chanHint"); hint.className = "hint";
  const name = $("chanNameNew").value.trim();
  if (!name) { hint.className = "hint err"; hint.textContent = "Channel name required."; return; }
  const readVal = $("chanRead").value, postVal = $("chanPost").value;
  const body = {
    category: $("chanCategory").value.trim() || "SWAMP",
    name,
    topic: $("chanTopicNew").value.trim(),
    readRoles: readVal ? [readVal] : [],
    postRoles: postVal ? [postVal] : [],
  };
  const res = await jsend("/admin/api/channels", "POST", body);
  if (!res.ok) { hint.className = "hint err"; hint.textContent = res.data.error || "Failed."; return; }
  hint.className = "hint ok"; hint.textContent = "Channel created.";
  $("chanNameNew").value = ""; $("chanTopicNew").value = ""; $("chanCategory").value = "";
  loadChannels();
});

boot();
