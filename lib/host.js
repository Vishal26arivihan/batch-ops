'use strict';
// Main thread: runs each dashboard call in a worker and does the async work for it
// (HTTP, service-account token, memory cache, locks). Never blocks.
const { Worker, MessageChannel } = require('worker_threads');
const crypto = require('crypto');
const path = require('path');

const GAS_DIR = path.join(__dirname, '..', 'gas');
const WORKER = path.join(__dirname, 'gas', 'worker.js');

// ---------- service account ----------
// Two ways to act as the service account:
//  1) Keyless (recommended): Vercel OIDC + Google Workload Identity Federation (GCP_* variables)
//  2) JSON key in GOOGLE_SA_JSON (only if the Google organisation policy allows keys)
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'];
let SA = null;
let OIDC = '';                                  // latest Vercel OIDC token (sent by Vercel with every request)
function setOidcToken(t) { if (t) OIDC = String(t); }
function sa() {
  if (SA) return SA;
  if (process.env.GOOGLE_SA_JSON) {
    let j;
    try { j = JSON.parse(process.env.GOOGLE_SA_JSON); } catch (e) { throw new Error('GOOGLE_SA_JSON is not valid JSON in the Vercel environment variables.'); }
    if (!j.client_email || !j.private_key) throw new Error('GOOGLE_SA_JSON does not contain client_email / private_key.');
    SA = { mode: 'key', email: j.client_email, key: j.private_key, token: null, exp: 0 };
    return SA;
  }
  const need = ['GCP_PROJECT_NUMBER', 'GCP_SERVICE_ACCOUNT_EMAIL', 'GCP_WORKLOAD_IDENTITY_POOL_ID', 'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID'];
  const miss = need.filter(k => !process.env[k]);
  if (miss.length) throw new Error('Google access is not set up. Missing Vercel environment variables: ' + miss.join(', ') + '.');
  SA = { mode: 'wif', email: process.env.GCP_SERVICE_ACCOUNT_EMAIL, token: null, exp: 0,
         audience: '//iam.googleapis.com/projects/' + process.env.GCP_PROJECT_NUMBER + '/locations/global/workloadIdentityPools/' +
                   process.env.GCP_WORKLOAD_IDENTITY_POOL_ID + '/providers/' + process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID };
  return SA;
}
const b64u = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
async function keyToken(s) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: s.email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600, scope: SCOPES.join(' ') }));
  const sig = b64u(crypto.createSign('RSA-SHA256').update(head + '.' + body).sign(s.key));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + body + '.' + sig
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Service account sign-in failed: ' + (j.error_description || j.error || r.status));
  return { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
}
async function wifToken(s) {
  const oidc = OIDC || process.env.VERCEL_OIDC_TOKEN || '';
  if (!oidc) throw new Error('No Vercel OIDC token. In Vercel → Settings → Security, turn on "Secure Backend Access with OIDC Federation", then redeploy.');
  // 1) Vercel token -> Google federated token
  const r1 = await fetch('https://sts.googleapis.com/v1/token', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grantType: 'urn:ietf:params:oauth:grant-type:token-exchange', audience: s.audience,
      scope: 'https://www.googleapis.com/auth/cloud-platform', requestedTokenType: 'urn:ietf:params:oauth:token-type:access_token',
      subjectToken: oidc, subjectTokenType: 'urn:ietf:params:oauth:token-type:jwt' })
  });
  const j1 = await r1.json();
  if (!j1.access_token) throw new Error('Google did not accept the Vercel identity (step 1): ' + (j1.error_description || j1.error || r1.status) +
    '. Check the Workload Identity pool / provider (issuer URL and audience).');
  // 2) federated token -> short-lived token of the service account
  const r2 = await fetch('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' + encodeURIComponent(s.email) + ':generateAccessToken', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + j1.access_token },
    body: JSON.stringify({ scope: SCOPES, lifetime: '3600s' })
  });
  const j2 = await r2.json();
  if (!j2.accessToken) throw new Error('Could not act as the service account (step 2): ' + ((j2.error && j2.error.message) || r2.status) +
    '. Check that "IAM Service Account Credentials API" is enabled and the Vercel principal has the "Workload Identity User" role on the service account.');
  return { token: j2.accessToken, exp: Date.parse(j2.expireTime) || Date.now() + 3600000 };
}
let tokenPromise = null;
async function saToken() {
  const s = sa();
  if (s.token && Date.now() < s.exp - 120000) return s.token;
  if (tokenPromise) return tokenPromise;
  tokenPromise = (s.mode === 'key' ? keyToken(s) : wifToken(s)).then(t => { s.token = t.token; s.exp = t.exp; return t.token; });
  try { return await tokenPromise; } finally { tokenPromise = null; }
}

