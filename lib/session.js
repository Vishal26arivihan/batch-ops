'use strict';
// Signed session cookie (HttpOnly, Secure). The Google sign-in is checked once in /api/auth.
const crypto = require('crypto');

const COOKIE = 'bo_sess';
const LIFE_SEC = 12 * 3600;                    // sign in again after 12 hours

function secret() {
  const s = String(process.env.SESSION_SECRET || '');
  if (s.length < 32) throw new Error('SESSION_SECRET is missing or too short (min 32 characters) in the Vercel environment variables.');
  return s;
}
const b64u = s => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const unb64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const sign = data => crypto.createHmac('sha256', secret()).update(data).digest('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function make(email) {
  const data = b64u(JSON.stringify({ e: String(email).toLowerCase(), exp: Date.now() + LIFE_SEC * 1000, n: crypto.randomBytes(6).toString('hex') }));
  return data + '.' + sign(data);
}
function read(req) {
  const v = parseCookies(req)[COOKIE];
  if (!v) return null;
  const [data, sig] = v.split('.');
  if (!data || !sig) return null;
  const good = sign(data);
  if (good.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig))) return null;
  try {
    const o = JSON.parse(unb64u(data));
    if (!o.e || !(o.exp > Date.now())) return null;
    return { email: o.e, exp: o.exp };
  } catch (e) { return null; }
}
function cookie(value, maxAge) {
  return COOKIE + '=' + encodeURIComponent(value) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge;
}
function set(res, email) { res.setHeader('Set-Cookie', cookie(make(email), LIFE_SEC)); }
function clear(res) { res.setHeader('Set-Cookie', cookie('', 0)); }

/** Blocks calls from other websites (the dashboard always calls its own address). */
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers['x-forwarded-host'] || new URL(o).host === req.headers.host; } catch (e) { return false; }
}

module.exports = { read, set, clear, sameOrigin, LIFE_SEC };
