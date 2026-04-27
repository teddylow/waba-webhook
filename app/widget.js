/**
 * ============================================================
 *  Zoho CRM Widget — WhatsApp Integration
 *  widget.js — Main application logic
 * ============================================================
 *
 *  This script runs inside the Zoho CRM Widget iframe.
 *  It communicates with the Catalyst webhook backend to:
 *    - Display WhatsApp conversation history for the open Contact
 *    - Send outbound WhatsApp messages
 *    - Log conversations as CRM Notes
 *    - Show quick-reply templates
 * ============================================================
 */

"use strict";

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
const DEFAULT_BACKEND_URL = "https://waba-10123192285.development.catalystappsail.com";

// Auto-refresh interval for incoming messages (milliseconds)
const REFRESH_INTERVAL_MS = 15000; // 15 seconds

// ─── EDUCATION COUNSELLOR QUICK-REPLY TEMPLATES ───────────────────────────────
const TEMPLATES = [
  {
    name: "welcome_student",
    label: "Welcome Student",
    body: "Hello! Thank you for reaching out to us. I'm Teddy, your Education Counsellor. I'm here to help you with your education roadmap and university applications. How can I assist you today?",
    lang: "en_US",
  },
  {
    name: "visa_inquiry",
    label: "Visa Inquiry Follow-up",
    body: "Hi! Following up on your visa inquiry. We specialise in student and visitor visas for the UK, Australia, New Zealand, Canada, and the USA. Please let me know which destination you are interested in and I will guide you through the process.",
    lang: "en_US",
  },
  {
    name: "document_checklist",
    label: "Document Checklist Request",
    body: "Thank you for your interest! To proceed with your application, could you please prepare the following documents:\n1. Valid passport (min. 6 months validity)\n2. Academic transcripts\n3. English proficiency test results (IELTS/TOEFL)\n4. Bank statements (last 3 months)\n5. Passport-size photographs\n\nFeel free to ask if you need clarification on any item.",
    lang: "en_US",
  },
  {
    name: "appointment_reminder",
    label: "Appointment Reminder",
    body: "This is a friendly reminder about your counselling appointment scheduled with us. Please ensure you bring all relevant documents. If you need to reschedule, kindly let us know at least 24 hours in advance. Looking forward to meeting you!",
    lang: "en_US",
  },
  {
    name: "application_update",
    label: "Application Status Update",
    body: "Hi! I have an update regarding your university application. Please reply to this message or call us at your earliest convenience so we can discuss the next steps together.",
    lang: "en_US",
  },
  {
    name: "offer_letter_received",
    label: "Offer Letter Received",
    body: "Great news! Your offer letter has been received. Congratulations! Please contact us to discuss the next steps, including visa application, accommodation, and pre-departure preparation.",
    lang: "en_US",
  },
];

// ─── STATE ────────────────────────────────────────────────────────────────────
let currentContact = {
  id    : null,
  name  : "",
  phone : "",
  module: "Contacts",
};

let messages        = [];
let refreshTimer    = null;
let lastMessageTime = null;
let pageLoadContext = null;

// ─── DOM REFERENCES ───────────────────────────────────────────────────────────
const DOM = {
  contactName   : document.getElementById("contact-name"),
  contactPhone  : document.getElementById("contact-phone"),
  messagesArea  : document.getElementById("messages-area"),
  loadingState  : document.getElementById("loading-state"),
  emptyState    : document.getElementById("empty-state"),
  messageInput  : document.getElementById("message-input"),
  sendBtn       : document.getElementById("send-btn"),
  statusBar     : document.getElementById("status-bar"),
  statusText    : document.getElementById("status-text"),
  signalPanel   : document.getElementById("signal-panel"),
  signalTime    : document.getElementById("signal-time"),
  signalSubject : document.getElementById("signal-subject"),
  signalMessage : document.getElementById("signal-message"),
  signalMeta    : document.getElementById("signal-meta"),
  btnRefresh    : document.getElementById("btn-refresh"),
  btnLogNote    : document.getElementById("btn-log-note"),
  chatPanel     : document.getElementById("chat-panel"),
  notesPanel    : document.getElementById("notes-panel"),
  templatePanel : document.getElementById("template-panel"),
  notesList     : document.getElementById("notes-list"),
  notesLoading  : document.getElementById("notes-loading"),
  templatesList : document.getElementById("templates-list"),
  tabs          : document.querySelectorAll(".tab-btn"),
  manualSearchInput  : document.getElementById("manual-search-input"),
  manualSearchBtn    : document.getElementById("manual-search-btn"),
  manualSearchHint   : document.getElementById("manual-search-hint"),
  manualSearchResults: document.getElementById("manual-search-results"),
};

