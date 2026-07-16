// ===================== CONFIG =====================
const firebaseConfig = {
  apiKey: "AIzaSyBVGVu59jDZybPFAX_pRisSrQRoXHQ0EWY",
  databaseURL: "https://kmbsc-chit-default-rtdb.asia-southeast1.firebasedatabase.app"
};

const MASTER_PIN_DEFAULT = "1973";
const RECOVERY_CODE = "TEMPLE2026";
const DB_PATH = "paymentLinks";

// ===================== FIREBASE (REST, no SDK needed) =====================
const DB_BASE = firebaseConfig.databaseURL;

async function dbGet(path) {
  const res = await fetch(`${DB_BASE}/${path}.json`);
  if (!res.ok) throw new Error("DB GET failed");
  return res.json();
}
async function dbSet(path, value) {
  const res = await fetch(`${DB_BASE}/${path}.json`, {
    method: "PUT",
    body: JSON.stringify(value)
  });
  if (!res.ok) throw new Error("DB SET failed");
  return res.json();
}
async function dbPush(path, value) {
  const res = await fetch(`${DB_BASE}/${path}.json`, {
    method: "POST",
    body: JSON.stringify(value)
  });
  if (!res.ok) throw new Error("DB PUSH failed");
  return res.json();
}
async function dbUpdate(path, value) {
  const res = await fetch(`${DB_BASE}/${path}.json`, {
    method: "PATCH",
    body: JSON.stringify(value)
  });
  if (!res.ok) throw new Error("DB UPDATE failed");
  return res.json();
}
async function dbDelete(path) {
  const res = await fetch(`${DB_BASE}/${path}.json`, { method: "DELETE" });
  if (!res.ok) throw new Error("DB DELETE failed");
  return res.json();
}

// ===================== PIN HASHING (SHA-256, auto-migrates legacy plaintext) =====================
async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function isHashFormat(str) { return typeof str === "string" && /^[a-f0-9]{64}$/i.test(str); }
async function verifyPin(entered, stored) {
  if (!stored) return false;
  if (isHashFormat(stored)) return (await sha256Hex(entered)) === stored;
  return entered === stored; // legacy plaintext fallback
}

// ===================== STATE =====================
let currentPinEntry = "";
let storedPin = null;
let historyData = {}; // id -> entry
let activeReceiptId = null; // currently open receipt (for share/copy/dl/mark paid)

// ===================== TOAST =====================
function toast(msg, duration = 2200) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), duration);
}

// ===================== PIN LOGIN =====================
const keypadLayout = ["1","2","3","4","5","6","7","8","9","","0","⌫"];

function buildKeypad() {
  const kp = document.getElementById("keypad");
  kp.innerHTML = "";
  keypadLayout.forEach(k => {
    const btn = document.createElement("button");
    btn.className = "key" + (k === "" ? " empty" : "");
    btn.textContent = k;
    if (k !== "") {
      btn.addEventListener("click", () => onKeyPress(k));
    }
    kp.appendChild(btn);
  });
}

