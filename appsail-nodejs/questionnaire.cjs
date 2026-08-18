const fs = require("fs");
const path = require("path");

const SESSION_VERSION = 1;

const QUESTIONS = [
  { id: "firstName", prompt: "May I have your first / given name?", required: true, validate: text },
  { id: "lastName", prompt: "May I have your last / family name?", required: true, validate: text },
  { id: "otherName", prompt: "Have you ever been known by another name? Please reply Yes or No.", required: true, validate: yesNo },
  { id: "previousName", prompt: "Please provide your previous name.", required: true, when: s => s.otherName === "yes", validate: text },
  { id: "email", prompt: "What is your email address?", required: true, validate: email },
  { id: "mobile", prompt: "Please provide your mobile phone number, including country code.", required: true, validate: phone },
  { id: "dob", prompt: "What is your date of birth? Please use DD-MMM-YYYY, for example 08-Aug-2005.", required: true, validate: date },
  { id: "relationshipStatus", prompt: "What is your relationship status? Reply Single, Married, Divorced, or Widowed.", required: true, validate: choice(["single", "married", "divorced", "widowed"]) },
  { id: "passportNumber", prompt: "Please provide your passport number.", required: true, validate: text },
  { id: "ucas", prompt: "Do you apply to UK universities through UCAS? Please reply Yes or No.", required: true, validate: yesNo },
  { id: "ucasId", prompt: "Please provide your UCAS ID.", required: true, when: s => s.ucas === "yes", validate: text },
  { id: "permanentAddress", prompt: "Please provide your permanent residential address, including street, city, state, and postcode.", required: true, validate: text },
  { id: "addressDuration", prompt: "How long have you lived at this address? Reply Less than 2 years or 2 or more years.", required: true, validate: choice(["less than 2 years", "2 or more years"]) },
  { id: "previousAddress", prompt: "Please provide any other address where you have lived during the past 2 years, including the dates lived there. Reply None if not applicable.", required: false, validate: text },
  { id: "postalSame", prompt: "Is your postal address the same as your permanent residential address? Please reply Yes or No.", required: true, validate: yesNo },
  { id: "postalAddress", prompt: "Please provide your postal address, including street, city, state, and postcode.", required: true, when: s => s.postalSame === "no", validate: text },
  { id: "otherNationality", prompt: "Do you currently hold, or have you ever held, another nationality or citizenship? Please reply Yes or No.", required: true, validate: yesNo },
  { id: "otherNationalityDetails", prompt: "Please provide the other nationality or citizenship and upload the supporting certificate or passport when prompted.", required: true, when: s => s.otherNationality === "yes", validate: text },
  { id: "secondNationalityId", prompt: "Do you have a national identity card for your second nationality? Please reply Yes or No.", required: true, when: s => s.otherNationality === "yes", validate: yesNo },
  { id: "secondNationalityIdDetails", prompt: "Please provide the identity-card number, issuing authority, issue date, and expiry date in one message.", required: true, when: s => s.secondNationalityId === "yes", validate: text },
  { id: "partnerName", prompt: "Please provide your partner's full name, or reply None if not applicable.", required: true, validate: text },
  { id: "partnerDob", prompt: "Please provide your partner's date of birth in DD-MMM-YYYY, or reply None.", required: true, when: hasPartner, validate: optionalDate },
  { id: "partnerNationality", prompt: "Please provide your partner's nationality, or reply None.", required: true, when: hasPartner, validate: text },
  { id: "partnerLivesWithYou", prompt: "Does your partner currently live with you? Reply Yes or No.", required: true, when: hasPartner, validate: yesNo },
  { id: "partnerAddress", prompt: "Please provide your partner's address, or reply None.", required: true, when: s => hasPartner(s) && s.partnerLivesWithYou === "no", validate: text },
  { id: "partnerTravelling", prompt: "Will your partner travel with you to the UK? Reply Yes or No.", required: true, when: hasPartner, validate: yesNo },
  { id: "partnerPassport", prompt: "Please provide your partner's passport number, or reply None.", required: true, when: hasPartner, validate: text },
  { id: "parentDetails", prompt: "Which parent details do you have? Reply Both, Mother only, Father only, or Neither.", required: true, validate: choice(["both", "mother only", "father only", "neither"]) },
  { id: "motherDetails", prompt: "Please provide your mother's full name, date of birth, nationality, and whether she has always had the same nationality. Reply None if unavailable.", required: true, when: s => ["both", "mother only"].includes(s.parentDetails), validate: text },
  { id: "fatherDetails", prompt: "Please provide your father's full name, date of birth, nationality, and whether he has always had the same nationality. Reply None if unavailable.", required: true, when: s => ["both", "father only"].includes(s.parentDetails), validate: text },
  { id: "onlyChildApplying", prompt: "Are you the only child in your family applying for a UK Student visa? Reply Yes or No.", required: true, validate: yesNo },
  { id: "stayingWithParent", prompt: "Are you currently staying with both parents, mother only, father only, or someone else?", required: true, validate: choice(["both parents", "mother only", "father only", "other"]) },
  { id: "guardianship", prompt: "Will you be in a guardianship arrangement at any point in the UK? Reply Yes or No.", required: true, validate: yesNo },
  { id: "guardianDetails", prompt: "Please provide your guardian's full name, phone number, email, and residential address.", required: true, when: s => s.guardianship === "yes", validate: text },
  { id: "familyInUk", prompt: "Do you have any family member in the UK? Please reply Yes or No.", required: true, validate: yesNo },
  { id: "ukFamilyDetails", prompt: "Please provide the family member's name, nationality, relationship, UK residence type, passport number, whether you will stay with them, UK address, phone, and email.", required: true, when: s => s.familyInUk === "yes", validate: text },
  { id: "accommodationConfirmed", prompt: "Have you confirmed your UK accommodation? Please reply Yes or No.", required: true, validate: yesNo },
  { id: "accommodationDetails", prompt: "Please provide your UK accommodation address and details.", required: true, when: s => s.accommodationConfirmed === "yes", validate: text },
  { id: "organisationTypes", prompt: "Have you ever worked, paid or unpaid, for the armed forces, government, intelligence, security, media, or judiciary? Reply None or list all that apply.", required: true, validate: text },
  { id: "jobDetails", prompt: "Please provide your job title / role, organisation name, and employment start date. Reply None if not applicable.", required: true, validate: text },
  { id: "ukArrivalDate", prompt: "What date do you plan to arrive in the UK? Please use DD-MMM-YYYY.", required: true, validate: date },
  { id: "ukVisits", prompt: "How many times have you visited the UK in the past 10 years? Reply 0 if never.", required: true, validate: nonNegativeInteger },
  { id: "ukVisitDetails", prompt: "Please provide the entry date, duration, and purpose for each UK visit. Reply None if you entered 0.", required: true, when: s => Number(s.ukVisits) > 0, validate: text },
  { id: "ukMedicalTreatment", prompt: "Have you ever received medical treatment in the UK? Please reply Yes or No.", required: true, validate: yesNo },
  { id: "medicalDetails", prompt: "Please provide the hospital / clinic name, address, treatment start date, treatment end date, whether payment was required, and whether it was paid in full.", required: true, when: s => s.ukMedicalTreatment === "yes", validate: text },
  { id: "priorityCountryVisits", prompt: "How many times have you visited Australia, Canada, New Zealand, USA, Switzerland, or the EEA in the past 10 years? Provide country and count, for example Australia 1; USA 0.", required: true, validate: text },
  { id: "priorityVisitDetails", prompt: "Please provide the details of your two most recent visits to those places: country, entry date, exit date, and reason. Reply None if not applicable.", required: true, validate: text },
  { id: "otherTravel", prompt: "Have you travelled outside your country of residence in the last 10 years, excluding the UK, Australia, Canada, New Zealand, USA, Switzerland, and EEA? Reply Yes or No.", required: true, validate: yesNo },
  { id: "otherTravelDetails", prompt: "Please provide each country, entry date, exit date, and reason for travel.", required: true, when: s => s.otherTravel === "yes", validate: text },
  { id: "biometricAvailability", prompt: "Please provide a date and time when you are available for your visa biometric appointment, using DD-MMM-YYYY HH:MM AM/PM.", required: true, validate: text },
  { id: "passportUpload", prompt: "Please upload a colour scan of every page of your current passport, including blank pages and the cover. Send the file now, or reply Pending.", required: true, validate: uploadOrPending },
  { id: "casUpload", prompt: "Please upload your CAS if available, or reply Not available.", required: true, validate: uploadOrPending },
  { id: "tbUpload", prompt: "Please upload your TB screening report if available, or reply Not available.", required: true, validate: uploadOrPending },
];