// ─── UTILITY FUNCTIONS ────────────────────────────────────────────────────────

function showStatus(message, type = "info", duration = 3000) {
  DOM.statusBar.className = `show ${type}`;
  DOM.statusText.textContent = message;
  if (duration > 0) {
    setTimeout(() => { DOM.statusBar.className = ""; }, duration);
  }
}

function resolveBackendUrl() {
  const runtimeConfig = window.WABA_CONFIG || {};
  const params = new URLSearchParams(window.location.search);
  const configured = (
    runtimeConfig.backendUrl ||
    params.get("backend_url") ||
    readBackendUrlFromStorage() ||
    DEFAULT_BACKEND_URL ||
    window.location.origin
  ).trim();

  return configured.replace(/\/+$/, "");
}

function readBackendUrlFromStorage() {
  try {
    return window.localStorage.getItem("waba_backend_url") || "";
  } catch {
    return "";
  }
}

function buildApiUrl(pathname) {
  return `${resolveBackendUrl()}${pathname}`;
}

function setManualSearchBusy(isBusy) {
  if (DOM.manualSearchBtn) DOM.manualSearchBtn.disabled = isBusy;
  if (DOM.manualSearchInput) DOM.manualSearchInput.disabled = isBusy;
}

function setManualSearchHint(message) {
  if (DOM.manualSearchHint) {
    DOM.manualSearchHint.textContent = message;
  }
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d]/g, "").replace(/^00/, "");
}

