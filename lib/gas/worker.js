'use strict';
// Runs ONE dashboard call: a fresh, isolated copy of the Apps Script code (Code.gs + Admin.gs + vercel.gs)
// with Node versions of the Google services. Nothing is shared with other users' calls.
const { workerData, parentPort } = require('worker_threads');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const sheets = require('./sheets');
const { makeServices, Blob } = require('./services');
const { Store } = require('./store');
const xlsx = require('./xlsx');

const job = workerData.job;
const gasDir = workerData.gasDir;

function run() {
  sheets.resetRequest();
  let ctx = null;
  const store = new Store(() => {
    const id = vm.runInContext('BOOK_ID', ctx);
    return sheets.SpreadsheetApp.openById(id);
  });
  sheets.setTailHook({
    get: (id, title) => store.get('TAILROW|' + id + '|' + title),
    set: (id, title, n) => store.set('TAILROW|' + id + '|' + title, String(n))
  });
  const svc = makeServices({ user: job.user, saEmail: workerData.saEmail, store: store, gasDir: gasDir, appUrl: workerData.appUrl });
  const g = Object.assign({
    console: console,
    SpreadsheetApp: sheets.SpreadsheetApp,
    // helpers used only by vercel.gs
    __typedGrid: sheets.typedGrid,
    __xlsx: xlsx.build,
    __Blob: Blob,
    __refresh: sh => { sh._invalidate(); return sh; },     // next read of this tab comes fresh from Google
    __job: { user: job.user, appUrl: workerData.appUrl }
  }, svc);
  ctx = vm.createContext(g);
  ['Code.gs', 'Admin.gs', 'vercel.gs'].forEach(f => {
    const src = fs.readFileSync(path.join(gasDir, f), 'utf8');
    new vm.Script(src, { filename: f }).runInContext(ctx);
  });
  const fn = ctx[job.fn];
  if (typeof fn !== 'function') throw new Error('Unknown function: ' + job.fn);
  let result;
  try {
    result = fn.apply(null, job.args || []);
  } finally {
    try { sheets.SpreadsheetApp.flush(); } catch (e) { if (result !== undefined) throw e; }
  }
  return JSON.stringify(result === undefined ? null : result);
}

try {
  parentPort.postMessage({ ok: true, json: run() });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String(e && e.message ? e.message : e), stack: e && e.stack ? String(e.stack).slice(0, 2000) : '' });
}
