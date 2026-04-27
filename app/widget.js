/**
 * Zoho CRM WhatsApp Widget
 * Handles communication between Zoho CRM and the WABA AppSail backend.
 */

// ─── CONFIGURATION ────────────────────────────────────────────────────────────

const DEFAULT_BACKEND_URL = "https://waba-10123192285.development.catalystappsail.com";

const DOM = {
  loadingState      : document.getElementById("loading-state"),
  emptyState        : document.getElementById("empty-state"),
  messagesArea      : document.getElementById("messages-area"),
  messageInput      : document.getElementById("message-input"),
  sendBtn           : document.getElementById("send-btn"),
  contactName       : document.getElementById("contact-name"),
  contactPhone      : document.getElementById("contact-phone"),
  statusToast       : document.getElementById("status-toast"),
  signalPanel       : document.getElementById("signal-panel"),
  signalSubject     : document.getElementById("signal-subject"),
  signalMessage     : document.getElementById("signal-message"),
  signalTime        : document.getElementById("signal-time"),
  signalMeta        : document.getElementById("signal-meta"),
  manualSearchInput : document.getElementById("manual-search-input"),
  manualSearchBtn   : document.getElementById("manual-search-btn"),
  manualSearchResults: document.getElementById("manual-search-results"),
  manualSearchHint  : document.getElementById("manual-search-hint"),
  templateList      : document.getElementById("template-list"),
};

let currentContact = {
  id    : null,
  name  : "",
  phone : "",
  module: "Contacts",
};

let messages = [];
let refreshInterval = null;

// ─── INITIALIZATION ───────────────────────────────────────────────────────────

ZOHO.embeddedApp.on("PageLoad", async function (data) {
  console.log("[Widget] PageLoad data:", data);

  try {
    if (data && data.Entity && data.EntityId) {
      // Loaded as a related list or button on a specific record
      const record = await ZOHO.CRM.API.getRecord({
        Entity  : data.Entity,
        RecordID: data.EntityId,
      });

      if (record && record.data && record.data[0]) {
        const row = record.data[0];
        currentContact = {
          id    : row.id,
          name  : row.Full_Name || `${row.First_Name || ""} ${row.Last_Name || ""}`.trim() || row.Company || "Unnamed record",
          phone : normalizePhone(row.Mobile || row.Phone || row.Other_Phone || ""),
          module: data.Entity,
        };
      }
    } else if (data && (data.data || data.signal)) {
      // Loaded from a Zoho Signal
      const signalContext = createSignalContext(data);
      renderSignalPanel(signalContext);

      if (signalContext.phone) {
        currentContact = {
          id    : signalContext.recordId,
          name  : signalContext.senderName,
          phone : signalContext.phone,
          module: signalContext.moduleName,
        };
      }
    }

    updateUI();

    if (currentContact.phone) {
      await fetchMessages();
      startAutoRefresh();
    } else {
      DOM.loadingState.classList.add("hidden");
      DOM.emptyState.classList.remove("hidden");
    }
  } catch (err) {
    console.error("[Widget] Init error:", err);
    showStatus("Initialization failed. Please refresh.", "error", 5000);
  }
});

ZOHO.embeddedApp.init();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getBackendUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  return (
    window.WABA_CONFIG?.backendUrl ||
    urlParams.get("backend_url") ||
    localStorage.getItem("waba_backend_url") ||
    DEFAULT_BACKEND_URL
  ).replace(/\/+$/, "");
}

/**
 * Makes a request to the backend using Zoho's internal proxy to bypass CORS.
 */
async function backendRequest(options) {
  const baseUrl = getBackendUrl();
  const url = options.url.startsWith("http") ? options.url : `${baseUrl}${options.url}`;
  
  const requestOptions = {
    url: url,
    method: options.method || "GET",
    headers: options.headers || {},
    param: options.params || {},
    body: options.body || {},
  };

  console.log(`[Widget] Requesting: ${requestOptions.method} ${requestOptions.url}`);

  try {
    const response = await ZOHO.CRM.HTTP.post(requestOptions);
    // ZOHO.CRM.HTTP.post returns a string that needs to be parsed
    const data = typeof response === "string" ? JSON.parse(response) : response;
    
    // Check for Zoho-level errors
    if (data.status_code && (data.status_code < 200 || data.status_code >= 300)) {
      throw new Error(data.message || `HTTP ${data.status_code}`);
    }

    return data;
  } catch (err) {
    console.error("[Widget] Backend request failed:", err);
    throw err;
  }
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (digits.startsWith("00")) return digits.slice(2);
  return digits;
}

