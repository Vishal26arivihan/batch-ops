'use strict';
const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_SA_JSON = JSON.stringify({ client_email: 'bot@t', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
process.env.ENC_KEY = crypto.randomBytes(32).toString('base64');
process.env.SESSION_SECRET = 'x'.repeat(40);
const G = require('./mockgoogle'); G.install();
G.addBook('191KXHslzMCz22dBD3XW5cKEqP1pmGZsbmcPgGIf_fNY', 'Batch OPS', { Automation: Array.from({ length: 14 }, () => Array.from({ length: 20 }, () => '')) });
const { runJob } = require('../lib/host');
const O = 'vishal26.arivihan@gmail.com';
(async () => {
  for (const [fn, args] of [['webInit', ['ENG']], ['webInit', ['ENG']], ['adminSetupPassword', ['secret123']], ['webTokenStatus', [true]], ['webTodayLogs', [true]], ['adminData', []]]) {
    const n0 = G.LOG.length;
    try { await runJob({ fn, args, user: O }); } catch (e) { console.log(fn, 'ERR', e.message); }
    const calls = G.LOG.slice(n0).filter(x => !/oauth2/.test(x));
    console.log(fn + ': ' + calls.length + ' calls');
    calls.forEach(c => console.log('    ' + c.replace(/191KXH\w+/, 'BOOK').slice(0, 150)));
  }
})();
