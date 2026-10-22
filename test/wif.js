'use strict';
// Keyless mode: Vercel OIDC -> STS -> service account token
process.env.ENC_KEY = 'x'.repeat(40); process.env.SESSION_SECRET = 'y'.repeat(40);
delete process.env.GOOGLE_SA_JSON;
Object.assign(process.env, { GCP_PROJECT_NUMBER: '123456', GCP_SERVICE_ACCOUNT_EMAIL: 'batch-ops-bot@p.iam.gserviceaccount.com', GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel', GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel' });
const G = require('./mockgoogle'); G.install(); require('./fixtures').load(G);
const host = require('../lib/host');
(async () => {
  try { await host.runJob({ fn: 'webInit', args: ['ENG'], user: 'vishal26.arivihan@gmail.com' }); console.log('FAIL: worked without OIDC token'); }
  catch (e) { console.log('ok   no OIDC token ->', e.message.slice(0, 90)); }
  host.setOidcToken('vercel-oidc');
  const v = JSON.parse(await host.runJob({ fn: 'webInit', args: ['ENG'], user: 'vishal26.arivihan@gmail.com' }));
  console.log(v.allowed && v.isAdmin ? 'ok   webInit with keyless Google access' : 'FAIL ' + JSON.stringify(v).slice(0, 200));
  console.log('calls:', G.LOG.filter(x => /sts|iamcredentials/.test(x)).join(' | '));
})();
