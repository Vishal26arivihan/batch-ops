'use strict';
// Settings store (replaces Apps Script Script/User Properties).
// Lives in a hidden tab of the Batch OPS sheet. Every value is encrypted (AES-256-GCM) with ENC_KEY,
// which exists only in the Vercel environment variables – the sheet alone never reveals tokens or hashes.
const crypto = require('crypto');
const { call1, SHEETS, qTitle } = require('./sheets');

const TAB = '_vercel_store';

let KEY = null;
function key32() {
  if (KEY) return KEY;
  const s = String(process.env.ENC_KEY || '');
  if (s.length < 32) throw new Error('ENC_KEY is missing or shorter than 32 characters in the Vercel environment variables.');
  KEY = crypto.createHash('sha256').update('batch-ops|' + s).digest();      // any long random text -> 32-byte key
  return KEY;
}
function enc(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key32(), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'v1.' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function decr(s) {
  s = String(s || '');
  if (s.indexOf('v1.') !== 0) return null;
  const b = Buffer.from(s.slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key32(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

class Store {
  constructor(getBook) { this.getBook = getBook; this.map = null; this.sh = null; }
  _load() {
    if (this.map) return;
    const ss = this.getBook();
    let sh = ss.getSheetByName(TAB);
    if (!sh) {
      sh = ss.insertSheet(TAB);
      sh.getRange(1, 1, 1, 3).setValues([['key', 'value (encrypted)', 'updated']]);
      try { sh.protect().setDescription('Batch OPS settings (encrypted) – do not edit').setWarningOnly(true); } catch (e) {}
      try { sh.hideSheet(); } catch (e) {}
      ss.flush();
    }
    this.sh = sh; this.ssId = ss.getId();
    const v = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues() : [];
    const m = {};
    v.forEach((r, i) => {
      const k = String(r[0] || '');
      if (!k) return;
      let val = null;
      try { val = decr(r[1]); } catch (e) { val = null; }
      m[k] = { row: i + 2, v: val };
    });
    this.map = m;
  }
  get(k) { this._load(); const e = this.map[k]; return e && e.v !== null ? e.v : null; }
  keys(prefix) { this._load(); return Object.keys(this.map).filter(k => k.indexOf(prefix) === 0 && this.map[k].v !== null); }
  _now() { return new Date().toISOString(); }
  set(k, v) {
    this._load();
    v = String(v);
    const e = this.map[k];
    if (e && e.v === v) return;                      // QUOTA: nothing changed -> no write
    const row = [k, enc(v), this._now()];
    if (e) {
      call1('PUT', SHEETS + this.ssId + '/values/' + encodeURIComponent(qTitle(TAB) + '!A' + e.row + ':C' + e.row) + '?valueInputOption=RAW',
        { values: [row] }, 'Save setting');
      e.v = v;
    } else {
      const r = call1('POST', SHEETS + this.ssId + '/values/' + encodeURIComponent(qTitle(TAB) + '!A:C') +
        ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS', { values: [row] }, 'Save setting');
      const m = String(((r.updates || {}).updatedRange) || '').match(/!A(\d+)/);
      this.map[k] = { row: m ? +m[1] : 0, v: v };
    }
  }
  del(k) {
    this._load();
    const e = this.map[k];
    if (!e) return;
    if (e.row) {
      call1('PUT', SHEETS + this.ssId + '/values/' + encodeURIComponent(qTitle(TAB) + '!A' + e.row + ':C' + e.row) + '?valueInputOption=RAW',
        { values: [['', '', this._now()]] }, 'Delete setting');
    }
    delete this.map[k];
  }
}

module.exports = { Store, enc, decr, TAB };
