'use strict';
// POST {fn, args}: runs one dashboard function (same names as google.script.run in Apps Script).
const session = require('../lib/session');
const { runJob, setOidcToken } = require('../lib/host');

// Only these functions can be called from the browser (the internal helpers ending in _ never can).
const ALLOWED = new Set([
  'webInit', 'webSetEnv', 'webTokenStatus', 'webTokenSave', 'webTokenClear',
  'webLectureLoad', 'webLectureSave', 'webLectureClear', 'webPush', 'webTool', 'webPdfImport', 'webPdfUpdate',
  'webTodayFile', 'webTodayLogs', 'webPreview', 'webApply',
  'webUploadInfo', 'webUploadNow', 'webUploadSetFlag', 'webUploadHistory',
  'webDppList', 'webDppSetFlags', 'webDppSetSchedule', 'webDppUpload', 'webClearCache',
  'webThumbInfo', 'webThumbFetch', 'webThumbSaveLink', 'webFiles',
  'webAddClassInfo', 'webAddClassPlan', 'webAddClass',
  'adminUiHtml', 'adminStatus', 'adminSetupPassword', 'adminLogin', 'adminLogout', 'adminChangePassword', 'adminData',
  'adminAddUser', 'adminRemoveUser', 'adminSetRole', 'adminSetFeatures', 'adminShareFiles', 'adminResetUserToken',
  'adminSetSharedOk', 'adminSetSharedToken', 'adminSetFreeze', 'adminSetRate', 'adminRestore', 'adminVerifyLogs',
  'adminBackupNow', 'adminBackupSchedule',
  'vercelSetupStatus', 'vercelImportSettings'
]);

async function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return {}; }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  if (!session.sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Wrong origin' });
  let s;
  try { s = session.read(req); } catch (e) { return res.status(500).json({ ok: false, error: String(e.message || e) }); }
  if (!s) return res.status(401).json({ ok: false, error: 'SIGN_IN_REQUIRED' });
  const b = await body(req);
  const fn = String(b.fn || '');
  const args = Array.isArray(b.args) ? b.args : [];
  if (!ALLOWED.has(fn)) return res.status(400).json({ ok: false, error: 'Unknown function: ' + fn });
  setOidcToken(req.headers['x-vercel-oidc-token']);          // keyless Google access (Workload Identity Federation)
  // keep active users signed in (renew when less than half of the session is left)
  if (s.exp - Date.now() < session.LIFE_SEC * 500) session.set(res, s.email);
  try {
    const json = await runJob({ fn: fn, args: args, user: s.email }, { appUrl: 'https://' + (req.headers['x-forwarded-host'] || req.headers.host || '') });
    res.setHeader('content-type', 'application/json; charset=utf-8');
    return res.status(200).send('{"ok":true,"value":' + json + '}');
  } catch (e) {
    console.error('[rpc]', fn, s.email, e.message, e.workerStack || '');
    return res.status(200).json({ ok: false, error: String(e.message || e) });
  }
};