function firstNonEmpty(values) {
  return values.find(v => v !== undefined && v !== null && String(v).trim() !== "") || "";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showStatus(message, type = "info", duration = 3000) {
  DOM.statusToast.textContent = message;
  DOM.statusToast.className = `status-toast show ${type}`;
  if (duration > 0) {
    setTimeout(() => DOM.statusToast.classList.remove("show"), duration);
  }
}

function updateUI() {
  DOM.contactName.textContent = currentContact.name || "Unknown Contact";
  DOM.contactPhone.textContent = currentContact.phone || "No phone number";
  DOM.sendBtn.disabled = !currentContact.phone;
  DOM.messageInput.placeholder = currentContact.phone
    ? "Type a message..."
    : "No phone number available";
}

function formatTime(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString("en-MY", {
      hour  : "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kuala_Lumpur",
    });
  } catch { return ""; }
}

function formatDate(isoString) {
  try {
    const d   = new Date(isoString);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === now.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";

    return d.toLocaleDateString("en-MY", {
      day: "numeric", month: "short", year: "numeric",
      timeZone: "Asia/Kuala_Lumpur",
    });
  } catch { return ""; }
}

function formatDateTime(isoString) {
  try {
    const d = new Date(isoString);
    return d.toLocaleString("en-MY", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kuala_Lumpur",
    });
  } catch { return ""; }
}

function createSignalContext(payload) {
  const signalData = payload?.data || payload?.signal || {};
  const record = payload?.record || {};
  const recordData = record?.data || {};

  return {
    isSignal  : true,
    subject   : firstNonEmpty([
      signalData.title,
      signalData.subject,
      signalData.event_title,
      "WhatsApp update received",
    ]),
    message   : firstNonEmpty([
      signalData.message,
      signalData.text,
      signalData.body,
      signalData.preview,
      signalData.description,
    ]),
    timestamp : firstNonEmpty([
      signalData.timestamp,
      signalData.created_time,
      signalData.received_at,
      payload?.time,
    ]),
    senderName: firstNonEmpty([
      signalData.sender_name,
      signalData.contact_name,
      recordData.Full_Name,
      `${recordData.First_Name || ""} ${recordData.Last_Name || ""}`.trim(),
    ]),
    phone      : normalizePhone(firstNonEmpty([
      recordData.Mobile,
      signalData.mobile,
      signalData.phone,
      signalData.wa_id,
      signalData.from,
      signalData.whatsapp_number,
      recordData.Phone,
      recordData.Other_Phone,
      // Fallback to searching in the message body if it's a signal
      (signalData.message && signalData.message.match(/Phone:\s*(\d+)/)?.[1]),
    ])),
    moduleName: firstNonEmpty([
      record.Entity,
      record.module,
      signalData.module,
      "Contacts",
    ]),
    recordId  : firstNonEmpty([
      record.EntityId,
      record.id,
      signalData.record_id,
    ]),
    raw: payload,
  };
}

function renderSignalPanel(signalContext) {
  if (!signalContext || !signalContext.isSignal) {
    DOM.signalPanel.classList.remove("show");
    return;
  }

  DOM.signalSubject.textContent = signalContext.subject || "WhatsApp update received";
  DOM.signalMessage.textContent = signalContext.message || "A new signal opened this widget.";
  DOM.signalTime.textContent = signalContext.timestamp ? formatDateTime(signalContext.timestamp) : "";
  DOM.signalMeta.innerHTML = "";

  [
    signalContext.senderName ? `Sender: ${signalContext.senderName}` : "",
    signalContext.phone ? `Phone: ${signalContext.phone}` : "",
    signalContext.moduleName ? `Module: ${signalContext.moduleName}` : "",
    signalContext.recordId ? `Record ID: ${signalContext.recordId}` : "",
  ].filter(Boolean).forEach(text => {
    const chip = document.createElement("span");
    chip.className = "signal-chip";
    chip.textContent = text;
    DOM.signalMeta.appendChild(chip);
  });

  DOM.signalPanel.classList.add("show");
}

// ─── MESSAGES ─────────────────────────────────────────────────────────────────

