'use strict';
// Speed check with mocked Google: time and Google API calls per dashboard call. Run: node test/profile.js
const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_SA_JSON = JSON.stringify({ client_email: 'bot@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
process.env.ENC_KEY = crypto.randomBytes(32).toString('base64');
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');

const G = require('./mockgoogle');
G.install();
require('./fixtures').load(G);
const { runJob } = require('../lib/host');
const O = 'vishal26.arivihan@gmail.com';

async function p(name, fn, args) {
  const n0 = G.LOG.length, t0 = Date.now();
  let err = '';
  try { await runJob({ fn, args, user: O }); } catch (e) { err = ' (error: ' + e.message.slice(0, 60) + ')'; }
  const calls = G.LOG.slice(n0).filter(l => !/arivihan\.com|oauth2/.test(l));
  console.log(String(Date.now() - t0).padStart(5) + ' ms  ' + String(calls.length).padStart(3) + ' Google calls  ' + name + err);
  if (process.argv[2] === '-v') calls.forEach(c => console.log('             ' + c.slice(0, 150)));
}

(async () => {
  await p('webTokenSave', 'webTokenSave', ['GOODTOKEN1234']);
  await p('webInit', 'webInit', ['ENG']);
  await p('webInit (again)', 'webInit', ['ENG']);
  await p('webTokenStatus', 'webTokenStatus', [false]);
  await p('webLectureLoad', 'webLectureLoad', ['ENG']);
  await p('webTodayLogs', 'webTodayLogs', [false]);
  await p('webTodayFile PHYENG', 'webTodayFile', ['PHYENG', '', false]);
  await p('webDppList', 'webDppList', ['PHYHIN']);
  process.exit(0);
})();
