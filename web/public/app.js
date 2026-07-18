const $ = (id) => document.getElementById(id);
const state = { address: null, nonce: null, proof: null, sealed: [] };

async function api(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

fetch("/api/config").then((r) => r.json()).then((c) => {
  if (c.brandName) document.title = `${c.brandName} — Holder Verification`;
});

const unlock = (id) => $(id).classList.remove("is-locked");
const lock = (id) => $(id).classList.add("is-locked");

function renderLedger() {
  const ul = $("ledger");
  ul.innerHTML = "";
  state.sealed.forEach((addr) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="seal-dot"></span><code>${addr}</code><span class="sealed-tag">sealed</span>`;
    ul.appendChild(li);
  });
  if (state.sealed.length) {
    unlock("step-ledger");
    const link = $("btnDiscord");
    link.hidden = false;
    link.href = `/auth/discord/start?proof=${encodeURIComponent(state.proof)}`;
  }
}

// STEP 1 — claim
$("btnClaim").addEventListener("click", async () => {
  const address = $("addr").value.trim();
  const hint = $("addrHint");
  hint.className = "hint";
  hint.textContent = "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    hint.className = "hint err";
    hint.textContent = "That doesn't look like a 0x Ethereum address.";
    return;
  }
  if (state.sealed.includes(address.toLowerCase())) {
    hint.className = "hint err";
    hint.textContent = "You already sealed this wallet.";
    return;
  }
  $("btnClaim").disabled = true;
  const { ok, data } = await api("/api/challenge", { address });
  $("btnClaim").disabled = false;
  if (!ok) {
    hint.className = "hint err";
    hint.textContent = data.error || "Could not create a challenge.";
    return;
  }
  state.address = data.address;
  state.nonce = data.challengeString.split(":").pop();
  $("challenge").textContent = data.challengeString;
  hint.className = "hint ok";
  hint.textContent = "Mark drawn. Inscribe it in this wallet's OpenSea bio below.";
  unlock("step-inscribe");
  unlock("step-seal");
  $("verdict").hidden = true;
  $("step-inscribe").scrollIntoView({ behavior: "smooth", block: "center" });
});

// Copy
$("btnCopy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("challenge").textContent);
  $("btnCopy").textContent = "Copied";
  setTimeout(() => ($("btnCopy").textContent = "Copy"), 1500);
});

// STEP 3 — seal
$("btnConfirm").addEventListener("click", async () => {
  const verdict = $("verdict");
  verdict.hidden = false;
  verdict.className = "verdict";
  verdict.textContent = "Reading this wallet's OpenSea bio…";
  $("btnConfirm").disabled = true;
  const { data } = await api("/api/confirm", {
    address: state.address,
    nonce: state.nonce,
    session: state.proof || "",
  });
  $("btnConfirm").disabled = false;
  if (data.ok) {
    verdict.className = "verdict ok";
    verdict.textContent = "Sealed. Wallet control confirmed.";
    state.proof = data.proof;
    state.sealed = data.addresses.slice();
    renderLedger();
  } else {
    verdict.className = "verdict bad";
    verdict.textContent = data.reason || data.error || "Verification failed.";
  }
});

// Add another wallet
$("btnAnother").addEventListener("click", () => {
  $("addr").value = "";
  $("addrHint").textContent = "";
  lock("step-inscribe");
  lock("step-seal");
  $("verdict").hidden = true;
  $("step-address").scrollIntoView({ behavior: "smooth", block: "center" });
  $("addr").focus();
});
