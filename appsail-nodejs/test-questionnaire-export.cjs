const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const exporter = require('./questionnaire-export.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waba-export-'));
const storePath = path.join(dir, 'questionnaire-sessions.json');
fs.writeFileSync(storePath, JSON.stringify({ sessions: {
  '60123456789': {
    phone: '60123456789', status: 'complete', updatedAt: '2026-08-19T00:00:00.000Z',
    answers: { firstName: 'Teddy', email: 'teddy@example.com', notes: 'Line 1, "quoted"\nLine 2' }
  },
  '60999999999': { phone: '60999999999', status: 'active', answers: { firstName: 'Incomplete' } }
} }));

process.env.VISA_EXPORT_TOKEN = 'test-secret';
const session = exporter.readCompletedSession(storePath, '60 123-456-789');
assert.equal(session.phone, '60123456789');
assert.equal(exporter.readCompletedSession(storePath, '60999999999'), null);
const csv = exporter.toCsv(session);
assert(csv.startsWith('\ufeff'));
assert(csv.includes('First Name,Teddy'));
assert(csv.includes('"Line 1, ""quoted""\nLine 2"'));
const pdf = exporter.toPdf(session);
assert.equal(pdf.subarray(0, 8).toString('binary'), '%PDF-1.4');
assert(pdf.toString('binary').includes('%%EOF'));

const unauthorizedReq = { get: () => '' };
assert.equal(exporter.verifyExportToken(unauthorizedReq), false);
const authorizedReq = { get: (name) => name === 'x-export-token' ? 'test-secret' : '' };
assert.equal(exporter.verifyExportToken(authorizedReq), true);
fs.rmSync(dir, { recursive: true, force: true });
console.log('questionnaire export smoke test passed');
