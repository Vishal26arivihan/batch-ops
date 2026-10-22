'use strict';
// Local stand-in for Vercel: serves public/ and the api/ functions (with mocked Google). Port from argv.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_SA_JSON = process.env.GOOGLE_SA_JSON || JSON.stringify({ client_email: 'bot@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
process.env.ENC_KEY = process.env.ENC_KEY || crypto.randomBytes(32).toString('base64');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || 'test-client.apps.googleusercontent.com';

const G = require('./mockgoogle');
G.install();
require('./fixtures').load(G);

const ROOT = path.join(__dirname, '..');
const api = { rpc: require('../api/rpc'), auth: require('../api/auth'), config: require('../api/config') };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  // Vercel-style helpers
  res.status = c => { res.statusCode = c; return res; };
  res.json = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); return res; };
  res.send = b => { res.end(b); return res; };
  req.headers['x-forwarded-host'] = req.headers.host;
  const m = u.pathname.match(/^\/api\/(\w+)$/);
  if (m && api[m[1]]) {
    // local http: drop "Secure" so the browser keeps the cookie
    const set = res.setHeader.bind(res);
    res.setHeader = (k, v) => set(k, /set-cookie/i.test(k) ? String(v).replace('; Secure', '') : v);
    try { await api[m[1]](req, res); } catch (e) { res.statusCode = 500; res.end(String(e)); }
    return;
  }
  let f = path.join(ROOT, 'public', u.pathname === '/' ? 'index.html' : u.pathname);
  if (!path.extname(f) && fs.existsSync(f + '.html')) f += '.html';
  if (!f.startsWith(path.join(ROOT, 'public')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', TYPES[path.extname(f)] || 'application/octet-stream');
  fs.createReadStream(f).pipe(res);
}).listen(Number(process.argv[2] || 3999), () => console.log('dev server on', process.argv[2] || 3999));
