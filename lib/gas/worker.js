'use strict';
// Runs ONE dashboard call: a fresh, isolated copy of the Apps Script code (Code.gs + Admin.gs + vercel.gs)
// with Node versions of the Google services. Nothing is shared with other users' calls.
// SPEED: the worker is started (modules loaded, .gs files compiled) before the call arrives; it still runs only one call.
const { workerData, parentPort } = require('worker_threads');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const bridge = require('./bridge');
const sheets = require('./sheets');
const { makeServices, Blob } = require('./services');
const { Store } = require('./store');
const xlsx = require('./xlsx');

const gasDir = workerData.gasDir;
const scripts = ['Code.gs', 'Admin.gs', 'vercel.gs'].map(f => new vm.Script(fs.readFileSync(path.join(gasDir, f), 'utf8'), { filename: f }));

function run(m) {
  const job = m.job;
  sheets.resetRequest();
  let ctx = null;
  const store = new Store(() => {
    const id = vm.runInContext('BOOK_ID', ctx);
    return sheets.SpreadsheetApp.openById(id);
  }, { cached: !!m.cachedStore });
  sheets.setTailHook({
    get: (id, title) => store.get('TAILROW|' + id + '|' + title),
    set: (id, title, n) => store.set('TAILROW|' + id + '|' + title, String(n))
  });
  const svc = makeServices({ user: job.user, saEmail: m.saEmail, store: store, gasDir: gasDir, appUrl: m.appUrl });
  const g = Object.assign({
    console: console,
    SpreadsheetApp: sheets.SpreadsheetApp,
    // helpers used only by vercel.gs
    __typedGrid: sheets.typedGrid,
    __xlsx: xlsx.build,
    __Blob: Blob,
    __refresh: sh => { sh._invalidate(); return sh; },     // next read of this tab comes fresh from Google
    __job: { user: job.user, appUrl: m.appUrl }
  }, svc);
  ctx = vm.createContext(g);
  scripts.forEach(s => s.runInContext(ctx));
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

parentPort.once('message', m => {
  bridge.setChannel(m.sab, m.port);
  try {
    parentPort.postMessage({ ok: true, json: run(m) });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String(e && e.message ? e.message : e), stack: e && e.stack ? String(e.stack).slice(0, 2000) : '' });
  }
});
