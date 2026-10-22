'use strict';
// End-to-end test with mocked Google + Internal Metrics. Run: node test/run.js
const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_SA_JSON = JSON.stringify({ client_email: 'bot@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
process.env.ENC_KEY = crypto.randomBytes(32).toString('base64');
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';

const G = require('./mockgoogle');
G.install();
const BOOK = '191KXHslzMCz22dBD3XW5cKEqP1pmGZsbmcPgGIf_fNY';
G.addBook(BOOK, 'Batch OPS', {
  Automation: Array.from({ length: 14 }, (_, i) => Array.from({ length: 20 }, () => '')),
  Other: [['a', 'b'], [1, 2]]
});
const { runJob } = require('../lib/host');
const OWNER = 'vishal26.arivihan@gmail.com';

let pass = 0, fail = 0;
async function t(name, fn, args, check, user) {
  try {
    const json = await runJob({ fn: fn, args: args || [], user: user || OWNER });
    const v = JSON.parse(json);
    const msg = check ? check(v) : true;
    if (msg === true) { pass++; console.log('  ok  ', name); }
    else { fail++; console.log('  FAIL', name, '→', msg, JSON.stringify(v).slice(0, 300)); }
    return v;
  } catch (e) {
    if (check && check.expectError) {
      const ok = check.expectError.test(e.message);
      if (ok) { pass++; console.log('  ok  ', name, '(error as expected:', e.message.slice(0, 80) + ')'); } else { fail++; console.log('  FAIL', name, 'unexpected error:', e.message); }
      return null;
    }
    fail++; console.log('  FAIL', name, 'error:', e.message, '\n', (e.workerStack || '').split('\n').slice(0, 6).join('\n'));
    return null;
  }
}
const expectErr = re => { const f = () => 'should have failed'; f.expectError = re; return f; };

(async () => {
  console.log('Worker + Apps Script code');
  await t('vercelSetupStatus', 'vercelSetupStatus', [], v => v.owner === true && v.imported === '' || 'bad status');
  await t('webInit (owner)', 'webInit', ['ENG'], v => (v.allowed && v.isAdmin && v.features.length >= 10 && v.envInfo.env === 'PROD') || 'not allowed/admin');
  await t('webInit (stranger)', 'webInit', ['ENG'], v => (v.allowed === false) || 'stranger allowed', 'someone@else.com');
  await t('adminStatus', 'adminStatus', [], v => (v.isAdmin && !v.hasPassword) || 'unexpected');
  await t('adminSetupPassword', 'adminSetupPassword', ['secret123'], v => (v.hasPassword && v.loggedIn) || 'not logged in');
  await t('adminData (session persists across calls)', 'adminData', [], v => (Array.isArray(v.users) && v.logs.length >= 1) || 'no logs');
  await t('adminLogin wrong password', 'adminLogin', [OWNER, 'nope'], expectErr(/Wrong password/));
  await t('adminLogin', 'adminLogin', [OWNER, 'secret123'], v => v.loggedIn || 'not logged in');
  await t('adminAddUser (user with features)', 'adminAddUser', ['abc@x.com', 'user', '', ['today', 'lecture', 'push_dash']], v => (v.users.some(u => u.email === 'abc@x.com') && Array.isArray(v.shareReport)) || 'not added');
  await t('webInit (new user)', 'webInit', ['ENG'], v => (v.allowed && !v.isAdmin && v.features.indexOf('push_nodes') < 0 && v.features.indexOf('push_dash') >= 0) || 'features wrong', 'abc@x.com');
  await t('webTokenSave bad', 'webTokenSave', ['BADTOKEN'], expectErr(/not valid \(401\)/));
  await t('webTokenSave good', 'webTokenSave', ['GOODTOKEN1234'], v => (v.valid && v.tail === '1234' && v.source === 'own') || 'token not saved');
  await t('webTokenStatus', 'webTokenStatus', [true], v => (v.valid && v.tail === '1234') || 'status wrong');
  await t('webSetEnv STAGE', 'webSetEnv', ['STAGE'], v => (v.envInfo.env === 'STAGE' && v.token.valid === false) || 'stage wrong');
  await t('webTokenSave stage', 'webTokenSave', ['STAGETOKEN5678'], v => (v.valid && v.tail === '5678' && v.env === 'STAGE') || 'stage token wrong');
  await t('webSetEnv PROD', 'webSetEnv', ['PROD'], v => (v.envInfo.env === 'PROD' && v.token.tail === '1234') || 'prod token wrong');
  await t('webLectureLoad', 'webLectureLoad', ['ENG'], v => (v && v.row && 'lectureCode' in v.row) || 'no row');
  await t('webFiles', 'webFiles', [], v => (Array.isArray(v) && v.length >= 1) || 'no files');
  await t('webTodayFile PHYENG (file not shared)', 'webTodayFile', ['PHYENG', '', true], v => (v && /shared with the service account/.test(v.error || '')) || 'expected a sharing error');
  await t('adminVerifyLogs', 'adminVerifyLogs', [], v => (v.ok && v.checked >= 3) || ('problems: ' + (v.problems || []).join(' | ')));
  await t('adminUiHtml', 'adminUiHtml', [], v => (typeof v === 'string' && v.length > 1000) || 'no html');
  await t('adminSetFreeze on', 'adminSetFreeze', [true, 'test stop', 'secret123'], v => (v.safety.freeze && v.safety.freeze.on) || 'not frozen');
  await t('webApply blocked by freeze', 'webApply', ['PHYENG'], expectErr(/EMERGENCY STOP/));
  await t('adminSetFreeze off', 'adminSetFreeze', [false, '', 'secret123'], v => (!v.safety.freeze) || 'still frozen');
  await t('adminBackupNow (Vercel message)', 'adminBackupNow', [], expectErr(/runs in Apps Script/));
  await t('vercelImportSettings (owner)', 'vercelImportSettings', [JSON.stringify({ ADM_RATE: '{"perHour":12}', FOO: 'x' }), ''], v => (v.count === 1) || 'count wrong');
  await t('vercelImportSettings again needs password', 'vercelImportSettings', [JSON.stringify({ ADM_RATE: '{"perHour":13}' }), 'bad'], expectErr(/Wrong admin password/));
  await t('vercelImportSettings (not owner)', 'vercelImportSettings', ['{}', ''], expectErr(/Only the owner/), 'abc@x.com');
  await t('adminVerifyLogs (after many writes)', 'adminVerifyLogs', [], v => (v.ok) || ('problems: ' + (v.problems || []).join(' | ')));

  // store tab is encrypted
  const st = G.BOOKS[BOOK].sheets.find(s => s.title === '_vercel_store');
  const plain = JSON.stringify(st.grid);
  console.log(/GOODTOKEN|STAGETOKEN|secret123/.test(plain) ? '  FAIL  store contains plain secrets' : '  ok   store tab holds only encrypted values (' + st.grid.length + ' rows)');
  if (/GOODTOKEN|STAGETOKEN|secret123/.test(plain)) fail++; else pass++;
  const logs = G.BOOKS[BOOK].sheets.find(s => s.title === 'Logs');
  console.log('  info  Logs rows:', logs.grid.length - 1, '· last action:', (logs.grid[logs.grid.length - 1][2] || {}).raw);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  console.log('Google API calls made:', G.LOG.length);
  process.exit(fail ? 1 : 0);
})();
