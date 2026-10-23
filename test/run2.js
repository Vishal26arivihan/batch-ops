'use strict';
// Feature tests on test copies of the sheets: Today, Lecture, DPP list / flags / upload (.xlsx checked with openpyxl).
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_SA_JSON = JSON.stringify({ client_email: 'bot@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
process.env.ENC_KEY = crypto.randomBytes(32).toString('base64');
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');

const G = require('./mockgoogle');
G.install();
require('./fixtures').load(G);
const { runJob } = require('../lib/host');
const O = 'vishal26.arivihan@gmail.com';
let pass = 0, fail = 0;
async function t(name, fn, args, check) {
  try {
    const v = JSON.parse(await runJob({ fn, args, user: O }));
    const m = check(v);
    if (m === true) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, '→', m, JSON.stringify(v).slice(0, 400)); }
    return v;
  } catch (e) { fail++; console.log('  FAIL', name, 'error:', e.message, (e.workerStack || '').split('\n').slice(0, 5).join('\n')); return null; }
}

let uploaded = null;
G.IM.handler = (u, method, opts, body) => {
  if (/upload\/test/.test(u.pathname) && method === 'POST') {
    uploaded = { url: u.toString(), ct: opts.headers['content-type'], body: Buffer.from(opts.body) };
    return new Response('Iterating row number 1\nUpdating test series :: D2\nSuccessfully saved dpp-batch-mapping\nFinished db update successfully', { status: 200 });
  }
  return null;
};

(async () => {
  await t('webTokenSave', 'webTokenSave', ['GOODTOKEN1234'], v => v.valid || 'no');
  await t('webTodayFile PHYENG', 'webTodayFile', ['PHYENG', '', true], v => (v.items.length === 1 && v.items[0].recorded && v.items[0].pdf && v.items[0].start === '09:30:00') || 'items wrong');
  await t('webTodayFile CHEHIN', 'webTodayFile', ['CHEHIN', '', true], v => (v.items.length === 1 && !v.items[0].recorded && v.items[0].startMin === 12 * 60 + 30) || 'items wrong');
  await t('webTodayLogs', 'webTodayLogs', [true], v => (typeof v === 'object') || 'bad');
  await t('webLectureLoad ENG', 'webLectureLoad', ['ENG'], v => (v.code === '2027NEETPHYENGLIVE31' && /ML1$/.test(v.row.lectureCode)) || 'lecture wrong');
  const L = await t('webDppList PHYHIN', 'webDppList', ['PHYHIN'], v => (v.rows.length === 3 && v.rows[1].update && v.rows.every(r => r.hasTab) && v.rows[0].liveKey === v.today) || 'dpp list wrong');
  await t('webDppSetFlags (D1 yes, D2 stays yes)', 'webDppSetFlags', ['PHYHIN', [{ row: 2, yes: true }]], v => (v.rows[0].update && v.rows[1].update && !v.rows[2].update) || 'flags wrong');
  const sheetVal = G.BOOKS['1RtooDZMOtShNv0hEvbcnP7SMXasFD0A6DiD9aaNFLdc'].sheets[0].grid[1][6];
  console.log(sheetVal.raw === 'Yes' ? '  ok   sheet keeps "Yes" spelling' : '  FAIL sheet value ' + JSON.stringify(sheetVal)); sheetVal.raw === 'Yes' ? pass++ : fail++;
  await t('webDppUpload', 'webDppUpload', ['PHYHIN'], v => (v.ok && v.updated[0] === 'D2' && v.selected.length === 2 && v.sizeKb >= 0) || 'upload wrong');
  if (uploaded) {
    const ok1 = /language=HINDI&batchId=100&isDpp=true/.test(uploaded.url) && /multipart\/form-data/.test(uploaded.ct);
    console.log(ok1 ? '  ok   upload URL + multipart' : '  FAIL upload request ' + uploaded.url); ok1 ? pass++ : fail++;
    const bnd = uploaded.ct.split('boundary=')[1];
    const raw = uploaded.body, start = raw.indexOf('\r\n\r\n') + 4, end = raw.lastIndexOf(Buffer.from('\r\n--' + bnd));
    const xf = path.join(os.tmpdir(), 'dpp_test.xlsx');
    fs.writeFileSync(xf, raw.subarray(start, end));
    // python3 (Linux / Mac) or python (Windows) with openpyxl; skipped when neither is installed
    const src = `
import openpyxl, sys
wb = openpyxl.load_workbook(sys.argv[1])
print(wb.sheetnames)
ws = wb[wb.sheetnames[0]]
for r in ws.iter_rows(values_only=True): print(r)
print(wb['Kinematics - II']['A3'].value, wb['Kinematics - II']['B3'].value)
`;
    let py = null;
    for (const exe of ['python3', 'python']) {
      try { py = execFileSync(exe, ['-c', src, xf], { stdio: ['ignore', 'pipe', 'ignore'] }).toString(); break; } catch (e) {}
    }
    if (py === null) console.log('  skip xlsx content (needs Python with openpyxl)');
    else {
      console.log(py.split('\n').map(x => '        ' + x).join('\n'));
      const ok2 = /'InfoHindi', 'Kinematics - I', 'Kinematics - II'/.test(py) && /datetime\.datetime/.test(py) && !/Laws of Motion/.test(py);
      console.log(ok2 ? '  ok   xlsx: Info (selected rows only) + 2 question tabs, dates are real dates' : '  FAIL xlsx content'); ok2 ? pass++ : fail++;
    }
  } else { fail++; console.log('  FAIL nothing uploaded'); }

  // PDF update: S7 is a formula reading the live sheet, recalculated by Google a moment after the write
  const pdfUrl = 'https://files.arivihan.com/notes/2027NEETPHYENGLIVE30ML1.pdf';
  const auto = G.BOOKS['191KXHslzMCz22dBD3XW5cKEqP1pmGZsbmcPgGIf_fNY'].sheets[0].grid;
  auto[6][2] = { raw: '2027NEETPHYENGLIVE30ML1', f: null, disp: '2027NEETPHYENGLIVE30ML1' };      // C7
  auto[6][18] = { raw: '', f: null, disp: '' };                                                    // S7 (not recalculated yet)
  const imHandler = G.IM.handler;
  G.IM.handler = (u, method, opts, body) => u.host === 'files.arivihan.com' ? new Response('%', { status: 206 }) : imHandler(u, method, opts, body);
  const recalc = setTimeout(() => { auto[6][18] = { raw: pdfUrl, f: null, disp: pdfUrl }; }, 2000);
  await t('webPdfUpdate waits for S7 to recalculate', 'webPdfUpdate', ['ENG', '2027NEETPHYENGLIVE30', pdfUrl], v =>
    (v.wrote.join() === 'notes_url' && v.sameLecture && v.matches && v.automationPdf === pdfUrl) || 'S7 not picked up');
  clearTimeout(recalc);
  const liveNotes = G.BOOKS['1Qr8K0RNrtN2XvjchqwxwTyKpA3XenexC4n37xehS1zc'].sheets[0].grid[1][8];
  console.log(liveNotes.raw === pdfUrl ? '  ok   live sheet notes_url written' : '  FAIL live sheet notes_url ' + JSON.stringify(liveNotes)); liveNotes.raw === pdfUrl ? pass++ : fail++;
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
