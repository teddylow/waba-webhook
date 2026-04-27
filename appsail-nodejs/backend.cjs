const fs = require("fs");
const path = require("path");
const https = require("https");
const express = require("express");

const PHONE_INDEX_CACHE_TTL_MS = Number(process.env.ZOHO_PHONE_INDEX_CACHE_TTL_MS || 5 * 60 * 1000);
const PHONE_INDEX_MAX_RECORDS = Number(process.env.ZOHO_PHONE_INDEX_MAX_RECORDS || 5000);
let phoneIndexCache = {
  expiresAt: 0,
  index: null,
};

function createBackendRouter(options = {}) {
  const router = express.Router();
  const storagePath =
    options.storagePath || path.join(__dirname, "data", "messages.json");
  const graphApiVersion = options.graphApiVersion || process.env.WA_GRAPH_API_VERSION || "v25.0";

  router.use((req, res, next) => {
    const origin = req.headers.origin || "*";
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next();
  });
  router.use(express.json({ limit: "1mb" }));
  router.use(express.urlencoded({ extended: false }));

  router.get("/health", (req, res) => {
    const outboundConfig = getOutboundSendConfig(graphApiVersion);
    res.json({
      ok: true,
      storagePath,
      config: {
        verifyTokenConfigured: Boolean(process.env.WA_VERIFY_TOKEN),
        phoneNumberIdConfigured: Boolean(process.env.WA_PHONE_NUMBER_ID),
        accessTokenConfigured: Boolean(process.env.WA_ACCESS_TOKEN),
        d360ApiKeyConfigured: Boolean(process.env.D360_API_KEY),
        d360BaseUrlConfigured: Boolean(process.env.D360_BASE_URL),
        zohoSignalNamespaceConfigured: Boolean(process.env.ZOHO_CRM_SIGNAL_NAMESPACE),
        zohoSignalActionUrlConfigured: Boolean(process.env.ZOHO_CRM_SIGNAL_ACTION_URL),
        zohoOAuthConfigured: hasZohoOAuthConfig(),
        outboundProviderMode: (process.env.WHATSAPP_OUTBOUND_PROVIDER || "auto").toLowerCase(),
        outboundProviderSelected: outboundConfig.provider || null,
        outboundProviderEnabled: Boolean(outboundConfig.enabled),
        outboundProviderReason: outboundConfig.reason || null,
      },
    });
  });

  router.get("/api/debug/zoho-signal", async (req, res) => {
    try {
      const signalConfig = getSignalConfig();
      const signals = await getZohoSignals();
      const namespace = process.env.ZOHO_CRM_SIGNAL_NAMESPACE || "";
      const matched = signals.find((signal) => signal.namespace === namespace) || null;

      res.json({
        ok: true,
        configured: signalConfig,
        namespace,
        signalFound: Boolean(matched),
        matchedSignal: matched
          ? {
              id: matched.id,
              namespace: matched.namespace,
              display_label: matched.display_label,
              enabled: matched.enabled,
              chat_enabled: matched.chat_enabled,
              extension: matched.extension || null,
            }
          : null,
        signalCount: signals.length,
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message,
        details: error.details || null,
      });
    }
  });

  router.post("/api/debug/test-signal", async (req, res) => {
    try {
      const signalConfig = getSignalConfig();
      if (!signalConfig.enabled) {
        res.status(400).json({
          ok: false,
          error: signalConfig.reason,
        });
        return;
      }

      const recordId = String(req.body.record_id || req.body.id || "").trim();
      const moduleName = String(req.body.module || "Contacts").trim();

      if (!recordId) {
        res.status(400).json({
          ok: false,
          error: "record_id is required",
        });
        return;
      }

      const payload = buildZohoSignalPayload(
        {
          id: `manual_test_${Date.now()}`,
          phone: normalizePhone(req.body.phone || ""),
          senderName: req.body.sender_name || "Manual Test",
          text: req.body.message || "Manual signal test from WABA backend",
          type: "text",
          timestamp: new Date().toISOString(),
        },
        {
          id: recordId,
          module: moduleName,
          name: req.body.record_name || `${moduleName} ${recordId}`,
          email: req.body.email || "",
          phone: normalizePhone(req.body.phone || ""),
        },
        signalConfig
      );

      const response = await raiseZohoSignal(payload);
      res.json({
        ok: true,
        payload,
        response,
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message,
        details: error.details || null,
      });
    }
  });

  router.get("/api/debug/find-record", async (req, res) => {
    try {
      const phone = normalizePhone(req.query.phone || "");
      if (!phone) {
        res.status(400).json({
          ok: false,
          error: "phone query parameter is required",
        });
        return;
      }

      const record = await safeFindZohoRecordByPhone(phone);
      res.json({
        ok: true,
        phone,
        record: record || null,
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message,
        details: error.details || null,
      });
    }
  });

  router.get("/api/debug/sample-records", async (req, res) => {
    try {
      const moduleName = String(req.query.module || "Contacts").trim();
      const limit = Math.max(1, Math.min(20, Number(req.query.limit || 5)));
      const tokenInfo = await getZohoAccessToken();
      const fields = moduleName === "Leads"
        ? ["id", "Full_Name", "First_Name", "Last_Name", "Phone", "Mobile", "Email"]
        : ["id", "Full_Name", "First_Name", "Last_Name", "Phone", "Mobile", "Other_Phone", "Email"];

      const response = await requestZohoModulePage(moduleName, fields, 1, limit, tokenInfo);
      const rows = Array.isArray(response?.data) ? response.data : [];

      res.json({
        ok: true,
        module: moduleName,
        count: rows.length,
        records: rows.map((row) => ({
          id: row.id,
          name: row.Full_Name || `${row.First_Name || ""} ${row.Last_Name || ""}`.trim(),
          phone: row.Phone || "",
          mobile: row.Mobile || "",
          other_phone: row.Other_Phone || "",
          normalized: {
            phone: normalizePhone(row.Phone || ""),
            mobile: normalizePhone(row.Mobile || ""),
            other_phone: normalizePhone(row.Other_Phone || ""),
          },
        })),
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({
        ok: false,
        error: error.message,
        details: error.details || null,
      });
    }
  });

  router.get("/api/messages", (req, res) => {
    const phone = normalizePhone(req.query.phone || "");
    const limit = clampLimit(req.query.limit);
    const store = readStore(storagePath);

    const messages = store.messages
      .filter((message) => !phone || message.phone === phone)
      .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
      .slice(0, limit)
      .map(toClientMessage);

    res.json({ messages });
  });

  router.post("/api/send-message", async (req, res) => {
    try {
      const phone = normalizePhone(req.body.phone);
      const text = typeof req.body.message === "string" ? req.body.message.trim() : "";

      console.log(`[Outbound] Attempting to send message to ${phone}`);

      if (!phone || !text) {
        res.status(400).json({ success: false, error: "phone and message are required" });
        return;
      }

      const payload = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone,
        type: "text",
        text: {
          body: text,
        },
      };

      const sendConfig = getOutboundSendConfig(graphApiVersion);
      if (!sendConfig.enabled) {
        console.error(`[Outbound] Provider not enabled: ${sendConfig.reason}`);
        res.status(500).json({
          success: false,
          error: sendConfig.reason,
        });
        return;
      }

      console.log(`[Outbound] Using provider: ${sendConfig.provider} at ${sendConfig.url}`);
      const responseBody = await postJson(sendConfig.url, payload, sendConfig.headers);
      console.log(`[Outbound] Provider response:`, JSON.stringify(responseBody));

      const messageId = responseBody.messages && responseBody.messages[0] && responseBody.messages[0].id;
      const timestamp = new Date().toISOString();

      const savedMessage = {
        id: messageId || createLocalMessageId(),
        metaMessageId: messageId || null,
        phone,
        from: process.env.WA_PHONE_NUMBER_ID || "360dialog",
        to: phone,
        text,
        type: "text",
        direction: "outbound",
        timestamp,
        status: "sent",
        contactId: req.body.contactId || null,
        contactName: req.body.contactName || "",
      };

      appendMessages(storagePath, [savedMessage]);

      res.json({
        success: true,
        messageId: savedMessage.id,
        timestamp,
        meta: responseBody,
      });
    } catch (error) {
      console.error(`[Outbound] Error: ${error.message}`, error.details || "");
      res.status(error.statusCode || 502).json({
        success: false,
        error: error.message || "Failed to send WhatsApp message",
        details: error.details || null,
      });
    }
  });

  router.get("/webhook/whatsapp", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const verifyToken = process.env.WA_VERIFY_TOKEN || "121212";

    if (mode === "subscribe" && token === verifyToken) {
      res.status(200).send(challenge);
      return;
    }

    res.status(403).send("Forbidden");
  });

  router.post("/webhook/whatsapp", async (req, res) => {
    try {
      console.log("[Webhook] Received payload:", JSON.stringify(req.body));
      const incoming = extractWebhookMessages(req.body, process.env.WA_PHONE_NUMBER_ID);
      const statuses = extractWebhookStatuses(req.body);

      if (incoming.length > 0) {
        console.log(`[Webhook] Extracted ${incoming.length} incoming messages`);
        appendMessages(storagePath, incoming);
        await Promise.allSettled(
          incoming.map((message) => enrichAndRaiseSignalForMessage(message, storagePath))
        );
      }

      if (statuses.length > 0) {
        console.log(`[Webhook] Extracted ${statuses.length} status updates`);
        updateMessageStatuses(storagePath, statuses);
      }

      res.status(200).send("EVENT_RECEIVED");
    } catch (error) {
      console.error("[Webhook] Error processing payload:", error.message);
      res.status(500).json({
        error: "Failed to process webhook payload",
        message: error.message,
      });
    }
  });

  return router;
}

