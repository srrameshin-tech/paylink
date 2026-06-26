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

function renderPinDots() {
  const dots = document.querySelectorAll(".pin-dot");
  dots.forEach((d, i) => {
    d.classList.toggle("filled", i < currentPinEntry.length);
  });
}

async function checkPin() {
  const errEl = document.getElementById("loginError");
  if (currentPinEntry === storedPin) {
    errEl.textContent = "";
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
    await dbSet("paymentLinks/_meta/pin", newPin);
    storedPin = newPin;
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

function formatRupee(amount) {
  const n = parseFloat(amount);
  if (isNaN(n)) return "₹0";
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
    " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

document.getElementById("genBtn").addEventListener("click", async () => {
  const upi = document.getElementById("inUpi").value.trim();
  const name = document.getElementById("inName").value.trim();
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
  if (!amount || parseFloat(amount) <= 0) {
    toast("தொகை போடுங்க");
    return;
  }

  const entry = {
    upi, name, amount: parseFloat(amount), purpose: purpose || "Payment",
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
    width: 160,
    height: 160,
    colorDark: "#1A1024",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });

  document.getElementById("receiptOverlay").classList.add("active");
}

document.getElementById("closeReceiptBtn").addEventListener("click", () => {
  document.getElementById("receiptOverlay").classList.remove("active");
  activeReceiptId = null;
  renderHistory();
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
  const link = buildUpiLink(entry);

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

document.getElementById("shareBtn").addEventListener("click", async () => {
  const entry = historyData[activeReceiptId];
  if (!entry) return;
  const link = buildUpiLink(entry);
  const text = `*PAYMENT REQUEST*\n―――――――――――\nPay to: *${entry.name}*\nAmount: *${formatRupee(entry.amount)}*\nPurpose: *${entry.purpose}*\n―――――――――――\nQR code\n\nPay using this link:\n${link}`;

  const qrEl = document.getElementById("qrcodeEl");
  const canvas = qrEl.querySelector("canvas");

  // Try sharing with the QR image attached as a file
  if (navigator.share && canvas) {
    try {
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob && navigator.canShare) {
        const file = new File([blob], "paylink-qr.png", { type: "image/png" });
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

document.getElementById("dlBtn").addEventListener("click", () => {
  const qrEl = document.getElementById("qrcodeEl");
  const canvas = qrEl.querySelector("canvas");
  if (!canvas) { toast("QR கிடைக்கல"); return; }
  const link = document.createElement("a");
  link.download = "paylink-qr-" + Date.now() + ".png";
  link.href = canvas.toDataURL("image/png");
  link.click();
  toast("QR save ஆச்சு ✓");
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
  } catch (e) {
    toast("History load fail ஆச்சு");
  }
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
        </div>
        <span class="status-chip ${e.status === 'paid' ? 'paid' : 'pending'}">${e.status === 'paid' ? '✓ Paid' : 'Pending'}</span>
      </div>
      <div class="hist-actions">
        <button class="view-btn" data-id="${e.id}">👁️ View</button>
        <button class="toggle-btn" data-id="${e.id}">${e.status === 'paid' ? '↩️ Mark Pending' : '✓ Mark Paid'}</button>
        <button class="danger del-btn" data-id="${e.id}">🗑️ Delete</button>
      </div>
    </div>
  `).join("");

  list.querySelectorAll(".view-btn").forEach(btn => {
    btn.addEventListener("click", () => openReceipt(historyData[btn.dataset.id]));
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

async function toggleStatus(id) {
  const entry = historyData[id];
  if (!entry) return;
  const newStatus = entry.status === "paid" ? "pending" : "paid";
  try {
    await dbUpdate(DB_PATH + "/entries/" + id, { status: newStatus });
    entry.status = newStatus;
    renderHistory(document.getElementById("searchInput").value.trim());
    renderStats();
    toast(newStatus === "paid" ? "Paid-a mark ஆச்சு ✓" : "Pending-a mark ஆச்சு");
  } catch (e) {
    toast("Update fail ஆச்சு");
  }
}

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