function createSession(phone) {
  return { version: SESSION_VERSION, phone, status: "active", index: -1, answers: {}, updatedAt: new Date().toISOString() };
}

function createStore(filePath) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify({ sessions: {} }, null, 2));
}

function readStore(filePath) {
  createStore(filePath);
  try { const data = JSON.parse(fs.readFileSync(filePath, "utf8")); return data && data.sessions ? data : { sessions: {} }; }
  catch { return { sessions: {} }; }
}

function writeStore(filePath, store) { createStore(filePath); fs.writeFileSync(filePath, JSON.stringify(store, null, 2)); }

function getQuestion(session) {
  for (let i = session.index + 1; i < QUESTIONS.length; i += 1) if (!QUESTIONS[i].when || QUESTIONS[i].when(session.answers)) return { question: QUESTIONS[i], index: i };
  return null;
}

function answer(session, raw, messageType) {
  const current = getQuestion(session);
  if (!current) return { session, reply: summary(session), complete: true };
  const value = messageType !== "text" && messageType !== "interactive" ? `[${messageType} received]` : String(raw || "").trim();
  const validation = current.question.validate(value);
  if (!validation.ok) return { session, reply: `${validation.error}\n\n${current.question.prompt}`, complete: false };
  session.answers[current.question.id] = validation.value;
  session.index = current.index;
  session.updatedAt = new Date().toISOString();
  const next = getQuestion(session);
  if (!next) { session.status = "complete"; return { session, reply: summary(session), complete: true }; }
  return { session, reply: progress(session, next.question.prompt), complete: false };
}