function clampLimit(rawLimit) {
  const parsed = Number(rawLimit || 50);
  if (!Number.isFinite(parsed)) {
    return 50;
  }

  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  if (digits.startsWith("00")) {
    return digits.slice(2);
  }

  return digits;
}

function readStore(storagePath) {
  ensureStore(storagePath);
  const raw = fs.readFileSync(storagePath, "utf8");

  try {
    const parsed = JSON.parse(raw);
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch (error) {
    return { messages: [] };
  }
}

function writeStore(storagePath, store) {
  ensureStore(storagePath);
  fs.writeFileSync(storagePath, JSON.stringify(store, null, 2));
}

function ensureStore(storagePath) {
  const directory = path.dirname(storagePath);
  fs.mkdirSync(directory, { recursive: true });

  if (!fs.existsSync(storagePath)) {
    fs.writeFileSync(storagePath, JSON.stringify({ messages: [] }, null, 2));
  }
}

function appendMessages(storagePath, incomingMessages) {
  if (!incomingMessages.length) {
    return;
  }

  const store = readStore(storagePath);
  const messages = [...store.messages];

  for (const message of incomingMessages) {
    const exists = messages.some(
      (item) =>
        (message.metaMessageId && item.metaMessageId === message.metaMessageId) ||
        item.id === message.id
    );

    if (!exists) {
      messages.push(message);
    }
  }

  writeStore(storagePath, { messages });
}

function patchStoredMessage(storagePath, messageId, patch) {
  if (!messageId || !patch || typeof patch !== "object") {
    return;
  }

  const store = readStore(storagePath);
  const message = store.messages.find((item) => item.id === messageId);
  if (!message) {
    return;
  }

  Object.assign(message, patch);
  writeStore(storagePath, store);
}

function getStoredMessage(storagePath, messageId) {
  if (!messageId) {
    return null;
  }

  const store = readStore(storagePath);
  return store.messages.find((item) => item.id === messageId) || null;
}

function updateMessageStatuses(storagePath, statuses) {
  if (!statuses.length) {
    return;
  }

  const store = readStore(storagePath);
  let changed = false;

  for (const status of statuses) {
    const message = store.messages.find(
      (item) => item.metaMessageId === status.metaMessageId || item.id === status.metaMessageId
    );

    if (!message) {
      continue;
    }

    if (status.status) {
      message.status = status.status;
      changed = true;
    }

    if (status.timestamp) {
      message.statusTimestamp = status.timestamp;
      changed = true;
    }
  }

  if (changed) {
    writeStore(storagePath, store);
  }
}

function extractWebhookMessages(payload, businessPhoneId) {
  const results = [];
  const values = getWebhookValueObjects(payload);

  for (const value of values) {
    const contacts = Array.isArray(value.contacts) ? value.contacts : [];
    const contactMap = new Map();

    for (const contact of contacts) {
      contactMap.set(contact.wa_id, contact.profile && contact.profile.name ? contact.profile.name : "");
    }

    const messages = Array.isArray(value.messages) ? value.messages : [];
    for (const message of messages) {
      const phone = normalizePhone(message.from);
      const textBody = getWebhookText(message);
      results.push({
        id: createLocalMessageId(message.id),
        metaMessageId: message.id || null,
        phone,
        from: phone,
        to: businessPhoneId || value.metadata && value.metadata.phone_number_id || "",
        text: textBody,
        type: message.type || "text",
        direction: "inbound",
        timestamp: timestampToIso(message.timestamp),
        status: "received",
        senderName: contactMap.get(message.from) || "",
        crmSignal: {
          attempted: false,
          triggered: false,
        },
        raw: message,
      });
    }
  }

  return results;
}

function extractWebhookStatuses(payload) {
  const results = [];

  const values = getWebhookValueObjects(payload);
  for (const value of values) {
    const statuses = Array.isArray(value.statuses) ? value.statuses : [];

    for (const status of statuses) {
      results.push({
        metaMessageId: status.id,
        status: status.status || "",
        timestamp: timestampToIso(status.timestamp),
      });
    }
  }

  return results;
}

function getWebhookValueObjects(payload) {
  const values = [];

  if (payload && Array.isArray(payload.entry)) {
    payload.entry.forEach((entry) => {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      changes.forEach((change) => {
        if (change && change.value && typeof change.value === "object") {
          values.push(change.value);
        }
      });
    });
  }

  if (payload && payload.value && typeof payload.value === "object") {
    values.push(payload.value);
  }

  if (
    payload &&
    (
      Array.isArray(payload.messages) ||
      Array.isArray(payload.statuses) ||
      Array.isArray(payload.contacts)
    )
  ) {
    values.push(payload);
  }

  return values;
}

function getWebhookText(message) {
  if (message.type === "text" && message.text && typeof message.text.body === "string") {
    return message.text.body;
  }

  if (message.type === "button" && message.button && message.button.text) {
    return message.button.text;
  }

  if (message.type === "interactive" && message.interactive) {
    if (message.interactive.button_reply && message.interactive.button_reply.title) {
      return message.interactive.button_reply.title;
    }

    if (message.interactive.list_reply && message.interactive.list_reply.title) {
      return message.interactive.list_reply.title;
    }
  }

  return `[${message.type || "message"}]`;
}

function timestampToIso(timestamp) {
  if (!timestamp) {
    return new Date().toISOString();
  }

  const numeric = Number(timestamp);
  if (Number.isFinite(numeric)) {
    return new Date(numeric * 1000).toISOString();
  }

  const parsed = new Date(timestamp);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return new Date().toISOString();
}

function createLocalMessageId(seed) {
  if (seed) {
    return `msg_${seed}`;
  }

  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function toClientMessage(message) {
  return {
    id: message.id,
    from: message.from,
    to: message.to,
    text: message.text || "",
    type: message.type || "text",
    direction: message.direction || "inbound",
    timestamp: message.timestamp || new Date().toISOString(),
    status: message.status || "",
    senderName: message.senderName || "",
    contactId: message.contactId || null,
    contactName: message.contactName || "",
    crmModule: message.crmModule || "",
    phone: message.phone || "",
  };
}

async function enrichAndRaiseSignalForMessage(message, storagePath) {
  if (!message || message.direction !== "inbound" || !message.phone) {
    return;
  }

  const existingMessage = getStoredMessage(storagePath, message.id);
  if (existingMessage && existingMessage.crmSignal?.triggered && existingMessage.crmNote?.created) {
    return;
  }

  const signalConfig = getSignalConfig();

  try {
    console.log(`[Signal] Searching Zoho record for phone: ${message.phone}`);
    const record = await findZohoRecordByPhone(message.phone);
    if (!record) {
      console.log(`[Signal] No record found for ${message.phone}`);
      patchStoredMessage(storagePath, message.id, {
        crmSignal: {
          attempted: true,
          triggered: false,
          skipped: "No matching Contact or Lead found by phone",
        },
        crmNote: {
          attempted: false,
          created: false,
          skipped: "No matching Contact or Lead found by phone",
        },
      });
      return;
    }

    console.log(`[Signal] Found record: ${record.module} ${record.id} (${record.name})`);
    const patch = {
      contactId: record.id,
      contactName: record.name,
      crmModule: record.module,
    };

    if (signalConfig.enabled) {
      try {
        const signalPayload = buildZohoSignalPayload(message, record, signalConfig);
        console.log(`[Signal] Raising signal for ${record.id} in namespace ${signalConfig.namespace}`);
        const response = await raiseZohoSignal(signalPayload);
        console.log(`[Signal] Zoho response:`, JSON.stringify(response));
        patch.crmSignal = {
          attempted: true,
          triggered: true,
          signalNamespace: signalConfig.namespace,
          recordId: record.id,
          module: record.module,
          at: new Date().toISOString(),
          response,
        };
      } catch (error) {
        console.error(`[Signal] Error raising signal: ${error.message}`, error.details || "");
        patch.crmSignal = {
          attempted: true,
          triggered: false,
          error: error.message,
          details: error.details || null,
        };
      }
    } else {
      console.log(`[Signal] Signal disabled: ${signalConfig.reason}`);
      patch.crmSignal = {
        attempted: false,
        triggered: false,
        skipped: signalConfig.reason,
      };
    }

    try {
      console.log(`[Note] Creating note for ${record.module} ${record.id}`);
      const noteResponse = await createZohoNoteForMessage(message, record);
      patch.crmNote = {
        attempted: true,
        created: true,
        recordId: record.id,
        module: record.module,
        at: new Date().toISOString(),
        response: noteResponse,
      };
    } catch (error) {
      console.error(`[Note] Error creating note: ${error.message}`, error.details || "");
      patch.crmNote = {
        attempted: true,
        created: false,
        error: error.message,
        details: error.details || null,
      };
    }

    patchStoredMessage(storagePath, message.id, patch);
  } catch (error) {
    console.error(`[Signal/Note] General error: ${error.message}`);
    patchStoredMessage(storagePath, message.id, {
      crmSignal: {
        attempted: true,
        triggered: false,
        error: error.message,
        details: error.details || null,
      },
      crmNote: {
        attempted: true,
        created: false,
        error: error.message,
        details: error.details || null,
      },
    });
  }
}

function getSignalConfig() {
  const namespace = process.env.ZOHO_CRM_SIGNAL_NAMESPACE || "";
  const actionUrl = process.env.ZOHO_CRM_SIGNAL_ACTION_URL || "";

  if (!namespace) {
    return { enabled: false, reason: "ZOHO_CRM_SIGNAL_NAMESPACE is not set" };
  }

  if (!actionUrl) {
    return { enabled: false, reason: "ZOHO_CRM_SIGNAL_ACTION_URL is not set" };
  }

  if (!hasZohoOAuthConfig()) {
    return { enabled: false, reason: "Zoho OAuth env vars are incomplete" };
  }

  return {
    enabled: true,
    namespace,
    actionUrl,
    actionDisplayName: process.env.ZOHO_CRM_SIGNAL_ACTION_DISPLAY_NAME || "Open WhatsApp widget",
    actionOpenIn: process.env.ZOHO_CRM_SIGNAL_ACTION_OPEN_IN || "popup",
  };
}

function getOutboundSendConfig(graphApiVersion) {
  const providerMode = String(process.env.WHATSAPP_OUTBOUND_PROVIDER || "auto").trim().toLowerCase();
  const d360ApiKey = process.env.D360_API_KEY || "";
  const d360BaseUrl = (process.env.D360_BASE_URL || "https://waba-v2.360dialog.io").replace(/\/+$/, "");
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID || "";
  const accessToken = process.env.WA_ACCESS_TOKEN || "";

  if (providerMode === "meta") {
    if (!phoneNumberId || !accessToken) {
      return {
        enabled: false,
        provider: "meta",
        reason: "WHATSAPP_OUTBOUND_PROVIDER=meta but Meta credentials are incomplete",
      };
    }

    return {
      enabled: true,
      provider: "meta",
      url: `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    };
  }

  if (providerMode === "360dialog") {
    if (!d360ApiKey) {
      return {
        enabled: false,
        provider: "360dialog",
        reason: "WHATSAPP_OUTBOUND_PROVIDER=360dialog but D360_API_KEY is missing",
      };
    }

    return {
      enabled: true,
      provider: "360dialog",
      url: `${d360BaseUrl}/messages`,
      headers: {
        "D360-API-KEY": d360ApiKey,
        "Content-Type": "application/json",
      },
    };
  }

  if (d360ApiKey && !phoneNumberId && !accessToken) {
    return {
      enabled: true,
      provider: "360dialog",
      url: `${d360BaseUrl}/messages`,
      headers: {
        "D360-API-KEY": d360ApiKey,
        "Content-Type": "application/json",
      },
    };
  }

  if (phoneNumberId && accessToken) {
    return {
      enabled: true,
      provider: "meta",
      url: `https://graph.facebook.com/${graphApiVersion}/${phoneNumberId}/messages`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    };
  }

  if (d360ApiKey) {
    return {
      enabled: true,
      provider: "360dialog",
      url: `${d360BaseUrl}/messages`,
      headers: {
        "D360-API-KEY": d360ApiKey,
        "Content-Type": "application/json",
      },
    };
  }

  return {
    enabled: false,
    provider: null,
    reason: "No outbound provider credentials configured",
  };
}

function hasZohoOAuthConfig() {
  return Boolean(
    process.env.ZOHO_CRM_CLIENT_ID &&
    process.env.ZOHO_CRM_CLIENT_SECRET &&
    process.env.ZOHO_CRM_REFRESH_TOKEN
  );
}

async function findZohoRecordByPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return null;
  }

  const indexedRecord = await findZohoRecordByNormalizedPhone(normalizedPhone);
  if (indexedRecord) {
    return indexedRecord;
  }

  const escapedPhone = escapeCoqlValue(phone);
  const contact = await queryZohoFirstRecord(
    "Contacts",
    [
      "id",
      "Full_Name",
      "First_Name",
      "Last_Name",
      "Phone",
      "Mobile",
      "Other_Phone",
      "Email",
    ],
    `((Mobile = '${escapedPhone}') or (Phone = '${escapedPhone}') or (Other_Phone = '${escapedPhone}'))`
  );

  if (contact) {
    // If we found a contact, we still want to make sure we use the normalized phone we searched for
    // as the primary phone if the contact's Mobile field is empty or different.
    return toZohoRecordMatch("Contacts", contact, normalizedPhone);
  }

  const lead = await queryZohoFirstRecord(
    "Leads",
    [
      "id",
      "Full_Name",
      "First_Name",
      "Last_Name",
      "Phone",
      "Mobile",
      "Email",
    ],
    `((Mobile = '${escapedPhone}') or (Phone = '${escapedPhone}'))`
  );

  if (lead) {
    return toZohoRecordMatch("Leads", lead, normalizedPhone);
  }

  return null;
}

async function safeFindZohoRecordByPhone(phone) {
  try {
    return await findZohoRecordByPhone(phone);
  } catch (error) {
    return null;
  }
}

async function queryZohoFirstRecord(moduleName, fields, criteria) {
  const response = await zohoApiRequest({
    path: "/crm/v8/coql",
    method: "POST",
    body: {
      select_query: `select ${fields.join(", ")} from ${moduleName} where ${criteria} limit 0, 1`,
    },
  });

  return response && Array.isArray(response.data) ? response.data[0] || null : null;
}

function toZohoRecordMatch(moduleName, record, fallbackPhone) {
  return {
    id: record.id,
    module: moduleName,
    name: firstNonEmpty([
      record.Full_Name,
      `${record.First_Name || ""} ${record.Last_Name || ""}`.trim(),
      record.Email,
      fallbackPhone,
    ]),
    email: record.Email || "",
    phone: normalizePhone(
      record.Mobile ||
      fallbackPhone ||
      record.Phone ||
      record.Other_Phone
    ),
  };
}

async function findZohoRecordByNormalizedPhone(phone) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    return null;
  }

  const phoneIndex = await getZohoPhoneIndex();
  const matches = phoneIndex.get(normalizedPhone) || [];
  if (!matches.length) {
    return null;
  }

  const preferred = matches.find((record) => record.module === "Contacts") || matches[0];
  return preferred;
}

