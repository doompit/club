const $ = (id) => document.getElementById(id);

const state = {
  user: null,
  segments: [],
  prizes: { big: "Big Prize", medium: "Medium Prize", small: "Small Prize", tiny: "Tiny Prize" },
  wheelAngle: 0,
  spinning: false,
  selectedFile: null,
  galleryOffset: 0,
  galleryDone: false,
};

const TIER_COLOR = {
  big: "#b6ff2e",
  medium: "#79d41f",
  small: "#4e8f16",
  tiny: "#6a7d2a",
};
const RUG_COLORS = ["#5a1a1e", "#7d2429"];

async function api(path, opts) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  let data = {};
  try { data = await res.json(); } catch (_) {}
  return { ok: res.ok, status: res.status, data };
}

/* ---------------- boot ---------------- */
async function boot() {
  await loadState();
  drawWheel();
  await loadGallery(true);
  wireUpload();
  wireSpin();
  wireOverlay();
  // If arrived via /memematic or /gallery (#hash), scroll there once content is in.
  if (location.hash) {
    const el = document.querySelector(location.hash);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function loadState() {
  const me = await api("/auth/user/me");
  state.user = me.data.authenticated ? me.data.user : null;
  renderUser();

  const s = await api("/api/spin/state");
  if (s.ok) {
    state.segments = s.data.segments || [];
    state.prizes = s.data.prizes || state.prizes;
    applyPrizeLabels();
    updateSpinGate(s.data);
  }
}

function renderUser() {
  if (state.user) {
    $("btnLogin").hidden = true;
    $("whoami").hidden = false;
    $("whoami").textContent = "@" + state.user.username;
    $("btnLogout").hidden = false;
  } else {
    $("btnLogin").hidden = false;
    $("whoami").hidden = true;
    $("btnLogout").hidden = true;
  }
}

$("btnLogout").addEventListener("click", async () => {
  await api("/auth/user/logout", { method: "POST" });
  location.reload();
});

function applyPrizeLabels() {
  document.querySelectorAll(".ol-name[data-tier]").forEach((el) => {
    const t = el.getAttribute("data-tier");
    if (state.prizes[t]) el.textContent = state.prizes[t];
  });
}

function updateSpinGate(d) {
  const btn = $("btnSpin");
  const free = $("btnFreeSpin");
  const status = $("spinStatus");
  status.className = "spin-status";

  if (!d.authenticated) {
    btn.disabled = true;
    if (free) free.disabled = true;
    status.textContent = "Log in with Discord to play.";
    return;
  }

  // Free spin is always available to logged-in users.
  if (free) free.disabled = false;

  if (d.alreadySpun) {
    btn.disabled = true;
    const r = d.todayResult;
    status.textContent = r && r.outcome !== "rug"
      ? `You already spun for real today — landed ${r.label}. Back tomorrow (UTC). Free spins still work.`
      : "You already spun for real today. Back tomorrow (UTC). Free spins still work.";
    return;
  }
  if (!d.hasUploaded) {
    btn.disabled = true;
    btn.textContent = "UPLOAD A MEME TO SPIN FOR PRIZES";
    status.textContent = "Free spin is open. Upload a meme to unlock the real spin for prizes.";
    return;
  }
  btn.disabled = false;
  btn.textContent = "PULL THE LEVER FOR REAL";
  status.textContent = "Meme dropped — real spin unlocked. One pull, no take-backs.";
  status.classList.add("ok");
}

/* ---------------- wheel drawing ---------------- */
function drawWheel() {
  const canvas = $("wheel");
  const ctx = canvas.getContext("2d");
  const segs = state.segments.length ? state.segments : fallbackSegs();
  const n = segs.length;
  const cx = canvas.width / 2, cy = canvas.height / 2, r = canvas.width / 2 - Math.max(16, (canvas.width / 2) * 0.055);
  const arc = (2 * Math.PI) / n;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < n; i++) {
    const seg = segs[i];
    const start = i * arc - Math.PI / 2;
    const end = start + arc;
    const mid = start + arc / 2;

    // wedge with a glossy radial gradient (brighter toward the rim)
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, start, end);
    ctx.closePath();
    const base = seg.kind === "rug" ? RUG_COLORS[i % 2] : (TIER_COLOR[seg.tier] || "#4e8f16");
    const grad = ctx.createRadialGradient(cx, cy, r * 0.12, cx, cy, r);
    grad.addColorStop(0, shade(base, -14));
    grad.addColorStop(0.72, shade(base, 8));
    grad.addColorStop(1, shade(base, 24));
    ctx.fillStyle = grad;
    ctx.fill();

    // thin crisp divider between slices
    ctx.strokeStyle = "rgba(4,7,3,0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // emoji + label drawn HORIZONTALLY (upright, like Wheel of Fortune) at the
    // slice's mid-angle — much easier to read than radial text.
    const emojiSize = Math.max(20, Math.min(34, Math.round(560 / n)));
    const labelSize = Math.max(11, Math.min(17, Math.round(340 / n)));

    // position along the slice's centerline
    const emojiR = r * 0.74; // emoji further out
    const labelR = r * 0.50; // label closer in
    const ex = cx + Math.cos(mid) * emojiR;
    const ey = cy + Math.sin(mid) * emojiR;
    const lx = cx + Math.cos(mid) * labelR;
    const ly = cy + Math.sin(mid) * labelR;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // label (upright)
    let label = seg.label;
    if (label.length > 11) label = label.slice(0, 10) + "…";
    ctx.font = `700 ${labelSize}px 'Space Mono', monospace`;
    // subtle outline so text stays legible on any wedge color
    ctx.lineWidth = 3;
    ctx.strokeStyle = seg.kind === "rug" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.35)";
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = seg.kind === "rug" ? "#ffe9e3" : "#0c1207";
    ctx.fillText(label, lx, ly);

    // emoji (upright)
    ctx.font = `${emojiSize}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.fillText(seg.emoji || "", ex, ey);
    ctx.restore();
  }

  // --- glossy top highlight over the slices (subtle sheen) ---
  const sheen = ctx.createLinearGradient(0, cy - r, 0, cy);
  sheen.addColorStop(0, "rgba(255,255,255,0.10)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, 2 * Math.PI);
  ctx.clip();
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - r, cy - r, r * 2, r);
  ctx.restore();

  // --- metallic bezel ring ---
  const R = canvas.width / 2;
  const bezel = Math.max(16, R * 0.055);
  const rimGrad = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  rimGrad.addColorStop(0, "#161d0e");
  rimGrad.addColorStop(0.25, "#3a4a1c");
  rimGrad.addColorStop(0.5, "#0c1207");
  rimGrad.addColorStop(0.75, "#4e6626");
  rimGrad.addColorStop(1, "#161d0e");
  ctx.beginPath();
  ctx.arc(cx, cy, R - bezel / 2, 0, 2 * Math.PI);
  ctx.strokeStyle = rimGrad;
  ctx.lineWidth = bezel;
  ctx.stroke();

  // bright edge lines on the bezel
  ctx.beginPath();
  ctx.arc(cx, cy, r + 1, 0, 2 * Math.PI);
  ctx.strokeStyle = "#b6ff2e";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, R - 1.5, 0, 2 * Math.PI);
  ctx.strokeStyle = "rgba(182,255,46,0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // --- glowing studs around the bezel (one per slice boundary) ---
  const studR = R - bezel / 2;
  const studSize = Math.max(2.5, bezel * 0.16);
  for (let i = 0; i < n; i++) {
    const a = i * arc - Math.PI / 2;
    const sx = cx + Math.cos(a) * studR;
    const sy = cy + Math.sin(a) * studR;
    ctx.beginPath();
    ctx.arc(sx, sy, studSize, 0, 2 * Math.PI);
    ctx.fillStyle = "#eaffb0";
    ctx.shadowColor = "rgba(182,255,46,0.9)";
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // --- hub backing (behind the center logo) ---
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.19, 0, 2 * Math.PI);
  ctx.fillStyle = "rgba(6,10,4,0.92)";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.19, 0, 2 * Math.PI);
  ctx.strokeStyle = "#b6ff2e";
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** Lighten (+) or darken (-) a hex color by a percentage amount. */
function shade(hex, amt) {
  const h = hex.replace("#", "");
  const num = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  let r = (num >> 16) + amt, g = ((num >> 8) & 0xff) + amt, b = (num & 0xff) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}

function fallbackSegs() {
  return [
    { label: "WAGMI", emoji: "🚀", kind: "win", tier: "big" }, { label: "REKT", emoji: "💀", kind: "rug" },
    { label: "MOON", emoji: "🌕", kind: "win", tier: "medium" }, { label: "NGMI", emoji: "📉", kind: "rug" },
    { label: "GM", emoji: "☀️", kind: "win", tier: "small" }, { label: "RUGGED", emoji: "🫠", kind: "rug" },
    { label: "PUMP", emoji: "📈", kind: "win", tier: "tiny" }, { label: "DUMP", emoji: "🗑️", kind: "rug" },
  ];
}

/* ---------------- upload ---------------- */
function wireUpload() {
  const dz = $("dropzone"), input = $("fileInput");
  dz.addEventListener("click", () => input.click());
  dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
  dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
  dz.addEventListener("drop", (e) => {
    e.preventDefault(); dz.classList.remove("drag");
    if (e.dataTransfer.files[0]) selectFile(e.dataTransfer.files[0]);
  });
  input.addEventListener("change", () => { if (input.files[0]) selectFile(input.files[0]); });
  $("btnUpload").addEventListener("click", doUpload);
  $("btnClearUpload").addEventListener("click", () => {
    resetUploader();
    $("uploadHint").textContent = "";
    $("uploadHint").className = "hint";
  });
}

function selectFile(file) {
  const ok = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  const hint = $("uploadHint");
  hint.className = "hint";
  if (!ok.includes(file.type)) { hint.className = "hint err"; hint.textContent = "That file type isn't supported — use PNG, JPG, GIF, or WEBP."; return; }
  if (file.size > 8 * 1024 * 1024) { hint.className = "hint err"; hint.textContent = "That image is too big (max 8 MB). Pick a smaller one."; return; }
  state.selectedFile = file;
  const preview = $("dzPreview");
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  $("dzInner").hidden = true;
  $("btnUpload").disabled = false;
  $("btnClearUpload").hidden = false; // allow choosing a different image anytime
  hint.textContent = "";
}

async function doUpload() {
  if (!state.selectedFile) return;
  const hint = $("uploadHint");
  hint.className = "hint";
  if (!state.user) {
    hint.className = "hint err";
    hint.innerHTML = 'You need to log in first. <a href="/auth/user/login">Log in with Discord</a>';
    return;
  }

  $("btnUpload").disabled = true;
  hint.textContent = "Uploading to the swamp…";
  const form = new FormData();
  form.append("image", state.selectedFile);
  form.append("caption", $("caption").value || "");

  let res;
  try {
    res = await api("/api/memes", { method: "POST", body: form });
  } catch (e) {
    res = { ok: false, data: { error: "Network error — check your connection and try again." } };
  }

  if (!res.ok) {
    hint.className = "hint err";
    // route the common cases to the right action
    if (res.data.needLogin) {
      hint.innerHTML = 'Your session expired. <a href="/auth/user/login">Log in again</a> to upload.';
    } else if (res.data.needVerify) {
      hint.innerHTML = (res.data.error || "You need to verify a DOOMPS wallet first.") + ' <a href="/">Verify now</a>';
    } else {
      hint.textContent = res.data.error || "Upload failed. Try a different image.";
    }
    $("btnUpload").disabled = false;
    $("btnClearUpload").hidden = false; // let them clear and pick another
    return;
  }
  hint.className = "hint ok";
  hint.textContent = "Dropped. Your spin is unlocked.";
  resetUploader();
  // refresh gallery + spin gate
  state.galleryOffset = 0; state.galleryDone = false;
  await loadGallery(true);
  const s = await api("/api/spin/state");
  if (s.ok) updateSpinGate(s.data);
}

/** Clear the selected file so the user can choose a different one. */
function resetUploader() {
  state.selectedFile = null;
  $("dzPreview").hidden = true;
  $("dzInner").hidden = false;
  $("caption").value = "";
  $("fileInput").value = "";
  $("btnUpload").disabled = true;
  $("btnClearUpload").hidden = true;
}

/* ---------------- gallery ---------------- */
async function loadGallery(reset) {
  if (reset) { $("galleryGrid").innerHTML = ""; state.galleryOffset = 0; state.galleryDone = false; }
  const res = await api(`/api/memes?limit=24&offset=${state.galleryOffset}`);
  if (!res.ok) return;
  const memes = res.data.memes || [];
  const grid = $("galleryGrid");
  memes.forEach((m) => grid.appendChild(memeCard(m)));
  state.galleryOffset += memes.length;
  state.galleryDone = state.galleryOffset >= (res.data.total || 0);
  $("galleryEmpty").hidden = (res.data.total || 0) > 0;
  $("btnMore").hidden = state.galleryDone;
}

function memeCard(m) {
  const card = document.createElement("div");
  card.className = "meme-card";
  const cap = m.caption ? `<span class="meme-cap">${escapeHtml(m.caption)}</span>` : "<span></span>";
  const user = m.username ? `<span class="meme-user">@${escapeHtml(m.username)}</span>` : "";
  card.innerHTML = `<img loading="lazy" src="${m.url}" alt="meme" /><div class="meme-meta">${cap}${user}</div>`;
  return card;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("btnMore").addEventListener("click", () => loadGallery(false));

/* ---------------- spin ---------------- */
function wireSpin() {
  $("btnSpin").addEventListener("click", doSpin);
  const free = $("btnFreeSpin");
  if (free) free.addEventListener("click", doFreeSpin);
}

async function doFreeSpin() {
  if (state.spinning) return;
  state.spinning = true;
  $("btnFreeSpin").disabled = true;
  $("btnSpin").disabled = true;
  $("spinStatus").className = "spin-status";
  $("spinStatus").textContent = "Free spin — just for fun…";

  const res = await api("/api/spin/practice", { method: "POST" });
  if (!res.ok) {
    state.spinning = false;
    $("btnFreeSpin").disabled = false;
    $("spinStatus").className = "spin-status err";
    $("spinStatus").textContent = res.data.error || "Couldn't spin.";
    return;
  }
  animateTo(res.data.segmentIndex, () => showResult({ ...res.data, practice: true }));
}

async function doSpin() {
  if (state.spinning) return;
  state.spinning = true;
  $("btnSpin").disabled = true;
  $("spinStatus").className = "spin-status";
  $("spinStatus").textContent = "The Memematic grinds…";

  const res = await api("/api/spin", { method: "POST" });
  if (!res.ok) {
    state.spinning = false;
    $("spinStatus").className = "spin-status err";
    $("spinStatus").textContent = res.data.error || "Spin failed.";
    // re-gate (e.g. already spun)
    const s = await api("/api/spin/state");
    if (s.ok) updateSpinGate(s.data);
    return;
  }

  animateTo(res.data.segmentIndex, () => showResult(res.data));
}

function animateTo(segmentIndex, done) {
  const segs = state.segments.length ? state.segments : fallbackSegs();
  const n = segs.length;
  const arc = 360 / n;
  // pointer is at top; segment i center angle (from top, cw) = i*arc + arc/2
  const target = segmentIndex * arc + arc / 2;
  const spins = 6; // full rotations for drama
  // we rotate the wheel so the target segment ends under the top pointer
  const finalAngle = spins * 360 + (360 - target);
  state.wheelAngle = finalAngle;
  const wheel = $("wheel");
  wheel.style.transform = `rotate(${finalAngle}deg)`;
  setTimeout(done, 5100);
}

function showResult(data) {
  const overlay = $("overlay");
  overlay.hidden = false;
  $("ovWin").hidden = true;
  $("ovRug").hidden = true;

  if (data.outcome === "rug") {
    $("ovRug").hidden = false;
    const carpet = $("rugCarpet"), monster = $("rugMonster");
    carpet.classList.remove("pull"); monster.classList.remove("fall");
    void carpet.offsetWidth; // reflow to restart animation
    carpet.classList.add("pull"); monster.classList.add("fall");
    // If this was a free spin, make clear nothing was lost.
    const rugSub = document.getElementById("ovRugSub");
    if (rugSub) rugSub.textContent = data.practice
      ? "Just a free spin — no harm done. Upload a meme and spin for real."
      : "";
  } else {
    $("ovWin").hidden = false;
    $("ovWinTitle").textContent = data.segmentLabel || "WAGMI";
    if (data.practice) {
      // Practice win: show what they WOULD have gotten, no claim.
      $("ovWinSub").textContent = `Free spin — you'd have won the ${data.outcome} prize`;
      $("ovPrize").textContent = data.prize || "";
      $("claimBox").hidden = true;
      $("claimDone").hidden = true;
      const note = document.getElementById("ovPracticeNote");
      if (note) { note.hidden = false; note.textContent = "This was a free spin — nothing paid out. Upload a meme, then pull the real lever to win for real."; }
    } else {
      $("ovWinSub").textContent = `You won the ${data.outcome} prize`;
      $("ovPrize").textContent = data.prize || "";
      const note = document.getElementById("ovPracticeNote");
      if (note) note.hidden = true;
      // reset claim form for this win
      $("claimBox").hidden = false;
      $("claimDone").hidden = true;
      $("claimAddr").value = "";
      $("claimHint").textContent = "";
      $("btnClaim").disabled = false;
    }
  }
  state.spinning = false;
}

function wireOverlay() {
  $("ovClose").addEventListener("click", async () => {
    $("overlay").hidden = true;
    const s = await api("/api/spin/state");
    if (s.ok) updateSpinGate(s.data);
  });

  $("btnClaim").addEventListener("click", async () => {
    const addr = $("claimAddr").value.trim();
    const hint = $("claimHint");
    hint.className = "hint";
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      hint.className = "hint err";
      hint.textContent = "Enter a valid 0x wallet address.";
      return;
    }
    $("btnClaim").disabled = true;
    hint.textContent = "Locking it in…";
    const res = await api("/api/spin/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: addr }),
    });
    if (!res.ok) {
      hint.className = "hint err";
      hint.textContent = res.data.error || "Claim failed.";
      $("btnClaim").disabled = false;
      return;
    }
    $("claimBox").hidden = true;
    $("claimDone").hidden = false;
  });
}

boot();