function start(session) {
  const first = { ...session, status: "active", index: -1, answers: {}, updatedAt: new Date().toISOString() };
  return { session: first, reply: "I’ll guide you through the UK visa questionnaire one question at a time. You can reply BACK to correct the previous answer, SUMMARY to review your answers, or RESTART to begin again.\n\n" + QUESTIONS[0].prompt, complete: false };
}

function handleMessage({ filePath, phone, text, type }) {
  const store = readStore(filePath);
  let session = store.sessions[phone] || createSession(phone);
  const command = String(text || "").trim().toLowerCase();
  if (["visa", "start", "start visa", "questionnaire", "begin"].includes(command) || session.status === "complete" && command === "restart") {
    const result = start(session); store.sessions[phone] = result.session; writeStore(filePath, store); return result;
  }
  if (command === "restart") { const result = start(session); store.sessions[phone] = result.session; writeStore(filePath, store); return result; }
  if (command === "summary") { return { session, reply: summary(session), complete: session.status === "complete" }; }
  if (command === "back") {
    session.index = Math.max(-1, previousVisibleIndex(session));
    const current = getQuestion(session);
    store.sessions[phone] = session; writeStore(filePath, store);
    return { session, reply: current ? `Let’s correct that answer.\n\n${current.question.prompt}` : "Please reply START to begin the questionnaire.", complete: false };
  }
  if (session.index < 0 && !store.sessions[phone]) return { session, reply: "Please reply START to begin your UK visa questionnaire.", complete: false };
  const result = answer(session, text, type);
  store.sessions[phone] = result.session; writeStore(filePath, store); return result;
}

function previousVisibleIndex(session) { for (let i = session.index - 1; i >= 0; i -= 1) if (!QUESTIONS[i].when || QUESTIONS[i].when(session.answers)) return i; return -1; }
function progress(session, prompt) { const answered = Object.keys(session.answers).length; return `Question ${answered + 1} of approximately ${QUESTIONS.length}.\n\n${prompt}`; }
function summary(session) { const lines = Object.entries(session.answers).map(([key, value]) => `${label(key)}: ${value}`); return `Your questionnaire is ${session.status === "complete" ? "complete" : "in progress"}.\n\n${lines.length ? lines.join("\n") : "No answers recorded yet."}\n\nReply BACK to amend the previous answer, RESTART to start again, or contact your adviser before submitting. This WhatsApp flow records your responses for adviser review; it does not make a visa decision.`; }
function label(id) { return id.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()); }
function normalise(value) { return String(value || "").trim().toLowerCase().replace(/\s+/g, " "); }
function text(value) { return String(value || "").trim() ? { ok: true, value: String(value).trim() } : { ok: false, error: "Please provide an answer so I can continue." }; }
function yesNo(value) { const v = normalise(value); if (["yes", "y"].includes(v)) return { ok: true, value: "yes" }; if (["no", "n"].includes(v)) return { ok: true, value: "no" }; return { ok: false, error: "Please reply Yes or No." }; }
function choice(values) { return value => { const v = normalise(value); const found = values.find(item => v === item || v.startsWith(item)); return found ? { ok: true, value: found } : { ok: false, error: `Please choose one of: ${values.join(", ")}.` }; }; }
function email(value) { const v = String(value || "").trim(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { ok: true, value: v } : { ok: false, error: "That does not look like a valid email address. Please try again." }; }
function phone(value) { const v = String(value || "").trim(); return /^[+\d][\d\s().-]{6,}$/.test(v) ? { ok: true, value: v } : { ok: false, error: "Please provide a valid mobile number, including country code." }; }
function date(value) { const v = String(value || "").trim(); return /^(0?[1-9]|[12]\d|3[01])-[A-Za-z]{3}-\d{4}$/.test(v) ? { ok: true, value: v } : { ok: false, error: "Please use the format DD-MMM-YYYY, for example 08-Aug-2005." }; }
function optionalDate(value) { return normalise(value) === "none" ? { ok: true, value: "none" } : date(value); }
function nonNegativeInteger(value) { const v = String(value || "").trim(); return /^\d+$/.test(v) ? { ok: true, value: v } : { ok: false, error: "Please provide a whole number, or 0 if not applicable." }; }
function uploadOrPending(value) { const v = normalise(value); return v === "pending" || v === "not available" || v === "none" || /^\[.+ received\]$/.test(String(value)) ? { ok: true, value: String(value).trim() } : { ok: false, error: "Please upload the requested file now, or reply Pending / Not available." }; }
function hasPartner(session) { return session.partnerName && normalise(session.partnerName) !== "none"; }

module.exports = { handleMessage };