async function getZohoPhoneIndex() {
  const now = Date.now();
  if (phoneIndexCache.index && phoneIndexCache.expiresAt > now) {
    return phoneIndexCache.index;
  }

  const tokenInfo = await getZohoAccessToken();
  const [contacts, leads] = await Promise.all([
    fetchZohoRecordsByPage("Contacts", [
      "id",
      "Full_Name",
      "First_Name",
      "Last_Name",
      "Phone",
      "Mobile",
      "Other_Phone",
      "Email",
    ], tokenInfo),
    fetchZohoRecordsByPage("Leads", [
      "id",
      "Full_Name",
      "First_Name",
      "Last_Name",
      "Phone",
      "Mobile",
      "Email",
    ], tokenInfo),
  ]);

  const index = new Map();
  [...contacts, ...leads].forEach((record) => {
    const candidates = [
      normalizePhone(record.Mobile),
      normalizePhone(record.Phone),
      normalizePhone(record.Other_Phone),
    ].filter(Boolean);

    candidates.forEach((candidatePhone) => {
      const entry = toZohoRecordMatch(record.module, record, candidatePhone);
      const existing = index.get(candidatePhone) || [];
      existing.push(entry);
      index.set(candidatePhone, existing);
    });
  });

  phoneIndexCache = {
    expiresAt: now + PHONE_INDEX_CACHE_TTL_MS,
    index,
  };

  return index;
}