// ---------- HTTP ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function doFetch(q) {
  const headers = Object.assign({}, q.headers || {});
  if (q.sa) headers.authorization = 'Bearer ' + await saToken();
  let body = q.body;
  if (body && typeof body !== 'string') body = Buffer.from(body);
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(q.url, { method: q.method || 'GET', headers: headers, body: body === null || body === undefined || /^(GET|HEAD)$/i.test(q.method || 'GET') ? undefined : body,
                               redirect: q.follow === false ? 'manual' : 'follow' });
    } catch (e) {
      if (attempt < 2) { await sleep(500 * (attempt + 1)); continue; }
      throw new Error('Network error for ' + String(q.url).split('?')[0] + ': ' + (e.cause && e.cause.code ? e.cause.code : e.message));
    }
    // Google API quota (429) or a short outage (5xx): wait and try again
    if (q.sa && (r.status === 429 || r.status >= 500) && attempt < 5) { await sleep(Math.min(16000, 1000 * Math.pow(2, attempt)) + Math.random() * 400); continue; }
    const h = {};
    r.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
    return { code: r.status, headers: h, body: new Uint8Array(await r.arrayBuffer()) };
  }
}

// ---------- memory cache (per server instance) ----------
const CACHE = new Map();
function cacheOp(p) {
  const k = p.scope + '|' + p.key;
  if (p.op === 'get') {
    const e = CACHE.get(k);
    if (!e) return null;
    if (e.exp < Date.now()) { CACHE.delete(k); return null; }
    return e.v;
  }
  if (p.op === 'put') {
    if (CACHE.size > 5000) { const now = Date.now(); for (const [kk, e] of CACHE) if (e.exp < now) CACHE.delete(kk); }
    CACHE.set(k, { v: p.value, exp: Date.now() + (p.ttl || 600) * 1000 }); return null;
  }
  if (p.op === 'remove') { CACHE.delete(k); return null; }
  return null;
}

// ---------- settings copy (per server instance, see lib/gas/store.js) ----------
let STORE = null;                               // { ssId, map, at }
function storeOp(p) {
  if (p.op === 'get') return STORE && Date.now() - STORE.at < p.maxAge ? { ssId: STORE.ssId, map: STORE.map } : null;
  if (p.op === 'put') { STORE = { ssId: p.ssId, map: p.map, at: Date.now() }; return null; }
  if (p.op === 'patch' && STORE && STORE.ssId === p.ssId) { if (p.e) STORE.map[p.k] = p.e; else delete STORE.map[p.k]; }
  return null;
}

// ---------- locks (per server instance) ----------
const LOCKS = {};
function lockAcquire(name, owner, timeout) {
  return new Promise(resolve => {
    const L = LOCKS[name] || (LOCKS[name] = { owner: null, waiters: [] });
    if (!L.owner) { L.owner = owner; return resolve(true); }
    if (!timeout) return resolve(false);
    const w = { owner: owner, resolve: resolve };
    w.timer = setTimeout(() => { L.waiters = L.waiters.filter(x => x !== w); resolve(false); }, timeout);
    L.waiters.push(w);
  });
}
function lockRelease(name, owner) {
  const L = LOCKS[name];
  if (!L || L.owner !== owner) return;
  const w = L.waiters.shift();
  if (w) { clearTimeout(w.timer); L.owner = w.owner; w.resolve(true); } else L.owner = null;
}
function releaseAll(owner) { Object.keys(LOCKS).forEach(n => lockRelease(n, owner)); }

