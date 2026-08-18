const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function normalizePhone(value) {
  const digits = String(value || "").replace(/[^\d]/g, "");
  return digits.startsWith("00") ? digits.slice(2) : digits;
}

function readCompletedSession(filePath, phone) {
  const normalized = normalizePhone(phone);
  if (!normalized || !fs.existsSync(filePath)) return null;
  try {
    const store = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const session = store?.sessions?.[normalized];
    return session && session.status === "complete" ? session : null;
  } catch {
    return null;
  }
}

function verifyExportToken(req) {
  const configured = String(process.env.VISA_EXPORT_TOKEN || "");
  if (!configured) return false;
  const header = String(req.get("x-export-token") || "");
  const auth = String(req.get("authorization") || "");
  const supplied = header || (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "");
  if (!supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(configured);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function makeExportRows(session) {
  const rows = [
    ["Export type", "UK visa questionnaire adviser export"],
    ["Exported at (UTC)", new Date().toISOString()],
    ["Mobile number", session.phone || ""],
    ["Questionnaire status", session.status || ""],
    ["Last updated (UTC)", session.updatedAt || ""],
    ["", ""],
  ];
  for (const [key, value] of Object.entries(session.answers || {})) {
    rows.push([humanize(key), formatValue(value)]);
  }
  return rows;
}

function humanize(value) {
  return String(value || "").replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function formatValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join("; ");
  return String(value);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(session) {
  const rows = makeExportRows(session);
  return "\uFEFF" + rows.map((row) => row.map(csvEscape).join(",")).join("\r\n") + "\r\n";
}

function toPdf(session) {
  const lines = [];
  for (const [key, value] of makeExportRows(session)) {
    if (!key && !value) { lines.push(""); continue; }
    const text = `${key}: ${value}`;
    lines.push(...wrapPdfText(text, 92));
  }

  const pages = [];
  let page = [];
  for (const line of lines) {
    if (page.length >= 46) { pages.push(page); page = []; }
    page.push(line);
  }
  if (page.length || !pages.length) pages.push(page);

  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add("");
  const pagesObject = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageObjectIds = [];

  for (const pageLines of pages) {
    const commands = ["BT", "/F1 10 Tf", "50 770 Td", "14 TL"];
    pageLines.forEach((line, index) => {
      if (index > 0) commands.push("T*");
      commands.push(`(${pdfEscape(line)}) Tj`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesObject} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`);
    pageObjectIds.push(pageId);
  }

  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObject} 0 R >>`;
  objects[pagesObject - 1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;

  let pdf = "%PDF-1.4\n%\xFF\xFF\xFF\xFF\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, "binary");
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "binary");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "binary");
}

function wrapPdfText(text, width) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if ((current + " " + word).length <= width) current += ` ${word}`;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function pdfEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "?");
}

module.exports = { normalizePhone, readCompletedSession, verifyExportToken, toCsv, toPdf };