async function fetchZohoRecordsByPage(moduleName, fields, tokenInfo) {
  const perPage = 200;
  const records = [];
  const maxPages = Math.max(1, Math.ceil(PHONE_INDEX_MAX_RECORDS / perPage));

  for (let page = 1; page <= maxPages; page += 1) {
    const response = await requestZohoModulePage(moduleName, fields, page, perPage, tokenInfo);
    const rows = Array.isArray(response?.data) ? response.data : [];
    if (!rows.length) {
      break;
    }

    rows.forEach((row) => {
      records.push({ ...row, module: moduleName });
    });

    if (rows.length < perPage || records.length >= PHONE_INDEX_MAX_RECORDS) {
      break;
    }
  }

  return records;
}

async function requestZohoModulePage(moduleName, fields, page, perPage, tokenInfo) {
  const apiDomain = process.env.ZOHO_CRM_API_DOMAIN || tokenInfo.apiDomain || "https://www.zohoapis.com";
  const url = new URL(`${apiDomain}/crm/v8/${moduleName}`);
  url.searchParams.set("fields", fields.join(","));
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));

  return requestJson({
    url: url.toString(),
    method: "GET",
    headers: {
      Authorization: `Zoho-oauthtoken ${tokenInfo.accessToken}`,
    },
  });
}