async function hostOp(op, p, owner) {
  switch (op) {
    case 'fetch': return doFetch(p);
    case 'fetchAll': return Promise.all(p.map(doFetch));
    case 'saToken': return saToken();
    case 'cache': return cacheOp(p);
    case 'store': return storeOp(p);
    case 'lock': return p.op === 'acquire' ? lockAcquire(p.name, owner, p.timeout) : (lockRelease(p.name, owner), true);
    default: throw new Error('Unknown host operation ' + op);
  }
}

// ---------- run one call ----------
// Calls that only read: they may use the settings copy in memory (up to 15 s old).
// Everything else (pushes, uploads, sheet writes, admin, tokens, freeze check before a change) reads the settings fresh.
const READ_ONLY = new Set(['webInit', 'webTodayFile', 'webTodayLogs', 'webLectureLoad', 'webDppList', 'webFiles',
  'webThumbInfo', 'webUploadInfo', 'webUploadHistory', 'webPreview', 'webTokenStatus']);

// SPEED: a few workers are started ahead of time, so a call does not wait for a worker to start
// (Today sends 7 calls at once). Every worker still runs only one call and is then stopped.
const SPARES = 3;
let spares = [];
function newWorker() {
  const w = new Worker(WORKER, { workerData: { gasDir: GAS_DIR }, resourceLimits: { maxOldGenerationSizeMb: 1024 } });
  const drop = () => { spares = spares.filter(x => x !== w); };
  w.on('error', drop);
  w.on('exit', drop);
  w.unref();                                    // an idle spare never keeps the process alive
  return w;
}
function refill() { setImmediate(() => { while (spares.length < SPARES) spares.push(newWorker()); }); }
function takeWorker() {
  const w = spares.shift() || newWorker();
  w.ref();
  refill();
  return w;
}
refill();                                       // ready before the first call

let seq = 0;
function runJob(job, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const owner = 'job' + (++seq);
    const sab = new SharedArrayBuffer(4), flag = new Int32Array(sab);
    const ch = new MessageChannel();
    let finished = false;
    const w = takeWorker();
    w.postMessage({ job: job, sab: sab, port: ch.port2, saEmail: sa().email, appUrl: opts.appUrl || '', cachedStore: READ_ONLY.has(job.fn) },
                  [ch.port2]);
    const done = (fn, v) => { if (finished) return; finished = true; clearTimeout(timer); releaseAll(owner); ch.port1.close(); w.terminate(); fn(v); };
    const timer = setTimeout(() => done(reject, new Error('The server took too long (over ' + Math.round((opts.timeoutMs || 280000) / 1000) + ' s). Nothing more was done – check the result before trying again.')), opts.timeoutMs || 280000);
    ch.port1.on('message', async m => {
      let res;
      try { res = { ok: true, value: await hostOp(m.op, m.payload, owner) }; }
      catch (e) { res = { ok: false, error: String(e && e.message ? e.message : e) }; }
      if (finished) return;
      ch.port1.postMessage(res);
      Atomics.store(flag, 0, 1);
      Atomics.notify(flag, 0);
    });
    w.on('message', m => {
      if (m.ok) done(resolve, m.json);
      else { const e = new Error(m.error); e.workerStack = m.stack; done(reject, e); }
    });
    w.on('error', e => done(reject, e));
    w.on('exit', code => { if (!finished) done(reject, new Error('Server worker stopped (code ' + code + ')')); });
  });
}

module.exports = { runJob, saToken, sa, setOidcToken };
