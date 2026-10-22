'use strict';
// Feature tests on test copies of the sheets: Today, Lecture, DPP list / flags / upload (.xlsx checked with openpyxl).
const crypto = require('crypto');
const fs = require('fs');
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
    fs.writeFileSync('/tmp/dpp_test.xlsx', raw.subarray(start, end));
    const py = execFileSync('python3', ['-c', `
import openpyxl
wb = openpyxl.load_workbook('/tmp/dpp_test.xlsx')
print(wb.sheetnames)
ws = wb[wb.sheetnames[0]]
for r in ws.iter_rows(values_only=True): print(r)
print(wb['Kinematics - II']['A3'].value, wb['Kinematics - II']['B3'].value)
`]).toString();
    console.log(py.split('\n').map(x => '        ' + x).join('\n'));
    const ok2 = /'InfoHindi', 'Kinematics - I', 'Kinematics - II'/.test(py) && /datetime\.datetime/.test(py) && !/Laws of Motion/.test(py);
    console.log(ok2 ? '  ok   xlsx: Info (selected rows only) + 2 question tabs, dates are real dates' : '  FAIL xlsx content'); ok2 ? pass++ : fail++;
  } else { fail++; console.log('  FAIL nothing uploaded'); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
