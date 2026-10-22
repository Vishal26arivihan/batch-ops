'use strict';
// POST {credential} = Google sign-in (ID token)  ->  session cookie
// DELETE                                         ->  sign out
const session = require('../lib/session');

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!session.sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Wrong origin' });
  if (req.method === 'DELETE') { session.clear(res); return res.status(200).json({ ok: true }); }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  try {
    const clientId = String(process.env.GOOGLE_CLIENT_ID || '');
    if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not set in the Vercel environment variables.');
    const b = await body(req);
    const cred = String(b.credential || '');
    if (!cred || cred.length > 4096) throw new Error('No Google sign-in received.');
    // Google checks the signature of the ID token for us
    const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(cred));
    const t = await r.json();
    if (r.status !== 200 || !t.email) throw new Error('Google sign-in could not be verified.');
    if (t.aud !== clientId) throw new Error('This sign-in was made for a different app.');
    if (!/^(https:\/\/)?accounts\.google\.com$/.test(String(t.iss || ''))) throw new Error('Unexpected sign-in issuer.');
    if (String(t.email_verified) !== 'true') throw new Error('Your Google email is not verified.');
    if (!(Number(t.exp) * 1000 > Date.now())) throw new Error('The sign-in has expired – try again.');
    session.set(res, t.email);
    return res.status(200).json({ ok: true, email: String(t.email).toLowerCase() });
  } catch (e) {
    return res.status(401).json({ ok: false, error: String(e.message || e) });
  }
};