function onKeyPress(k) {
  const errEl = document.getElementById("loginError");
  if (k === "⌫") {
    currentPinEntry = currentPinEntry.slice(0, -1);
    errEl.textContent = "";
    renderPinDots();
    return;
  }
  if (currentPinEntry.length >= 4) return;
  currentPinEntry += k;
  renderPinDots();
  if (currentPinEntry.length === 4) {
    setTimeout(checkPin, 150);
  }
}
function digitFromKeyEvent(e){
  if (e.code && /^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (e.code && /^Numpad[0-9]$/.test(e.code)) return e.code.slice(6);
  if (e.key >= '0' && e.key <= '9') return e.key;
  return null;
}
document.addEventListener('keydown', (e) => {
  const loginScreen = document.getElementById('loginScreen');
  if (!loginScreen || !loginScreen.classList.contains('active')) return;
  const d = digitFromKeyEvent(e);
  if (d !== null) onKeyPress(d);
  else if (e.key === 'Backspace' || e.code === 'Backspace') onKeyPress('⌫');
});

function renderPinDots() {
  const dots = document.querySelectorAll(".pin-dot");
  dots.forEach((d, i) => {
    d.classList.toggle("filled", i < currentPinEntry.length);
  });
}

async function checkPin() {
  const errEl = document.getElementById("loginError");
  const ok = await verifyPin(currentPinEntry, storedPin);
  if (ok) {
    errEl.textContent = "";
    if (!isHashFormat(storedPin)) {
      // auto-migrate legacy plaintext PIN to hash
      const hashed = await sha256Hex(currentPinEntry);
      storedPin = hashed;
      dbSet("paymentLinks/_meta/pin", hashed).catch(() => {});
    }
    enterApp();
  } else {
    errEl.textContent = "தவறான PIN, மறுபடியும் try பண்ணுங்க";
    const dots = document.getElementById("pinDots");
    dots.style.animation = "none";
    setTimeout(() => { dots.style.animation = ""; }, 10);
    currentPinEntry = "";
    renderPinDots();
  }
}

function enterApp() {
  document.getElementById("loginScreen").classList.remove("active");
  document.getElementById("mainScreen").classList.add("active");
  loadHistory();
}

function lockApp() {
  currentPinEntry = "";
  renderPinDots();
  document.getElementById("mainScreen").classList.remove("active");
  document.getElementById("loginScreen").classList.add("active");
}

// ===================== PIN SETUP / RECOVERY =====================
async function initPin() {
  try {
    const data = await dbGet("paymentLinks/_meta/pin");
    storedPin = data || MASTER_PIN_DEFAULT;
  } catch (e) {
    storedPin = MASTER_PIN_DEFAULT;
  }
}

document.getElementById("forgotLink").addEventListener("click", () => {
  document.getElementById("forgotOverlay").classList.add("active");
});
document.getElementById("closeForgotBtn").addEventListener("click", () => {
  document.getElementById("forgotOverlay").classList.remove("active");
});
document.getElementById("recoverBtn").addEventListener("click", async () => {
  const code = document.getElementById("recoveryCodeInput").value.trim();
  const newPin = document.getElementById("newPinInput").value.trim();
  const errEl = document.getElementById("recoveryError");
  if (code !== RECOVERY_CODE) {
    errEl.textContent = "Recovery code தவறு";
    return;
  }
  if (!/^\d{4}$/.test(newPin)) {
    errEl.textContent = "4 digit PIN போடுங்க";
    return;
  }
  try {
    const hashedPin = await sha256Hex(newPin);
    await dbSet("paymentLinks/_meta/pin", hashedPin);
    storedPin = hashedPin;
    errEl.textContent = "";
    document.getElementById("forgotOverlay").classList.remove("active");
    toast("PIN reset ஆச்சு ✓");
  } catch (e) {
    errEl.textContent = "Network error, try again";
  }
});

// ===================== UPI LINK / QR GENERATION =====================
function buildUpiLink({ upi, name, amount, purpose }) {
  const params = [];
  params.push("pa=" + encodeURIComponent(upi));
  params.push("pn=" + encodeURIComponent(name));
  if (amount) params.push("am=" + encodeURIComponent(amount));
  params.push("cu=INR");
  if (purpose) params.push("tn=" + encodeURIComponent(purpose));
  return `upi://pay?${params.join("&")}`;
}

function buildShortLink(entry) {
  return `https://paylink.sramesh.in/p/?id=${entry.id}`;
}

function formatRupee(amount) {
  if (amount === null || amount === undefined) return "Open Amount";
  const n = parseFloat(amount);
  if (isNaN(n)) return "₹0";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

let editingId = null;

function editLink(id) {
  const entry = historyData[id];
  if (!entry) return;
  editingId = id;

  document.getElementById("inUpi").value = entry.upi || "";
  document.getElementById("inName").value = entry.name || "";
  document.getElementById("inPurpose").value = entry.purpose === "Payment" ? "" : (entry.purpose || "");

  const isOpen = !!entry.openAmount;
  document.getElementById("inOpenAmount").checked = isOpen;
  document.getElementById("amountInputWrap").classList.toggle("disabled", isOpen);
  document.getElementById("openAmountHint").style.display = isOpen ? "block" : "none";
  document.getElementById("amountPresets").style.display = isOpen ? "none" : "flex";
  document.getElementById("inAmount").value = isOpen ? "" : (entry.amount ?? "");

  document.getElementById("genBtn").textContent = "✏️ Link-ஐ Update பண்ணு";
  switchTab("create");
  toast("Edit mode - details மாத்தி Update பண்ணுங்க");
}

document.getElementById("inOpenAmount").addEventListener("change", (e) => {
  const isOpen = e.target.checked;
  document.getElementById("amountInputWrap").classList.toggle("disabled", isOpen);
  document.getElementById("openAmountHint").style.display = isOpen ? "block" : "none";
  document.getElementById("amountPresets").style.display = isOpen ? "none" : "flex";
  if (isOpen) document.getElementById("inAmount").value = "";
});

document.getElementById("genBtn").addEventListener("click", async () => {
  const upi = document.getElementById("inUpi").value.trim();
  const name = document.getElementById("inName").value.trim();
  const isOpenAmount = document.getElementById("inOpenAmount").checked;
  const amount = document.getElementById("inAmount").value.trim();
  const purpose = document.getElementById("inPurpose").value.trim();

  if (!upi || !upi.includes("@")) {
    toast("சரியான UPI ID போடுங்க (e.g. name@upi)");
    return;
  }
  if (!name) {
    toast("Payee பெயர் போடுங்க");
    return;
  }
  if (!isOpenAmount && (!amount || parseFloat(amount) <= 0)) {
    toast("தொகை போடுங்க (அல்லது Open Amount ON பண்ணுங்க)");
    return;
  }

  if (editingId) {
    const id = editingId;
    const updates = {
      upi, name, amount: isOpenAmount ? null : parseFloat(amount), openAmount: isOpenAmount,
      purpose: purpose || "Payment"
    };
    try {
      await dbUpdate(DB_PATH + "/entries/" + id, updates);
      historyData[id] = { ...historyData[id], ...updates };
      toast("Link Update ஆச்சு ✓");
    } catch (e) {
      toast("Update fail ஆச்சு, network check பண்ணுங்க");
      return;
    }
    editingId = null;
    document.getElementById("genBtn").textContent = "QR & Link Generate பண்ணு";
    // clear form
    document.getElementById("inAmount").value = "";
    document.getElementById("inPurpose").value = "";
    document.getElementById("inOpenAmount").checked = false;
    document.getElementById("amountInputWrap").classList.remove("disabled");
    document.getElementById("openAmountHint").style.display = "none";
    document.getElementById("amountPresets").style.display = "flex";
    document.querySelectorAll(".amount-chip").forEach(c => c.classList.remove("active"));
    document.getElementById("inUpi").value = "";
    document.getElementById("inName").value = "";
    populateNameSuggestions();
    populateAmountPresets();
    switchTab("history");
    renderHistory(document.getElementById("searchInput").value.trim());
    renderStats();
    return;
  }

  const entry = {
    upi, name, amount: isOpenAmount ? null : parseFloat(amount), openAmount: isOpenAmount,
    purpose: purpose || "Payment",
    createdAt: Date.now(), status: "pending"
  };

  let id;
  try {
    const res = await dbPush(DB_PATH + "/entries", entry);
    id = res.name;
    entry.id = id;
    historyData[id] = entry;
  } catch (e) {
    toast("Save fail ஆச்சு, network check பண்ணுங்க");
    return;
  }

  openReceipt(entry);
  // clear form
  document.getElementById("inAmount").value = "";
  document.getElementById("inPurpose").value = "";
  document.getElementById("inOpenAmount").checked = false;
  document.getElementById("amountInputWrap").classList.remove("disabled");
  document.getElementById("openAmountHint").style.display = "none";
  document.getElementById("amountPresets").style.display = "flex";
  document.querySelectorAll(".amount-chip").forEach(c => c.classList.remove("active"));
  populateNameSuggestions();
  populateAmountPresets();
});

// ===================== RECEIPT SHEET =====================
function openReceipt(entry) {
  activeReceiptId = entry.id;
  document.getElementById("rcAmt").textContent = formatRupee(entry.amount);
  document.getElementById("rcName").textContent = entry.name;
  document.getElementById("rcUpi").textContent = entry.upi;
  document.getElementById("rcPurpose").textContent = entry.purpose;
  document.getElementById("rcDate").textContent = formatDate(entry.createdAt);
  document.getElementById("paidStampInline").style.display = entry.status === "paid" ? "block" : "none";

  const qrEl = document.getElementById("qrcodeEl");
  qrEl.innerHTML = "";
  const link = buildUpiLink(entry);
  new QRCode(qrEl, {
    text: link,
    width: 220,
    height: 220,
    colorDark: "#1A1024",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });

  document.getElementById("payNowBtn").href = link;

  document.getElementById("receiptOverlay").classList.add("active");
}

document.getElementById("closeReceiptBtn").addEventListener("click", () => {
  document.getElementById("receiptOverlay").classList.remove("active");
  activeReceiptId = null;
  renderHistory();
});

document.getElementById("rcDateRefresh").addEventListener("click", async () => {
  const entry = historyData[activeReceiptId];
  if (!entry) return;
  const now = Date.now();
  document.getElementById("rcDate").textContent = formatDate(now);
  try {
    await dbUpdate(DB_PATH + "/entries/" + entry.id, { createdAt: now });
    entry.createdAt = now;
    toast("Date update ஆச்சு ✓");
  } catch (e) {
    toast("Update fail ஆச்சு");
  }
});

function copyTextFallback(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (e) {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

document.getElementById("copyBtn").addEventListener("click", () => {
  const entry = historyData[activeReceiptId];
  if (!entry) return;
  const link = buildShortLink(entry);

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(link).then(() => {
      toast("Link copy ஆச்சு ✓");
    }).catch(() => {
      const ok = copyTextFallback(link);
      toast(ok ? "Link copy ஆச்சு ✓" : "Copy fail ஆச்சு, link select panni copy pannunga");
    });
  } else {
    const ok = copyTextFallback(link);
    toast(ok ? "Link copy ஆச்சு ✓" : "Copy fail ஆச்சு, link select panni copy pannunga");
  }
});

async function captureReceiptCard() {
  const card = document.getElementById("receiptCard");
  if (!window.html2canvas) return null;
  try {
    const canvas = await html2canvas(card, {
      backgroundColor: null,
      scale: 3,
      useCORS: true
    });
    return canvas;
  } catch (e) {
    return null;
  }
}

document.getElementById("shareBtn").addEventListener("click", async () => {
  const entry = historyData[activeReceiptId];
  if (!entry) return;
  const link = buildShortLink(entry);
  const text = `*PAYMENT REQUEST*\n―――――――――――\nPay to: *${entry.name}*\nAmount: *${formatRupee(entry.amount)}*\nPurpose: *${entry.purpose}*\n―――――――――――\nPay using this link:\n${link}`;

  const cardCanvas = await captureReceiptCard();

  // Try sharing the full grand card (QR + Pay Now button + border) as an image
  if (navigator.share && cardCanvas) {
    try {
      const blob = await new Promise((resolve) => cardCanvas.toBlob(resolve, "image/png"));
      if (blob && navigator.canShare) {
        const file = new File([blob], "paylink-card.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: "PayLink", text, files: [file] });
          return;
        }
      }
      // fallback: share text only if files not supported
      await navigator.share({ title: "PayLink", text });
      return;
    } catch (e) {
      // user cancelled or share failed, fall through to WhatsApp link fallback
      if (e && e.name === "AbortError") return;
    }
  }

  const waLink = "https://wa.me/?text=" + encodeURIComponent(text);
  window.open(waLink, "_blank");
});

document.getElementById("dlBtn").addEventListener("click", async () => {
  const cardCanvas = await captureReceiptCard();
  if (!cardCanvas) { toast("Save ஆகல, try again"); return; }
  const link = document.createElement("a");
  link.download = "paylink-card-" + Date.now() + ".png";
  link.href = cardCanvas.toDataURL("image/png");
  link.click();
  toast("Card save ஆச்சு ✓");
});

// ===================== HISTORY =====================
async function loadHistory() {
  try {
    const data = await dbGet(DB_PATH + "/entries");
    historyData = {};
    if (data) {
      Object.keys(data).forEach(id => {
        historyData[id] = { ...data[id], id };
      });
    }
    renderHistory();
    renderStats();
    populateNameSuggestions();
    populateAmountPresets();
  } catch (e) {
    toast("History load fail ஆச்சு");
  }
}

function populateNameSuggestions() {
  const entries = Object.values(historyData).sort((a, b) => b.createdAt - a.createdAt);
  const seen = new Set();
  const names = [];
  entries.forEach(e => {
    if (e.name && !seen.has(e.name)) {
      seen.add(e.name);
      names.push(e.name);
    }
  });
  const list = document.getElementById("nameList");
  list.innerHTML = names.slice(0, 15).map(n => `<option value="${n}"></option>`).join("");
}

function populateAmountPresets() {
  const entries = Object.values(historyData);
  const counts = {};
  entries.forEach(e => {
    const amt = Math.round(e.amount);
    if (!amt) return;
    counts[amt] = (counts[amt] || 0) + 1;
  });
  let presetAmounts = Object.keys(counts)
    .sort((a, b) => counts[b] - counts[a])
    .slice(0, 5)
    .map(Number);

  // fallback defaults if not enough history yet
  const defaults = [100, 500, 800, 1000, 2000];
  defaults.forEach(d => {
    if (presetAmounts.length < 5 && !presetAmounts.includes(d)) presetAmounts.push(d);
  });
  presetAmounts = presetAmounts.slice(0, 5).sort((a, b) => a - b);

  const wrap = document.getElementById("amountPresets");
  wrap.innerHTML = presetAmounts.map(a =>
    `<div class="amount-chip" data-amt="${a}">₹${a.toLocaleString("en-IN")}</div>`
  ).join("");

  wrap.querySelectorAll(".amount-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.getElementById("inAmount").value = chip.dataset.amt;
      wrap.querySelectorAll(".amount-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
    });
  });
}

function renderStats() {
  const entries = Object.values(historyData);
  const total = entries.reduce((s, e) => s + (e.amount || 0), 0);
  const paid = entries.filter(e => e.status === "paid").reduce((s, e) => s + (e.amount || 0), 0);
  const pending = total - paid;
  const row = document.getElementById("statRow");
  row.innerHTML = `
    <div class="stat-card coral"><div class="s-label">Total Links</div><div class="s-val">${entries.length}</div></div>
    <div class="stat-card mint"><div class="s-label">Paid</div><div class="s-val">${formatRupee(paid)}</div></div>
    <div class="stat-card gold"><div class="s-label">Pending</div><div class="s-val">${formatRupee(pending)}</div></div>
  `;
}

function renderHistory(filterText = "") {
  const list = document.getElementById("historyList");
  let entries = Object.values(historyData).sort((a, b) => b.createdAt - a.createdAt);

  if (filterText) {
    const f = filterText.toLowerCase();
    entries = entries.filter(e =>
      (e.purpose || "").toLowerCase().includes(f) ||
      (e.upi || "").toLowerCase().includes(f) ||
      (e.name || "").toLowerCase().includes(f)
    );
  }

  if (entries.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="e-ic">🧾</div>
        <p>இன்னும் payment link எதுவும் இல்ல.<br>Create tab-ல போய் ஒன்னு உருவாக்குங்க.</p>
      </div>`;
    return;
  }

  list.innerHTML = entries.map(e => `
    <div class="hist-item" data-id="${e.id}">
      <div class="hist-top">
        <div>
          <div class="hist-amt">${formatRupee(e.amount)}</div>
          <div class="hist-purpose">${escapeHtml(e.purpose)}</div>
          <div class="hist-meta">${escapeHtml(e.upi)} · ${formatDate(e.createdAt)}</div>
          ${e.payerNote ? `<div class="hist-meta" style="color:var(--mint);margin-top:4px;">✅ Payer said: Paid</div>` : ''}
        </div>
        <span class="status-chip ${e.status === 'paid' ? 'paid' : 'pending'}">${e.status === 'paid' ? '✓ Paid' : 'Pending'}</span>
      </div>
      <div class="hist-actions">
        <button class="view-btn" data-id="${e.id}">👁️ View</button>
        <button class="edit-btn" data-id="${e.id}">✏️ Edit</button>
        <button class="toggle-btn" data-id="${e.id}">${e.status === 'paid' ? '↩️ Mark Pending' : '✓ Mark Paid'}</button>
        <button class="danger del-btn" data-id="${e.id}">🗑️ Delete</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll(".view-btn").forEach(btn => {
    btn.addEventListener("click", () => openReceipt(historyData[btn.dataset.id]));
  });
  list.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => editLink(btn.dataset.id));
  });
  list.querySelectorAll(".toggle-btn").forEach(btn => {
    btn.addEventListener("click", () => toggleStatus(btn.dataset.id));
  });
  list.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteEntry(btn.dataset.id));
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function generateRefId() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `PL-${yy}${mm}-${rand}`;
}