function firstNonEmpty(values) {
  return values.find(value => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function isSignalPayload(payload) {
  return Boolean(payload && (payload.data || payload.record || payload.signal));
}

function getRecordContextFromPayload(payload) {
  if (!payload || isSignalPayload(payload)) {
    return null;
  }

  const candidate = payload.record || payload;
  const entityId = firstNonEmpty([
    candidate.EntityId,
    candidate.entityId,
    candidate.RecordID,
    candidate.recordId,
    candidate.id,
    payload.EntityId,
    payload.entityId,
    payload.RecordID,
    payload.recordId,
    payload.id,
  ]);

  const entity = firstNonEmpty([
    candidate.Entity,
    candidate.entity,
    candidate.Module,
    candidate.module,
    payload.Entity,
    payload.entity,
    payload.Module,
    payload.module,
  ]);

  if (!entityId) {
    return null;
  }

  return {
    Entity: entity || "Contacts",
    EntityId: entityId,
  };
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

function renderManualSearchResults(results, query) {
  if (!DOM.manualSearchResults) return;

  DOM.manualSearchResults.innerHTML = "";
  const normalized = normalizePhone(query);
  const entries = Array.isArray(results) ? results : [];

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

  entries.forEach(result => {
    const card = document.createElement("div");
    card.className = "search-result-card";
    card.innerHTML = `
      <div class="search-result-main">
        <div class="search-result-name">${escapeHtml(result.name || "Unnamed record")}</div>
        <div class="search-result-meta">${escapeHtml(result.module || "CRM")} · ${escapeHtml(result.phone || "No phone")}</div>
      </div>
      <button class="search-result-action" type="button">Open</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      activateManualContext(result);
    });
    DOM.manualSearchResults.appendChild(card);
  });

  if (!normalized && entries.length === 0) {
    setManualSearchHint("No matching Contacts or Leads found. Try a phone number for direct lookup.");
  }
}

async function searchModuleByCriteria(moduleName, criteriaList) {
  const matches = [];

  for (const criteria of criteriaList) {
    try {
      const response = await ZOHO.CRM.API.searchRecord({
        Entity: moduleName,
        Type  : "criteria",
        Query : criteria,
      });
      const rows = Array.isArray(response?.data) ? response.data : [];
      rows.forEach(row => matches.push(row));
    } catch (err) {
      // Ignore per-criteria failures and keep searching.
    }
  }

  return matches;
}

function mapSearchRecord(moduleName, row) {
  return {
    id    : row.id,
    module: moduleName,
    name  : row.Full_Name || `${row.First_Name || ""} ${row.Last_Name || ""}`.trim() || row.Company || "Unnamed record",
    phone : normalizePhone(row.Mobile || row.Phone || row.Other_Phone || ""),
  };
}

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
    const rows = await searchModuleByCriteria(moduleName, criteriaList);
    rows.forEach(row => results.push(mapSearchRecord(moduleName, row)));
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

async function activateManualContext(result) {
  currentContact = {
    id    : result.id || null,
    name  : result.name || "Manual Lookup",
    phone : result.phone || "",
    module: result.module || "Contacts",
  };

  DOM.contactName.textContent = currentContact.name || "Manual Lookup";
  DOM.contactPhone.textContent = currentContact.phone || "No phone number";
  DOM.sendBtn.disabled = !currentContact.phone;
  DOM.messageInput.placeholder = currentContact.phone
    ? "Type a reply to the contact..."
    : "No phone number available";
  DOM.loadingState.classList.remove("hidden");
  DOM.emptyState.classList.add("hidden");
  setManualSearchHint("In a CRM web tab, search by phone or name to load a conversation manually.");
  if (DOM.manualSearchResults) DOM.manualSearchResults.innerHTML = "";

  await fetchMessages(false);
  renderTemplates();
  startAutoRefresh();
  showStatus(`Loaded ${currentContact.name}`, "success", 2500);
}

async function handleManualSearch() {
  const query = DOM.manualSearchInput ? DOM.manualSearchInput.value.trim() : "";
  if (!query) {
    setManualSearchHint("Enter a phone number or CRM contact name to search.");
    return;
  }

  setManualSearchBusy(true);
  setManualSearchHint("Searching Contacts and Leads...");

  try {
    const results = await searchCRMRecords(query);
    renderManualSearchResults(results, query);
    if (results.length > 0) {
      setManualSearchHint(`Found ${results.length} CRM record(s).`);
    } else if (normalizePhone(query)) {
      setManualSearchHint("No CRM record matched. You can still open the thread directly by phone.");
    }
  } catch (err) {
    console.error("[Widget] Manual search error:", err);
    setManualSearchHint("Search failed. Check CRM permissions and try again.");
  } finally {
    setManualSearchBusy(false);
  }
}

function autoResizeTextarea(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 100) + "px";
}

// ─── RENDER MESSAGES ──────────────────────────────────────────────────────────

function renderMessages(msgs) {
  // Remove loading and empty states
  DOM.loadingState.classList.add("hidden");
  DOM.emptyState.classList.add("hidden");

  // Clear existing messages
  const existingMsgs = DOM.messagesArea.querySelectorAll(".msg-wrapper, .date-separator");
  existingMsgs.forEach(el => el.remove());

  if (!msgs || msgs.length === 0) {
    DOM.emptyState.classList.remove("hidden");
    return;
  }

  // Reverse to show oldest first (API returns newest first)
  const sorted = [...msgs].reverse();

  let lastDate = null;

  sorted.forEach(msg => {
    const msgDate = formatDate(msg.timestamp);

    // Date separator
    if (msgDate !== lastDate) {
      const sep = document.createElement("div");
      sep.className = "date-separator";
      sep.innerHTML = `<span>${msgDate}</span>`;
      DOM.messagesArea.appendChild(sep);
      lastDate = msgDate;
    }

    // Message wrapper
    const wrapper = document.createElement("div");
    wrapper.className = `msg-wrapper ${msg.direction}`;
    wrapper.dataset.msgId = msg.id;

    // Sender name (only for inbound)
    if (msg.direction === "inbound" && msg.senderName && msg.senderName !== msg.from) {
      const sender = document.createElement("div");
      sender.className = "msg-sender";
      sender.textContent = msg.senderName;
      wrapper.appendChild(sender);
    }

    // Bubble
    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    // Type badge for non-text messages
    if (msg.type && msg.type !== "text") {
      const badge = document.createElement("span");
      badge.className = "msg-type-badge";
      badge.textContent = msg.type.toUpperCase();
      bubble.appendChild(badge);
      bubble.appendChild(document.createElement("br"));
    }

    // Message text
    const textNode = document.createTextNode(msg.text || "");
    bubble.appendChild(textNode);

    // Meta (time + status)
    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = formatTime(msg.timestamp);

    // Tick marks for outbound
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

  // Scroll to bottom
  DOM.messagesArea.scrollTop = DOM.messagesArea.scrollHeight;
}

// ─── FETCH MESSAGES ───────────────────────────────────────────────────────────

async function fetchMessages(silent = false) {
  if (!currentContact.phone) return;

  if (!silent) {
    DOM.loadingState.classList.remove("hidden");
  }

  try {
    const phone = normalizePhone(currentContact.phone);
    const resp  = await fetch(buildApiUrl(`/api/messages?phone=${encodeURIComponent(phone)}&limit=50`));

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    messages = data.messages || [];
    renderMessages(messages);

    if (!silent) showStatus(`${messages.length} message(s) loaded`, "success", 2000);
  } catch (err) {
    console.error("[Widget] Fetch messages error:", err);
    DOM.loadingState.classList.add("hidden");
    if (!silent) showStatus("Failed to load messages. Check backend connection.", "error", 5000);
  }
}

// ─── SEND MESSAGE ─────────────────────────────────────────────────────────────

async function sendMessage() {
  const text = DOM.messageInput.value.trim();
  if (!text || !currentContact.phone) return;

  DOM.sendBtn.disabled = true;
  showStatus("Sending...", "info", 0);

  try {
    const phone = normalizePhone(currentContact.phone);

    const resp = await fetch(buildApiUrl("/api/send-message"), {
      method : "POST",
      headers: { "Content-Type": "application/json" },
      body   : JSON.stringify({
        phone      : phone,
        message    : text,
        contactId  : currentContact.id,
        contactName: currentContact.name,
      }),
    });

    const data = await resp.json();

    if (data.success) {
      DOM.messageInput.value = "";
      autoResizeTextarea(DOM.messageInput);
      showStatus("Message sent successfully ✓", "success", 3000);

      // Add optimistic message to UI
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

// ─── LOG FULL CONVERSATION AS NOTE ───────────────────────────────────────────

async function logConversationAsNote() {
  if (!currentContact.id || messages.length === 0) {
    showStatus("No messages to log.", "info", 3000);
    return;
  }

  showStatus("Logging conversation as Note...", "info", 0);

  try {
    // Build conversation transcript
    const sorted = [...messages].reverse();
    let transcript = `WhatsApp Conversation Log\n`;
    transcript += `Contact: ${currentContact.name} (${currentContact.phone})\n`;
    transcript += `Exported: ${new Date().toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}\n`;
    transcript += `${"─".repeat(50)}\n\n`;

    sorted.forEach(msg => {
      const time      = formatTime(msg.timestamp);
      const direction = msg.direction === "inbound" ? `← ${msg.senderName || currentContact.name}` : "→ Me";
      transcript += `[${time}] ${direction}:\n${msg.text}\n\n`;
    });

    // Use Zoho CRM Widget SDK to create the note
    await ZOHO.CRM.API.addNotes({
      Entity   : currentContact.module || "Contacts",
      RecordID : currentContact.id,
      Title    : `WhatsApp Log — ${currentContact.name} — ${new Date().toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}`,
      Content  : transcript,
    });

    showStatus("Conversation logged as Note ✓", "success", 3000);
  } catch (err) {
    console.error("[Widget] Log note error:", err);
    showStatus("Failed to log note. Please try again.", "error", 5000);
  }
}

// ─── FETCH CRM NOTES ──────────────────────────────────────────────────────────

async function fetchCRMNotes() {
  if (!currentContact.id) return;

  DOM.notesLoading.classList.remove("hidden");
  DOM.notesList.innerHTML = "";

  try {
    const data = await ZOHO.CRM.API.getRelatedRecords({
      Entity        : currentContact.module || "Contacts",
      RecordID      : currentContact.id,
      RelatedList   : "Notes",
      page          : 1,
      per_page      : 20,
    });

    DOM.notesLoading.classList.add("hidden");

    const notes = data?.data || [];

    // Filter only WhatsApp-related notes
    const waNotes = notes.filter(n =>
      n.Note_Title?.includes("WhatsApp") || n.Note_Content?.includes("WhatsApp")
    );

    if (waNotes.length === 0) {
      DOM.notesList.innerHTML = `<p style="color:#888; font-size:13px; text-align:center; padding:20px;">No WhatsApp notes found for this contact.</p>`;
      return;
    }

    waNotes.forEach(note => {
      const card = document.createElement("div");
      card.className = "note-card";
      card.innerHTML = `
        <div class="note-title">${escapeHtml(note.Note_Title || "Note")}</div>
        <div class="note-content">${escapeHtml(note.Note_Content || "")}</div>
        <div class="note-time">${note.Created_Time ? new Date(note.Created_Time).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" }) : ""}</div>
      `;
      DOM.notesList.appendChild(card);
    });
  } catch (err) {
    console.error("[Widget] Fetch notes error:", err);
    DOM.notesLoading.classList.add("hidden");
    DOM.notesList.innerHTML = `<p style="color:#c00; font-size:13px; text-align:center; padding:20px;">Failed to load notes.</p>`;
  }
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

// ─── RENDER TEMPLATES ─────────────────────────────────────────────────────────

function renderTemplates() {
  DOM.templatesList.innerHTML = "";

  TEMPLATES.forEach(tpl => {
    const card = document.createElement("div");
    card.className = "template-card";
    card.innerHTML = `
      <div class="tpl-name">${escapeHtml(tpl.label)}</div>
      <div class="tpl-body">${escapeHtml(tpl.body.substring(0, 120))}${tpl.body.length > 120 ? "…" : ""}</div>
      <div class="tpl-lang">Language: ${tpl.lang}</div>
    `;
    card.addEventListener("click", () => {
      // Switch to chat tab and pre-fill message
      switchTab("chat");
      DOM.messageInput.value = tpl.body;
      autoResizeTextarea(DOM.messageInput);
      DOM.messageInput.focus();
    });
    DOM.templatesList.appendChild(card);
  });
}

// ─── TAB SWITCHING ────────────────────────────────────────────────────────────

function switchTab(tabName) {
  DOM.tabs.forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });

  DOM.chatPanel.style.display     = tabName === "chat"      ? "flex"  : "none";
  DOM.notesPanel.style.display    = tabName === "notes"     ? "block" : "none";
  DOM.templatePanel.style.display = tabName === "templates" ? "block" : "none";

  if (tabName === "notes") fetchCRMNotes();
}

// ─── AUTO-REFRESH ─────────────────────────────────────────────────────────────

function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(() => {
    fetchMessages(true); // silent refresh
  }, REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ─── INITIALIZE WIDGET ────────────────────────────────────────────────────────

async function initWidget() {
  try {
    if (!resolveBackendUrl()) {
      showStatus("Backend URL is not configured.", "error", 0);
      DOM.loadingState.classList.add("hidden");
      return;
    }

    ZOHO.embeddedApp.on("PageLoad", (payload) => {
      pageLoadContext = payload;
    });

    // Initialize Zoho CRM Widget SDK
    await ZOHO.embeddedApp.init();

    if (isSignalPayload(pageLoadContext)) {
      const signalContext = createSignalContext(pageLoadContext);
      renderSignalPanel(signalContext);

      currentContact = {
        id    : signalContext.recordId || null,
        name  : signalContext.senderName || "Signal Contact",
        phone : signalContext.phone || "",
        module: signalContext.moduleName || "Contacts",
      };

    } else {
      // Get current CRM record (default record-page widget flow)
      let entity = getRecordContextFromPayload(pageLoadContext);
      try {
        if (!entity) {
          entity = await ZOHO.CRM.CONFIG.getEntity();
        }
      } catch (entityErr) {
        entity = entity || null;
      }
      const moduleName = entity?.Entity || "Contacts";

      if (!entity || !entity.EntityId) {
        currentContact = {
          id    : null,
          name  : "WhatsApp Control Desk",
          phone : "",
          module: moduleName,
        };

        DOM.contactName.textContent = currentContact.name;
        DOM.contactPhone.textContent = "Open from a CRM record or signal";
        DOM.messageInput.placeholder = "No CRM record context available";
        DOM.sendBtn.disabled = true;
        DOM.loadingState.classList.add("hidden");
        DOM.emptyState.classList.remove("hidden");
        showStatus("Open this widget from a Contact, Lead, or CRM signal to load a conversation.", "error", 0);
        renderTemplates();
        renderManualSearchResults([], "");
        return;
      }

      const record = await ZOHO.CRM.API.getRecord({
        Entity  : moduleName,
        RecordID: entity.EntityId,
      });

      if (!record?.data?.[0]) {
        showStatus("Could not load CRM record.", "error", 0);
        return;
      }

      const contact = record.data[0];

      currentContact = {
        id    : entity.EntityId,
        name  : contact.Full_Name || `${contact.First_Name || ""} ${contact.Last_Name || ""}`.trim(),
        phone : normalizePhone(contact.Mobile || contact.Phone || contact.Other_Phone || ""),
        module: moduleName,
      };
    }

    // Update header
    DOM.contactName.textContent  = currentContact.name  || "Unknown Contact";
    DOM.contactPhone.textContent = currentContact.phone || "No phone number";

    if (!currentContact.phone) {
      showStatus(
        pageLoadContext && isSignalPayload(pageLoadContext)
          ? "Signal received, but no phone number was included."
          : "No phone number found on this CRM record.",
        "error",
        0
      );
      DOM.sendBtn.disabled = true;
      DOM.messageInput.placeholder = "No phone number available";
      DOM.loadingState.classList.add("hidden");
      DOM.emptyState.classList.remove("hidden");
      renderTemplates();
      return;
    }

    // Load messages and templates
    await fetchMessages();
    renderTemplates();
    startAutoRefresh();

    if (pageLoadContext && isSignalPayload(pageLoadContext)) {
      showStatus("Signal update received. Conversation refreshed.", "success", 2500);
    }

  } catch (err) {
    console.error("[Widget] Init error:", err);
    showStatus("Widget initialization failed. Please reload.", "error", 0);
    DOM.loadingState.classList.add("hidden");
  }
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────────────────

// Send button
DOM.sendBtn.addEventListener("click", sendMessage);

// Enter key to send (Shift+Enter for new line)
DOM.messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
DOM.messageInput.addEventListener("input", () => {
  autoResizeTextarea(DOM.messageInput);
});

// Refresh button
DOM.btnRefresh.addEventListener("click", () => {
  fetchMessages(false);
});

if (DOM.manualSearchBtn) {
  DOM.manualSearchBtn.addEventListener("click", handleManualSearch);
}

if (DOM.manualSearchInput) {
  DOM.manualSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleManualSearch();
    }
  });
}

// Log note button
DOM.btnLogNote.addEventListener("click", logConversationAsNote);

// Tab switching
DOM.tabs.forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// ─── BOOT ─────────────────────────────────────────────────────────────────────

// Wait for DOM and SDK to be ready
document.addEventListener("DOMContentLoaded", () => {
  // Ensure chat panel is shown by default
  DOM.chatPanel.style.display     = "flex";
  DOM.notesPanel.style.display    = "none";
  DOM.templatePanel.style.display = "none";

  initWidget();
});

// Cleanup on page unload
window.addEventListener("beforeunload", stopAutoRefresh);