async function fetchMessages(silent = false) {
  if (!currentContact.phone) return;

  if (!silent) {
    DOM.loadingState.classList.remove("hidden");
  }

  try {
    const phone = normalizePhone(currentContact.phone);
    const data = await backendRequest({
      url: `/api/messages?phone=${encodeURIComponent(phone)}&limit=50`,
      method: "GET"
    });

    messages = data.messages || [];
    renderMessages(messages);

    if (!silent) showStatus(`${messages.length} message(s) loaded`, "success", 2000);
  } catch (err) {
    console.error("[Widget] Fetch messages error:", err);
    DOM.loadingState.classList.add("hidden");
    if (!silent) showStatus("Failed to load messages. Check backend connection.", "error", 5000);
  }
}

function renderMessages(msgs) {
  DOM.messagesArea.innerHTML = "";
  DOM.loadingState.classList.add("hidden");

  if (!msgs || msgs.length === 0) {
    DOM.emptyState.classList.remove("hidden");
    return;
  }

  DOM.emptyState.classList.add("hidden");

  // Reverse to show oldest first (API returns newest first)
  const sorted = [...msgs].reverse();

  let lastDate = null;

  sorted.forEach(msg => {
    const msgDate = formatDate(msg.timestamp);

    if (msgDate !== lastDate) {
      const sep = document.createElement("div");
      sep.className = "date-separator";
      sep.innerHTML = `<span>${msgDate}</span>`;
      DOM.messagesArea.appendChild(sep);
      lastDate = msgDate;
    }

    const wrapper = document.createElement("div");
    wrapper.className = `msg-wrapper ${msg.direction}`;
    wrapper.dataset.msgId = msg.id;

    if (msg.direction === "inbound" && msg.senderName && msg.senderName !== msg.from) {
      const sender = document.createElement("div");
      sender.className = "msg-sender";
      sender.textContent = msg.senderName;
      wrapper.appendChild(sender);
    }

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    if (msg.type && msg.type !== "text") {
      const badge = document.createElement("span");
      badge.className = "msg-type-badge";
      badge.textContent = msg.type.toUpperCase();
      bubble.appendChild(badge);
      bubble.appendChild(document.createElement("br"));
    }

    const textNode = document.createTextNode(msg.text || "");
    bubble.appendChild(textNode);

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = formatTime(msg.timestamp);

    if (msg.direction === "outbound") {
      const tick = document.createElement("span");
      tick.textContent = msg.status === "read" ? " ✓✓" : " ✓";
      tick.style.color = msg.status === "read" ? "#53BDEB" : "#8696A0";
      meta.appendChild(tick);
    }

    bubble.appendChild(meta);
    wrapper.appendChild(bubble);
    DOM.messagesArea.appendChild(wrapper);
  });

  DOM.messagesArea.scrollTop = DOM.messagesArea.scrollHeight;
}

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────

async function sendMessage() {
  const text = DOM.messageInput.value.trim();
  if (!text || !currentContact.phone) return;

  DOM.sendBtn.disabled = true;
  showStatus("Sending...", "info", 0);

  try {
    const phone = normalizePhone(currentContact.phone);

    const data = await backendRequest({
      url: "/api/send-message",
      method: "POST",
      body: {
        phone      : phone,
        message    : text,
        contactId  : currentContact.id,
        contactName: currentContact.name,
      }
    });

    if (data.success) {
      DOM.messageInput.value = "";
      autoResizeTextarea(DOM.messageInput);
      showStatus("Message sent successfully ✓", "success", 3000);

      const optimistic = {
        id       : data.messageId,
        text     : text,
        type     : "text",
        direction: "outbound",
        timestamp: data.timestamp || new Date().toISOString(),
        status   : "sent",
      };
      messages.unshift(optimistic);
      renderMessages(messages);
    } else {
      showStatus(`Send failed: ${data.error || "Unknown error"}`, "error", 5000);
    }
  } catch (err) {
    console.error("[Widget] Send message error:", err);
    const msg = err.name === "TypeError" && err.message === "Failed to fetch"
      ? "Network error (CORS or Offline). Check backend URL."
      : `Error: ${err.message || "Unknown error"}`;
    showStatus(msg, "error", 7000);
  } finally {
    DOM.sendBtn.disabled = false;
    DOM.messageInput.focus();
  }
}

// ─── AUTO REFRESH ─────────────────────────────────────────────────────────────

function startAutoRefresh() {
  stopAutoRefresh();
  refreshInterval = setInterval(() => fetchMessages(true), 10000);
}