function buildZohoSignalPayload(message, record, signalConfig) {
  const subject = truncate(
    `WhatsApp message from ${record.name || message.senderName || message.phone}`,
    100
  );

  const messageBody = truncate(
    [
      `Sender: ${record.name || message.senderName || message.phone}`,
      `Phone: ${message.phone}`,
      `Module: ${record.module}`,
      "",
      message.text || `[${message.type || "message"}]`,
    ].join("~br~"),
    1000
  );

  const actionUrl = buildSignalActionUrl(signalConfig.actionUrl, {
    phone: message.phone,
    record_id: record.id,
    module: record.module,
    message_id: message.id,
    signal_source: "whatsapp_webhook",
  });

  return {
    signals: [
      {
        signal_namespace: signalConfig.namespace,
        id: record.id,
        subject,
        message: messageBody,
        actions: [
          {
            type: "link",
            open_in: signalConfig.actionOpenIn,
            display_name: signalConfig.actionDisplayName,
            url: actionUrl,
          },
        ],
      },
    ],
  };
}

function buildZohoNotePayload(message, record) {
  const sender = record.name || message.senderName || message.phone;
  const noteTitle = truncate(`WhatsApp inbound from ${sender}`, 100);
  const noteContent = truncate(
    [
      `WhatsApp inbound message`,
      `Sender: ${sender}`,
      `Phone: ${message.phone}`,
      `Received: ${formatIsoForNote(message.timestamp)}`,
      "",
      message.text || `[${message.type || "message"}]`,
    ].join("\n"),
    4000
  );

  return {
    data: [
      {
        $se_module: record.module,
        Note_Title: noteTitle,
        Note_Content: noteContent,
      },
    ],
  };
}