async function toggleStatus(id) {
  const entry = historyData[id];
  if (!entry) return;
  const newStatus = entry.status === "paid" ? "pending" : "paid";
  const updates = { status: newStatus };
  if (newStatus === "paid") {
    updates.paidAt = Date.now();
    if (!entry.refId) updates.refId = generateRefId();
  }
  try {
    await dbUpdate(DB_PATH + "/entries/" + id, updates);
    Object.assign(entry, updates);
    renderHistory(document.getElementById("searchInput").value.trim());
    renderStats();
    if (newStatus === "paid") {
      toast("Paid-a mark ஆச்சு ✓");
      showPaidConfirmation(entry);
    } else {
      toast("Pending-a mark ஆச்சு");
    }
  } catch (e) {
    toast("Update fail ஆச்சு");
  }
}

let activePaidConfirmId = null;

function spawnConfetti(container, count = 18) {
  const colors = ["#FFC94D", "#3EE8A8", "#FF7A5C", "#FFD27A", "#9C7BFF"];
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 70;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist - 20;
    piece.style.setProperty("--tx", `${tx}px`);
    piece.style.setProperty("--ty", `${ty}px`);
    piece.style.setProperty("--rot", `${Math.random() * 360 - 180}deg`);
    piece.style.background = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 80}ms`;
    container.appendChild(piece);
    setTimeout(() => piece.remove(), 1100);
  }
}

function showPaidConfirmation(entry) {
  activePaidConfirmId = entry.id;
  document.getElementById("pcAmt").textContent = formatRupee(entry.amount);
  document.getElementById("pcSub").textContent = `Paid to ${entry.name} kitta mark ஆச்சு`;
  document.getElementById("pcName").textContent = entry.name;
  document.getElementById("pcUpi").textContent = entry.upi;
  document.getElementById("pcPurpose").textContent = entry.purpose;
  document.getElementById("pcDate").textContent = formatDate(entry.paidAt || Date.now());
  document.getElementById("pcRefId").textContent = entry.refId || "-";

  const shareToggle = document.getElementById("pcShareToggle");
  const savedPref = localStorage.getItem("pl_shareOnPaid");
  shareToggle.checked = savedPref === null ? true : savedPref === "1";
  applyShareToggleState();

  document.getElementById("paidConfirmOverlay").classList.add("active");
  setTimeout(() => {
    spawnConfetti(document.querySelector("#paidConfirmOverlay .confirm-check"));
  }, 150);
}

function applyShareToggleState() {
  const on = document.getElementById("pcShareToggle").checked;
  document.getElementById("pcShareBtn").classList.toggle("disabled-btn", !on);
}

document.getElementById("pcShareToggle").addEventListener("change", (e) => {
  localStorage.setItem("pl_shareOnPaid", e.target.checked ? "1" : "0");
  applyShareToggleState();
});

document.getElementById("closePaidConfirmBtn").addEventListener("click", () => {
  document.getElementById("paidConfirmOverlay").classList.remove("active");
  activePaidConfirmId = null;
});

document.getElementById("pcShareBtn").addEventListener("click", async () => {
  if (!document.getElementById("pcShareToggle").checked) return;
  const entry = historyData[activePaidConfirmId];
  if (!entry) return;
  const text = `*PAYMENT RECEIPT*\n―――――――――――\nPaid to: *${entry.name}*\nAmount: *${formatRupee(entry.amount)}*\nPurpose: *${entry.purpose}*\nDate: ${formatDate(entry.paidAt || Date.now())}\nRef ID: ${entry.refId || "-"}\n―――――――――――\n✅ Payment recorded on PayLink`;

  if (navigator.share) {
    try {
      await navigator.share({ title: "PayLink Receipt", text });
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
  }
  const waLink = "https://wa.me/?text=" + encodeURIComponent(text);
  window.open(waLink, "_blank");
});

async function deleteEntry(id) {
  if (!confirm("இந்த link-ஐ delete பண்ணலாமா?")) return;
  try {
    await dbDelete(DB_PATH + "/entries/" + id);
    delete historyData[id];
    renderHistory(document.getElementById("searchInput").value.trim());
    renderStats();
    toast("Delete ஆச்சு");
  } catch (e) {
    toast("Delete fail ஆச்சு");
  }
}

document.getElementById("searchInput").addEventListener("input", (e) => {
  renderHistory(e.target.value.trim());
});

// ===================== TABS =====================
document.getElementById("tabCreateBtn").addEventListener("click", () => switchTab("create"));
document.getElementById("tabHistoryBtn").addEventListener("click", () => switchTab("history"));

function switchTab(tab) {
  const createTab = document.getElementById("createTab");
  const historyTab = document.getElementById("historyTab");
  const createBtn = document.getElementById("tabCreateBtn");
  const historyBtn = document.getElementById("tabHistoryBtn");
  if (tab === "create") {
    createTab.style.display = "block";
    historyTab.style.display = "none";
    createBtn.classList.add("active");
    historyBtn.classList.remove("active");
  } else {
    createTab.style.display = "none";
    historyTab.style.display = "block";
    createBtn.classList.remove("active");
    historyBtn.classList.add("active");
    renderHistory(document.getElementById("searchInput").value.trim());
    renderStats();
  }
}

// ===================== LOCK BUTTON =====================
document.getElementById("lockBtn").addEventListener("click", lockApp);
document.getElementById("lockBtn2").addEventListener("click", lockApp);

// ===================== INIT =====================
(async function init() {
  buildKeypad();
  renderPinDots();
  await initPin();

  // PWA install support
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