function stopAutoRefresh() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

// ─── UI EVENTS ────────────────────────────────────────────────────────────────

DOM.sendBtn.addEventListener("click", sendMessage);

DOM.messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = (el.scrollHeight) + "px";
}

DOM.messageInput.addEventListener("input", () => autoResizeTextarea(DOM.messageInput));

// ─── MANUAL SEARCH ────────────────────────────────────────────────────────────

async function searchCRMRecords(query) {
  const normalized = normalizePhone(query);
  const trimmed = String(query || "").trim();
  const modules = ["Contacts", "Leads"];
  const criteriaByModule = [];

  if (normalized) {
    modules.forEach(moduleName => {
      criteriaByModule.push([moduleName, [
        `(Mobile:equals:${normalized})`,
        `(Phone:equals:${normalized})`,
        `(Other_Phone:equals:${normalized})`,
      ]]);
    });
  } else if (trimmed) {
    const safe = trimmed.replace(/["\\]/g, " ");
    criteriaByModule.push(["Contacts", [
      `(Full_Name:contains:${safe})`,
      `(Last_Name:contains:${safe})`,
      `(First_Name:contains:${safe})`,
    ]]);
    criteriaByModule.push(["Leads", [
      `(Full_Name:contains:${safe})`,
      `(Last_Name:contains:${safe})`,
      `(First_Name:contains:${safe})`,
      `(Company:contains:${safe})`,
    ]]);
  }

  const results = [];
  for (const [moduleName, criteriaList] of criteriaByModule) {
    for (const criteria of criteriaList) {
      try {
        const response = await ZOHO.CRM.API.searchRecord({
          Entity: moduleName,
          Type  : "criteria",
          Query : criteria,
        });
        const rows = Array.isArray(response?.data) ? response.data : [];
        rows.forEach(row => {
          results.push({
            id    : row.id,
            module: moduleName,
            name  : row.Full_Name || `${row.First_Name || ""} ${row.Last_Name || ""}`.trim() || row.Company || "Unnamed record",
            phone : normalizePhone(row.Mobile || row.Phone || row.Other_Phone || ""),
          });
        });
      } catch (err) {}
    }
  }

  const unique = [];
  const seen = new Set();
  results.forEach(item => {
    const key = `${item.module}:${item.id || item.phone}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(item);
    }
  });

  return unique;
}

function renderManualSearchResults(results, query) {
  DOM.manualSearchResults.innerHTML = "";
  const normalized = normalizePhone(query);

  if (normalized) {
    const directCard = document.createElement("div");
    directCard.className = "search-result-card";
    directCard.innerHTML = `
      <div class="search-result-main">
        <div class="search-result-name">Use phone directly</div>
        <div class="search-result-meta">${normalized}</div>
      </div>
      <button class="search-result-action" type="button">Load Thread</button>
    `;
    directCard.querySelector("button").addEventListener("click", () => {
      activateManualContext({
        id    : null,
        name  : `Manual Lookup ${normalized}`,
        phone : normalized,
        module: "Contacts",
      });
    });
    DOM.manualSearchResults.appendChild(directCard);
  }

  results.forEach(result => {
    const card = document.createElement("div");
    card.className = "search-result-card";
    card.innerHTML = `
      <div class="search-result-main">
        <div class="search-result-name">${escapeHtml(result.name)}</div>
        <div class="search-result-meta">${escapeHtml(result.module)} · ${escapeHtml(result.phone)}</div>
      </div>
      <button class="search-result-action" type="button">Open</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      activateManualContext(result);
    });
    DOM.manualSearchResults.appendChild(card);
  });
}

async function activateManualContext(result) {
  currentContact = result;
  updateUI();
  DOM.loadingState.classList.remove("hidden");
  DOM.emptyState.classList.add("hidden");
  if (DOM.manualSearchResults) DOM.manualSearchResults.innerHTML = "";
  
  await fetchMessages(false);
  startAutoRefresh();
  showStatus(`Loaded ${currentContact.name}`, "success", 2500);
}

DOM.manualSearchBtn.addEventListener("click", async () => {
  const query = DOM.manualSearchInput.value.trim();
  if (!query) return;
  
  showStatus("Searching...", "info", 0);
  const results = await searchCRMRecords(query);
  renderManualSearchResults(results, query);
  showStatus(results.length > 0 ? "Search complete" : "No results found", "info", 2000);
});