async function createZohoNoteForMessage(message, record) {
  return zohoApiRequest({
    path: `/crm/v8/${record.module}/${record.id}/Notes`,
    method: "POST",
    body: buildZohoNotePayload(message, record),
  });
}

async function raiseZohoSignal(payload) {
  return zohoApiRequest({
    path: "/crm/v2/signals/notifications",
    method: "POST",
    body: payload,
  });
}

async function getZohoSignals() {
  const response = await zohoApiRequest({
    path: "/crm/v2/settings/signals",
    method: "GET",
  });

  const rows = Array.isArray(response?.signals) ? response.signals : [];
  return rows.map((signal) => ({
    id: signal.id || "",
    namespace: signal.namespace || signal.api_name || "",
    display_label: signal.display_label || signal.display_name || "",
    enabled: signal.enabled,
    chat_enabled: signal.chat_enabled,
    extension: signal.extension || null,
  }));
}

async function zohoApiRequest({ path, method, body }) {
  const tokenInfo = await getZohoAccessToken();
  const apiDomain = process.env.ZOHO_CRM_API_DOMAIN || tokenInfo.apiDomain || "https://www.zohoapis.com";

  return requestJson({
    url: `${apiDomain}${path}`,
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${tokenInfo.accessToken}`,
      "Content-Type": "application/json",
    },
    body,
  });
}

async function getZohoAccessToken() {
  const response = await requestJson({
    url: `${getZohoAccountsDomain()}/oauth/v2/token`,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      refresh_token: process.env.ZOHO_CRM_REFRESH_TOKEN || "",
      client_id: process.env.ZOHO_CRM_CLIENT_ID || "",
      client_secret: process.env.ZOHO_CRM_CLIENT_SECRET || "",
      grant_type: "refresh_token",
    }).toString(),
  });

  return {
    accessToken: response.access_token,
    apiDomain: response.api_domain || process.env.ZOHO_CRM_API_DOMAIN || "",
  };
}

function getZohoAccountsDomain() {
  if (process.env.ZOHO_ACCOUNTS_DOMAIN) {
    return process.env.ZOHO_ACCOUNTS_DOMAIN.replace(/\/+$/, "");
  }

  const apiDomain = process.env.ZOHO_CRM_API_DOMAIN || "";
  if (apiDomain.includes(".zohoapis.eu")) return "https://accounts.zoho.eu";
  if (apiDomain.includes(".zohoapis.in")) return "https://accounts.zoho.in";
  if (apiDomain.includes(".zohoapis.com.au")) return "https://accounts.zoho.com.au";
  if (apiDomain.includes(".zohoapis.jp")) return "https://accounts.zoho.jp";
  if (apiDomain.includes(".zohoapis.sa")) return "https://accounts.zoho.sa";
  if (apiDomain.includes(".zohoapis.com.cn")) return "https://accounts.zoho.com.cn";

  return "https://accounts.zoho.com";
}

function buildSignalActionUrl(baseUrl, params) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
}

function requestJson({ url, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method,
        headers,
      },
      (response) => {
        let raw = "";

        response.on("data", (chunk) => {
          raw += chunk;
        });

        response.on("end", () => {
          const parsed = raw ? safeJsonParse(raw) : {};

          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(parsed);
            return;
          }

          const error = new Error(
            parsed.error && parsed.error.message
              ? parsed.error.message
              : parsed.message
                ? parsed.message
                : `Request failed with status ${response.statusCode}`
          );
          error.statusCode = response.statusCode;
          error.details = parsed;
          reject(error);
        });
      }
    );

    request.on("error", reject);
    if (body !== undefined && body !== null) {
      request.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    request.end();
  });
}

function postJson(url, body, headers) {
  return requestJson({
    url,
    method: "POST",
    headers,
    body,
  });
}

function firstNonEmpty(values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== "") || "";
}

function escapeCoqlValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function truncate(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

function formatIsoForNote(value) {
  if (!value) {
    return new Date().toISOString();
  }

  try {
    return new Date(value).toISOString();
  } catch (error) {
    return String(value);
  }
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return { raw: value };
  }
}

module.exports = {
  createBackendRouter,
};
