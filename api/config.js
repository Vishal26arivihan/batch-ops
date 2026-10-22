'use strict';
// Public settings for the page (Google client id) + who is signed in.
const session = require('../lib/session');

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let s = null;
  try { s = session.read(req); } catch (e) { return res.status(500).json({ ok: false, error: String(e.message || e) }); }
  res.status(200).json({ ok: true, clientId: process.env.GOOGLE_CLIENT_ID || '', email: s ? s.email : '' });
};
