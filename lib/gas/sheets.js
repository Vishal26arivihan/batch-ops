'use strict';
// SpreadsheetApp for Node (Google Sheets API v4 + Drive v3, signed in as the service account).
// Reads: a tab is loaded once (formulas + display values + raw values, in parallel) and served from memory.
// Writes: queued in order and sent in batches (before the next read of that file, on flush, and at the end of the request).
const { hostCall } = require('./bridge');
const T = require('./time');

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';
const DRIVE = 'https://www.googleapis.com/drive/v3/files/';

// ---------- low level ----------
function dec(u8) { return Buffer.from(u8 || []).toString('utf8'); }
function apiErr(r, what) {
  let msg = 'HTTP ' + r.code;
  try { const j = JSON.parse(dec(r.body)); if (j.error && j.error.message) msg = j.error.message; } catch (e) {}
  if (r.code === 429) msg = 'Google Sheets is busy (too many reads in the last minute by all dashboard users). Please wait 1–2 minutes and try again.';
  else if (r.code === 403 || r.code === 404) msg += ' – check that the file is shared with the service account (Editor).';
  return new Error((what ? what + ': ' : '') + msg);
}
function req(method, url, body) {
  return { url: url, method: method, sa: true,
           headers: body !== undefined ? { 'content-type': 'application/json' } : {},
           body: body !== undefined ? JSON.stringify(body) : null };
}
function call1(method, url, body, what) {
  const r = hostCall('fetch', req(method, url, body));
  if (r.code < 200 || r.code >= 300) throw apiErr(r, what);
  const t = dec(r.body);
  return t ? JSON.parse(t) : {};
}
function callAll(list, what) {
  const rs = hostCall('fetchAll', list);
  return rs.map(r => {
    if (r.code < 200 || r.code >= 300) throw apiErr(r, what);
    const t = dec(r.body);
    return t ? JSON.parse(t) : {};
  });
}

// ---------- A1 helpers ----------
function colToN(s) { let n = 0; for (const ch of String(s).toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function nToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
function qTitle(t) { return "'" + String(t).replace(/'/g, "''") + "'"; }
function a1(r, c, nr, nc) { return nToCol(c) + r + ':' + nToCol(c + nc - 1) + (r + nr - 1); }

function hex2rgb(h) {
  const m = String(h || '').trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}
function rgb2hex(c, dflt) {
  if (!c) return dflt;
  const h = x => Math.round((x || 0) * 255).toString(16).padStart(2, '0');
  return '#' + h(c.red) + h(c.green) + h(c.blue);
}

const DATE_LIKE = /^(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}(\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?)?|\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?|.*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b.*\d.*)$/i;
const LOOKS_PARSED = /^\s*([+-]?[\d.,]+%?|\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}.*|\d{1,2}:\d{2}.*|true|false)\s*$/i;

let OPEN = {};            // spreadsheets opened in this request

// Append-only log tabs grow forever: they are never read in full. Only the rows that are asked for are read,
// the last row number is remembered (TAIL hook -> settings store) and new rows are added with "append".
const TAIL_TABS = new Set(['Logs', 'Token History', 'Restore Points']);
let TAIL_HOOK = null;
function setTailHook(h) { TAIL_HOOK = h; }
function resetRequest() { OPEN = {}; }

// ---------- Spreadsheet ----------
class Spreadsheet {
  constructor(id) { this.id = id; this.meta = null; this.sheets = null; this.queue = []; this.perms = null; }
  _meta() {
    if (this.meta) return this.meta;
    // SPEED / QUOTA: the list of tabs is kept in server memory for 60 s (dropped when this server changes the tabs)
    let m = null;
    try { const c = hostCall('cache', { op: 'get', scope: 'meta', key: this.id }); if (c) m = JSON.parse(c); } catch (e) { m = null; }
    if (!m) {
      m = call1('GET', SHEETS + this.id + '?fields=' + encodeURIComponent(
        'spreadsheetId,spreadsheetUrl,properties(title,timeZone),sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount,frozenRowCount)))'),
        undefined, 'Open spreadsheet ' + this.id);
      try { hostCall('cache', { op: 'put', scope: 'meta', key: this.id, value: JSON.stringify(m), ttl: 60 }); } catch (e) {}
    }
    this.meta = m;
    this.sheets = (this.meta.sheets || []).map(s => new Sheet(this, s.properties));
    return this.meta;
  }
  _metaChanged() { try { hostCall('cache', { op: 'remove', scope: 'meta', key: this.id }); } catch (e) {} }
  tz() { return this._meta().properties.timeZone || 'Asia/Kolkata'; }
  getId() { return this.id; }
  getName() { return this._meta().properties.title; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id + '/edit'; }
  getSpreadsheetTimeZone() { return this.tz(); }
  getSheets() { this._meta(); return this.sheets.slice().sort((a, b) => a.p.index - b.p.index); }
  getSheetByName(name) {
    this._meta();
    return this.sheets.find(s => s.p.title === name) ||
           this.sheets.find(s => s.p.title.toLowerCase() === String(name).toLowerCase()) || null;
  }
  getSheetById(id) { this._meta(); return this.sheets.find(s => s.p.sheetId === id) || null; }
  getActiveSheet() { return this.getSheets()[0]; }
  setActiveSheet(s) { return s; }
  moveActiveSheet() {}
  insertSheet(name) {
    this.flush();
    const r = call1('POST', SHEETS + this.id + ':batchUpdate', { requests: [{ addSheet: { properties: name ? { title: String(name) } : {} } }] }, 'Insert sheet');
    const sh = new Sheet(this, r.replies[0].addSheet.properties);
    this._meta(); this.sheets.push(sh); this._metaChanged();
    return sh;
  }
  deleteSheet(sh) {
    this.flush();
    call1('POST', SHEETS + this.id + ':batchUpdate', { requests: [{ deleteSheet: { sheetId: sh.p.sheetId } }] }, 'Delete sheet');
    this.sheets = this.sheets.filter(x => x !== sh); this._metaChanged();
  }
  // --- sharing (Drive permissions) ---
  _perms(force) {
    if (!this.perms || force) {
      const out = [];
      let page = '';
      do {
        const r = call1('GET', DRIVE + this.id + '/permissions?supportsAllDrives=true&fields=nextPageToken,permissions(id,type,role,emailAddress)' + (page ? '&pageToken=' + page : ''), undefined, 'Read sharing');
        (r.permissions || []).forEach(p => out.push(p));
        page = r.nextPageToken || '';
      } while (page);
      this.perms = out;
    }
    return this.perms;
  }
  _users(roles) { return this._perms().filter(p => p.type === 'user' && roles.indexOf(p.role) >= 0).map(p => new User(p.emailAddress)); }
  getEditors() { return this._users(['owner', 'organizer', 'fileOrganizer', 'writer']); }
  getViewers() { return this._users(['reader', 'commenter']); }
  getOwner() { return this._users(['owner'])[0] || null; }
  addEditor(email) {
    call1('POST', DRIVE + this.id + '/permissions?supportsAllDrives=true&sendNotificationEmail=false',
      { type: 'user', role: 'writer', emailAddress: String(email) }, 'Share');
    this.perms = null; return this;
  }
  _removeUser(email, roles) {
    const e = String(email).toLowerCase();
    this._perms(true).filter(p => String(p.emailAddress || '').toLowerCase() === e && roles.indexOf(p.role) >= 0).forEach(p => {
      call1('DELETE', DRIVE + this.id + '/permissions/' + p.id + '?supportsAllDrives=true', undefined, 'Remove access');
    });
    this.perms = null; return this;
  }
  removeEditor(email) { return this._removeUser(email, ['writer']); }
  removeViewer(email) { return this._removeUser(email, ['reader', 'commenter']); }

  // --- write queue ---
  push(item) { this.queue.push(item); }
  flush() {
    if (!this.queue.length) return;
    const q = this.queue; this.queue = [];
    // grow the grid where values are written beyond it
    const grow = [];
    const need = {};
    q.forEach(it => {
      if (it.type !== 'values') return;
      const k = it.sheet.p.sheetId, n = need[k] || (need[k] = { sh: it.sheet, r: 0, c: 0 });
      n.r = Math.max(n.r, it.r + it.nr - 1); n.c = Math.max(n.c, it.c + it.nc - 1);
    });
    Object.keys(need).forEach(k => {
      const n = need[k], g = n.sh.p.gridProperties;
      if (n.r > g.rowCount) { grow.push({ appendDimension: { sheetId: n.sh.p.sheetId, dimension: 'ROWS', length: n.r - g.rowCount } }); g.rowCount = n.r; }
      if (n.c > g.columnCount) { grow.push({ appendDimension: { sheetId: n.sh.p.sheetId, dimension: 'COLUMNS', length: n.c - g.columnCount } }); g.columnCount = n.c; }
    });
    if (grow.length) { call1('POST', SHEETS + this.id + ':batchUpdate', { requests: grow }, 'Grow sheet'); this._metaChanged(); }
    // send in order: runs of value writes / runs of format requests
    let i = 0;
    while (i < q.length) {
      const t = q[i].type, run = [];
      while (i < q.length && q[i].type === t) run.push(q[i++]);
      if (t === 'values') {
        call1('POST', SHEETS + this.id + '/values:batchUpdate', {
          valueInputOption: 'USER_ENTERED',
          data: run.map(it => ({ range: qTitle(it.sheet.p.title) + '!' + a1(it.r, it.c, it.nr, it.nc), majorDimension: 'ROWS', values: it.values }))
        }, 'Write to ' + this.getName());
      } else {
        call1('POST', SHEETS + this.id + ':batchUpdate', { requests: run.map(it => it.request) }, 'Update ' + this.getName());
        if (run.some(it => /Dimension|SheetProperties|addSheet|deleteSheet/.test(Object.keys(it.request)[0]))) this._metaChanged();
      }
    }
  }
}

class User { constructor(e) { this.e = e || ''; } getEmail() { return this.e; } }

// ---------- Sheet ----------
class Sheet {
  constructor(ss, props) {
    this.ss = ss; this.p = props;
    if (!this.p.gridProperties) this.p.gridProperties = { rowCount: 1000, columnCount: 26 };
    this.g = null; this.dirty = false; this.dims = null;
  }
  _load() {
    if (this.ss.queue.length) this.ss.flush();
    if (this.g && !this.dirty) return this.g;
    // one read: formulas + values + display text + number type of every cell
    const r = call1('GET', SHEETS + this.ss.id + '?includeGridData=true&ranges=' + encodeURIComponent(qTitle(this.p.title)) +
      '&fields=' + encodeURIComponent('sheets(data(rowData(values(userEnteredValue(formulaValue),effectiveValue,formattedValue,effectiveFormat(numberFormat(type))))))'),
      undefined, 'Read ' + this.p.title);
    const rows = ((((r.sheets || [])[0] || {}).data || [{}])[0].rowData) || [];
    const tz = this.ss.tz();
    const F = [], D = [], U = [];
    rows.forEach(row => {
      const f = [], d = [], u = [];
      (row.values || []).forEach(c => {
        const ev = c.effectiveValue, fv = c.userEnteredValue && c.userEnteredValue.formulaValue;
        let raw = '';
        if (ev) {
          if (ev.numberValue !== undefined) {
            const t = ((c.effectiveFormat || {}).numberFormat || {}).type;
            raw = (t === 'DATE' || t === 'TIME' || t === 'DATE_TIME') ? T.serialToDate(ev.numberValue, tz) : ev.numberValue;
          } else if (ev.stringValue !== undefined) raw = ev.stringValue;
          else if (ev.boolValue !== undefined) raw = ev.boolValue;
          else if (ev.errorValue) raw = c.formattedValue || '#ERROR!';
        }
        u.push(raw); d.push(c.formattedValue === undefined ? '' : c.formattedValue);
        f.push(fv || (raw instanceof Date ? (c.formattedValue || '') : raw));
      });
      F.push(f); D.push(d); U.push(u);
    });
    let lastRow = 0, lastCol = 0;
    F.forEach((row, i) => {
      let lc = row.length;
      while (lc > 0 && (row[lc - 1] === '' || row[lc - 1] == null)) lc--;
      if (lc > 0) lastRow = i + 1;
      lastCol = Math.max(lastCol, lc);
    });
    this.g = { F: F, D: D, U: U, lastRow: lastRow, lastCol: lastCol };
    this.dirty = false;
    return this.g;
  }
  _invalidate() { this.dirty = true; this.dims = null; this.part = null; }
  getName() { return this.p.title; }
  getSheetName() { return this.p.title; }
  getSheetId() { return this.p.sheetId; }
  getIndex() { return (this.p.index || 0) + 1; }
  getParent() { return this.ss; }
  isSheetHidden() { return !!this.p.hidden; }
  _isTail() { return TAIL_TABS.has(this.p.title) && !this.g; }
  getLastRow() { return this._isTail() ? this._tailLast() : this._load().lastRow; }
  getLastColumn() {
    if (!this._isTail()) return this._load().lastCol;
    const h = this._partial(1, 1, 1, Math.max(1, this.p.gridProperties.columnCount), 'D')[0];
    let n = h.length; while (n > 0 && h[n - 1] === '') n--;
    return n;
  }
  _tailLast() {
    if (this.tl !== undefined) return this.tl;
    let v = TAIL_HOOK ? Number(TAIL_HOOK.get(this.ss.id, this.p.title)) || 0 : 0;
    if (v) {
      // rows added from outside (the Apps Script dashboard, by hand) -> the remembered number is too small: count again
      this.ss.flush();
      const r = call1('GET', SHEETS + this.ss.id + '/values/' + encodeURIComponent(qTitle(this.p.title) + '!A' + (v + 1) + ':A' + (v + 200)) + '?majorDimension=COLUMNS&valueRenderOption=FORMATTED_VALUE', undefined, 'Read ' + this.p.title);
      if ((((r.values || [])[0]) || []).some(x => x !== '')) v = 0;
    }
    if (!v) {
      this.ss.flush();
      const r = call1('GET', SHEETS + this.ss.id + '/values/' + encodeURIComponent(qTitle(this.p.title) + '!A:A') + '?majorDimension=COLUMNS&valueRenderOption=FORMATTED_VALUE', undefined, 'Read ' + this.p.title);
      const col = ((r.values || [])[0]) || [];
      let n = col.length; while (n > 0 && col[n - 1] === '') n--;
      v = n;
      if (TAIL_HOOK && v) TAIL_HOOK.set(this.ss.id, this.p.title, v);
    }
    this.tl = v;
    return v;
  }
  _partial(r, c, nr, nc, kind) {
    this.ss.flush();
    const key = kind + r + ',' + c + ',' + nr + ',' + nc;
    this.part = this.part || {};
    if (!this.part[key]) {
      const opt = kind === 'D' ? 'FORMATTED_VALUE' : kind === 'F' ? 'FORMULA' : 'UNFORMATTED_VALUE';
      const res = call1('GET', SHEETS + this.ss.id + '/values/' + encodeURIComponent(qTitle(this.p.title) + '!' + a1(r, c, nr, nc)) +
        '?majorDimension=ROWS&valueRenderOption=' + opt, undefined, 'Read ' + this.p.title);
      const v = res.values || [], out = [];
      for (let i = 0; i < nr; i++) {
        const row = v[i] || [], o = [];
        for (let j = 0; j < nc; j++) {
          let x = row[j]; if (x === undefined || x === null) x = '';
          if (kind === 'D') x = String(x);
          if (kind === 'F') x = typeof x === 'string' && x.charAt(0) === '=' ? x : '';
          o.push(x);
        }
        out.push(o);
      }
      this.part[key] = out;
    }
    return this.part[key].map(row => row.slice());
  }
  getMaxRows() { this.ss.flush(); return this.p.gridProperties.rowCount; }
  getMaxColumns() { this.ss.flush(); return this.p.gridProperties.columnCount; }
  getFrozenRows() { return this.p.gridProperties.frozenRowCount || 0; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') return Range.fromA1(this, a);
    return new Range(this, a, b, c === undefined ? 1 : c, d === undefined ? 1 : d);
  }
  getDataRange() { const g = this._load(); return new Range(this, 1, 1, Math.max(1, g.lastRow), Math.max(1, g.lastCol)); }
  appendRow(vals) {
    if (this._isTail()) {
      this.ss.flush();
      const out = toSheetValues([vals], this.ss.tz()).values;
      const res = call1('POST', SHEETS + this.ss.id + '/values/' + encodeURIComponent(qTitle(this.p.title) + '!A:' + nToCol(Math.max(1, vals.length))) +
        ':append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS', { majorDimension: 'ROWS', values: out }, 'Add row to ' + this.p.title);
      const m = String(((res.updates || {}).updatedRange) || '').match(/![A-Z]+(\d+)/);
      if (m) { this.tl = +m[1]; if (TAIL_HOOK) TAIL_HOOK.set(this.ss.id, this.p.title, this.tl); } else this.tl = undefined;
      this.part = null;
      this.ss._metaChanged();
      return this;
    }
    const g = this._load();
    const r = g.lastRow + 1;
    new Range(this, r, 1, 1, vals.length).setValues([vals]);
    return this;
  }
  _req(request) { this.ss.push({ type: 'req', request: request }); }
  _gridRange() { return { sheetId: this.p.sheetId }; }
  setName(name) {
    this._req({ updateSheetProperties: { properties: { sheetId: this.p.sheetId, title: String(name) }, fields: 'title' } });
    this.ss.flush(); this.p.title = String(name); this.g = null; return this;
  }
  setFrozenRows(n) { this._req({ updateSheetProperties: { properties: { sheetId: this.p.sheetId, gridProperties: { frozenRowCount: n } }, fields: 'gridProperties.frozenRowCount' } }); return this; }
  hideSheet() { this._req({ updateSheetProperties: { properties: { sheetId: this.p.sheetId, hidden: true }, fields: 'hidden' } }); this.p.hidden = true; return this; }
  showSheet() { this._req({ updateSheetProperties: { properties: { sheetId: this.p.sheetId, hidden: false }, fields: 'hidden' } }); this.p.hidden = false; return this; }
  clear() {
    this._req({ updateCells: { range: this._gridRange(), fields: 'userEnteredValue,userEnteredFormat' } });
    this.ss.flush(); this._invalidate(); return this;
  }
  clearContents() { this._req({ updateCells: { range: this._gridRange(), fields: 'userEnteredValue' } }); this.ss.flush(); this._invalidate(); return this; }
  _dim(kind, start, end) { return { sheetId: this.p.sheetId, dimension: kind, startIndex: start, endIndex: end }; }
  insertRowsAfter(after, n) {
    this._req({ insertDimension: { range: this._dim('ROWS', after, after + n), inheritFromBefore: after > 0 } });
    this.ss.flush(); this.p.gridProperties.rowCount += n; this._invalidate(); return this;
  }
  insertRowsBefore(before, n) {
    this._req({ insertDimension: { range: this._dim('ROWS', before - 1, before - 1 + n), inheritFromBefore: before > 1 } });
    this.ss.flush(); this.p.gridProperties.rowCount += n; this._invalidate(); return this;
  }
  insertColumnsAfter(after, n) {
    this._req({ insertDimension: { range: this._dim('COLUMNS', after, after + n), inheritFromBefore: after > 0 } });
    this.ss.flush(); this.p.gridProperties.columnCount += n; this._invalidate(); return this;
  }
  deleteRows(start, n) {
    this._req({ deleteDimension: { range: this._dim('ROWS', start - 1, start - 1 + n) } });
    this.ss.flush(); this.p.gridProperties.rowCount -= n; this._invalidate(); return this;
  }
  deleteRow(r) { return this.deleteRows(r, 1); }
  deleteColumn(c) {
    this._req({ deleteDimension: { range: this._dim('COLUMNS', c - 1, c) } });
    this.ss.flush(); this.p.gridProperties.columnCount -= 1; this._invalidate(); return this;
  }
  _dims() {
    if (this.dims) return this.dims;
    this.ss.flush();
    const r = call1('GET', SHEETS + this.ss.id + '?includeGridData=true&ranges=' + encodeURIComponent(qTitle(this.p.title)) +
      '&fields=' + encodeURIComponent('sheets(data(rowMetadata(pixelSize),columnMetadata(pixelSize)))'), undefined, 'Read sizes');
    const d = ((r.sheets || [])[0] || {}).data || [{}];
    this.dims = { rows: (d[0].rowMetadata || []).map(x => x.pixelSize || 21), cols: (d[0].columnMetadata || []).map(x => x.pixelSize || 100) };
    return this.dims;
  }
  getColumnWidth(c) { return this._dims().cols[c - 1] || 100; }
  getRowHeight(r) { return this._dims().rows[r - 1] || 21; }
  setColumnWidth(c, w) { return this.setColumnWidths(c, 1, w); }
  setColumnWidths(c, n, w) {
    this._req({ updateDimensionProperties: { range: this._dim('COLUMNS', c - 1, c - 1 + n), properties: { pixelSize: w }, fields: 'pixelSize' } });
    this.dims = null; return this;
  }
  setRowHeight(r, h) {
    this._req({ updateDimensionProperties: { range: this._dim('ROWS', r - 1, r), properties: { pixelSize: h }, fields: 'pixelSize' } });
    this.dims = null; return this;
  }
  protect() {
    const self = this, st = { desc: '' };
    const o = {
      setDescription(d) { st.desc = String(d || ''); return o; },
      setWarningOnly(w) {
        self._req({ addProtectedRange: { protectedRange: { range: self._gridRange(), description: st.desc, warningOnly: !!w } } });
        return o;
      },
      removeEditors() { return o; }, addEditor() { return o; }
    };
    return o;
  }
  copyTo(dest) {
    this.ss.flush(); dest.flush();
    const p = call1('POST', SHEETS + this.ss.id + '/sheets/' + this.p.sheetId + ':copyTo', { destinationSpreadsheetId: dest.id }, 'Copy sheet');
    dest._meta();
    const sh = new Sheet(dest, p);
    dest.sheets.push(sh);
    return sh;
  }
  activate() { return this; }
}

/** JS values -> values for a USER_ENTERED write (+ whether the sheet will convert some of them) */
function toSheetValues(vals, tz) {
  let parsed = false;
  const values = vals.map(row => row.map(v => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) { parsed = true; return T.dateToSheetText(v, tz); }
    if (typeof v === 'string') {
      if (v.charAt(0) === '=' || (v.charAt(0) !== "'" && LOOKS_PARSED.test(v))) parsed = true;
      return v;
    }
    if (typeof v === 'number' || typeof v === 'boolean') { parsed = true; return v; }
    return String(v);
  }));
  return { values: values, parsed: parsed };
}

// ---------- Range ----------
const CopyPasteType = { PASTE_FORMAT: 'PASTE_FORMAT', PASTE_DATA_VALIDATION: 'PASTE_DATA_VALIDATION', PASTE_VALUES: 'PASTE_VALUES', PASTE_NORMAL: 'PASTE_NORMAL', PASTE_FORMULA: 'PASTE_FORMULA' };
const BorderStyle = { SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM', SOLID_THICK: 'SOLID_THICK', DASHED: 'DASHED', DOTTED: 'DOTTED', DOUBLE: 'DOUBLE' };
const WrapStrategy = { WRAP: 'WRAP', OVERFLOW: 'OVERFLOW_CELL', CLIP: 'CLIP' };

class Range {
  constructor(sheet, r, c, nr, nc) {
    if (!(nr >= 1) || !(nc >= 1)) throw new Error('The number of rows / columns in the range must be at least 1.');
    this.sh = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc;
  }
  static fromA1(sh, s) {
    s = String(s).trim().replace(/^.*!/, '').replace(/\$/g, '').toUpperCase();
    let m = s.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
    if (m) {
      const r1 = +m[2], c1 = colToN(m[1]), r2 = m[3] ? +m[4] : r1, c2 = m[3] ? colToN(m[3]) : c1;
      return new Range(sh, Math.min(r1, r2), Math.min(c1, c2), Math.abs(r2 - r1) + 1, Math.abs(c2 - c1) + 1);
    }
    m = s.match(/^([A-Z]+):([A-Z]+)$/);
    if (m) { const c1 = colToN(m[1]), c2 = colToN(m[2]); return new Range(sh, 1, Math.min(c1, c2), sh.getMaxRows(), Math.abs(c2 - c1) + 1); }
    m = s.match(/^(\d+):(\d+)$/);
    if (m) { const r1 = +m[1], r2 = +m[2]; return new Range(sh, Math.min(r1, r2), 1, Math.abs(r2 - r1) + 1, sh.getMaxColumns()); }
    throw new Error('Range not found: ' + s);
  }
  getSheet() { return this.sh; }
  getRow() { return this.r; }
  getColumn() { return this.c; }
  getLastRow() { return this.r + this.nr - 1; }
  getLastColumn() { return this.c + this.nc - 1; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getA1Notation() { return this.nr === 1 && this.nc === 1 ? nToCol(this.c) + this.r : a1(this.r, this.c, this.nr, this.nc); }
  getCell(r, c) { return new Range(this.sh, this.r + r - 1, this.c + c - 1, 1, 1); }
  offset(r, c, nr, nc) { return new Range(this.sh, this.r + r, this.c + c, nr || this.nr, nc || this.nc); }
  _grid(kind) {
    if (this.sh._isTail()) return this.sh._partial(this.r, this.c, this.nr, this.nc, kind);
    const g = this.sh._load()[kind], out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = g[this.r - 1 + i] || [], o = [];
      for (let j = 0; j < this.nc; j++) {
        let v = row[this.c - 1 + j];
        if (v === undefined || v === null) v = '';
        if (kind === 'D') v = String(v);
        if (kind === 'F') v = typeof v === 'string' && v.charAt(0) === '=' ? v : '';
        o.push(v);
      }
      out.push(o);
    }
    return out;
  }
  getValues() { return this._grid('U'); }
  getValue() { return this._grid('U')[0][0]; }
  getDisplayValues() { return this._grid('D'); }
  getDisplayValue() { return this._grid('D')[0][0]; }
  getFormulas() { return this._grid('F'); }
  getFormula() { return this._grid('F')[0][0]; }
  isBlank() { return this._grid('F').every(r => r.every(v => v === '')) && this._grid('D').every(r => r.every(v => v === '')); }

  setValue(v) { return this.setValues(Array.from({ length: this.nr }, () => Array.from({ length: this.nc }, () => v))); }
  setFormula(f) { return this.setValue(f); }
  setFormulas(f) { return this.setValues(f); }
  setValues(vals) {
    if (!Array.isArray(vals) || vals.length !== this.nr || vals.some(r => !Array.isArray(r) || r.length !== this.nc)) {
      throw new Error('The number of rows or columns in the data does not match the range (' + this.nr + 'x' + this.nc + ').');
    }
    const conv = toSheetValues(vals, this.sh.ss.tz()), out = conv.values, parsed = conv.parsed;
    this.sh.part = null;
    this.sh.ss.push({ type: 'values', sheet: this.sh, r: this.r, c: this.c, nr: this.nr, nc: this.nc, values: out });
    // keep the cached copy in step (or reload it on the next read when the sheet will convert the values)
    const g = this.sh.g;
    if (g && !this.sh.dirty) {
      if (parsed) this.sh.dirty = true;
      else {
        out.forEach((row, i) => row.forEach((v, j) => {
          const R = this.r - 1 + i, C = this.c - 1 + j, txt = String(v).charAt(0) === "'" ? String(v).slice(1) : String(v);
          ['F', 'D', 'U'].forEach(k => { const G = g[k]; while (G.length <= R) G.push([]); while (G[R].length <= C) G[R].push(''); G[R][C] = txt; });
          if (txt !== '') { g.lastRow = Math.max(g.lastRow, R + 1); g.lastCol = Math.max(g.lastCol, C + 1); }
        }));
        if (out.some(r => r.some(v => v === ''))) this.sh.dirty = true;       // cleared cells may change lastRow
      }
    }
    return this;
  }
  clearContent() { return this.setValues(Array.from({ length: this.nr }, () => Array.from({ length: this.nc }, () => ''))); }
  clear() {
    this.sh._req({ updateCells: { range: this._gr(), fields: 'userEnteredValue,userEnteredFormat' } });
    this.sh._invalidate(); return this;
  }
  clearFormat() { this.sh._req({ updateCells: { range: this._gr(), fields: 'userEnteredFormat' } }); return this; }
  clearDataValidations() { this.sh._req({ setDataValidation: { range: this._gr() } }); return this; }
  _gr() { return { sheetId: this.sh.p.sheetId, startRowIndex: this.r - 1, endRowIndex: this.r - 1 + this.nr, startColumnIndex: this.c - 1, endColumnIndex: this.c - 1 + this.nc }; }

  // ----- formats -----
  _fmt() {
    this.sh.ss.flush();
    const r = call1('GET', SHEETS + this.sh.ss.id + '?includeGridData=true&ranges=' + encodeURIComponent(qTitle(this.sh.p.title) + '!' + a1(this.r, this.c, this.nr, this.nc)) +
      '&fields=' + encodeURIComponent('sheets(data(rowData(values(effectiveFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy),dataValidation))))'), undefined, 'Read format');
    const rows = ((((r.sheets || [])[0] || {}).data || [{}])[0].rowData) || [];
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const vs = (rows[i] && rows[i].values) || [], o = [];
      for (let j = 0; j < this.nc; j++) o.push(vs[j] || {});
      out.push(o);
    }
    return out;
  }
  _map(fn) { return this._fmt().map(r => r.map(c => fn(c.effectiveFormat || {}, c))); }
  getBackgrounds() { return this._map(f => rgb2hex(f.backgroundColor, '#ffffff')); }
  getBackground() { return this.getBackgrounds()[0][0]; }
  getFontColors() { return this._map(f => rgb2hex((f.textFormat || {}).foregroundColor, '#000000')); }
  getFontFamilies() { return this._map(f => (f.textFormat || {}).fontFamily || 'Arial'); }
  getFontSizes() { return this._map(f => (f.textFormat || {}).fontSize || 10); }
  getFontWeights() { return this._map(f => ((f.textFormat || {}).bold ? 'bold' : 'normal')); }
  getFontStyles() { return this._map(f => ((f.textFormat || {}).italic ? 'italic' : 'normal')); }
  getHorizontalAlignments() { return this._map(f => (f.horizontalAlignment ? String(f.horizontalAlignment).toLowerCase() : 'general')); }
  getVerticalAlignments() { return this._map(f => (f.verticalAlignment ? String(f.verticalAlignment).toLowerCase() : 'bottom')); }
  getWrapStrategies() { return this._map(f => f.wrapStrategy || 'OVERFLOW_CELL'); }
  getDataValidation() {
    const dv = this._fmt()[0][0].dataValidation;
    if (!dv) return null;
    const cond = dv.condition || {}, vals = (cond.values || []).map(v => v.userEnteredValue);
    return {
      getCriteriaType: () => cond.type,
      getCriteriaValues: () => (cond.type === 'ONE_OF_LIST' ? [vals, dv.showCustomUi !== false] : vals)
    };
  }
  getDataValidations() { return [[this.getDataValidation()]]; }
  _setFmt(field, grid, conv) {
    const rows = grid.map(r => ({ values: r.map(v => { const f = {}; conv(f, v); return { userEnteredFormat: f }; }) }));
    this.sh._req({ updateCells: { range: this._gr(), rows: rows, fields: field } });
    return this;
  }
  _fill(v) { return Array.from({ length: this.nr }, () => Array.from({ length: this.nc }, () => v)); }
  setBackgrounds(g) { return this._setFmt('userEnteredFormat.backgroundColor', g, (f, v) => { const c = hex2rgb(v); if (c) f.backgroundColor = c; }); }
  setBackground(c) { return this.setBackgrounds(this._fill(c)); }
  setFontColors(g) { return this._setFmt('userEnteredFormat.textFormat.foregroundColor', g, (f, v) => { const c = hex2rgb(v); f.textFormat = c ? { foregroundColor: c } : {}; }); }
  setFontColor(c) { return this.setFontColors(this._fill(c)); }
  setFontFamilies(g) { return this._setFmt('userEnteredFormat.textFormat.fontFamily', g, (f, v) => { f.textFormat = { fontFamily: v || 'Arial' }; }); }
  setFontSizes(g) { return this._setFmt('userEnteredFormat.textFormat.fontSize', g, (f, v) => { f.textFormat = { fontSize: Number(v) || 10 }; }); }
  setFontWeights(g) { return this._setFmt('userEnteredFormat.textFormat.bold', g, (f, v) => { f.textFormat = { bold: v === 'bold' }; }); }
  setFontWeight(w) { return this.setFontWeights(this._fill(w)); }
  setFontStyles(g) { return this._setFmt('userEnteredFormat.textFormat.italic', g, (f, v) => { f.textFormat = { italic: v === 'italic' }; }); }
  setHorizontalAlignments(g) {
    return this._setFmt('userEnteredFormat.horizontalAlignment', g, (f, v) => {
      const s = String(v || '').toLowerCase();
      if (/left/.test(s) && s !== 'general') f.horizontalAlignment = 'LEFT';
      else if (/center/.test(s)) f.horizontalAlignment = 'CENTER';
      else if (/right/.test(s)) f.horizontalAlignment = 'RIGHT';
    });
  }
  setVerticalAlignments(g) {
    return this._setFmt('userEnteredFormat.verticalAlignment', g, (f, v) => {
      const s = String(v || '').toLowerCase();
      f.verticalAlignment = s === 'top' ? 'TOP' : s === 'middle' ? 'MIDDLE' : 'BOTTOM';
    });
  }
  setWrapStrategies(g) { return this._setFmt('userEnteredFormat.wrapStrategy', g, (f, v) => { f.wrapStrategy = String(v || 'OVERFLOW_CELL').replace(/^OVERFLOW$/, 'OVERFLOW_CELL'); }); }
  setNumberFormat(fmt) {
    const f = String(fmt);
    const nf = f === '@' ? { type: 'TEXT' } : /^general$/i.test(f) ? null : { type: 'NUMBER', pattern: f };
    this.sh._req({ repeatCell: { range: this._gr(), cell: { userEnteredFormat: nf ? { numberFormat: nf } : {} }, fields: 'userEnteredFormat.numberFormat' } });
    if (nf && nf.type === 'TEXT') this.sh._invalidate();
    return this;
  }
  setNumberFormats(g) { return this.setNumberFormat(g[0][0]); }
  setBorder(top, left, bottom, right, vertical, horizontal, color, style) {
    const b = on => (on ? { style: style || 'SOLID', color: hex2rgb(color || '#000000') } : on === false ? { style: 'NONE' } : undefined);
    const req = { range: this._gr() };
    [['top', top], ['left', left], ['bottom', bottom], ['right', right], ['innerVertical', vertical], ['innerHorizontal', horizontal]]
      .forEach(x => { const v = b(x[1]); if (v) req[x[0]] = v; });
    this.sh._req({ updateBorders: req });
    return this;
  }
  setFontWeightsAll() { return this; }
  sort(spec) {
    const specs = [].concat(spec).map(s => (typeof s === 'number' ? { column: s, ascending: true } : s))
      .map(s => ({ dimensionIndex: s.column - 1, sortOrder: s.ascending === false ? 'DESCENDING' : 'ASCENDING' }));
    this.sh._req({ sortRange: { range: this._gr(), sortSpecs: specs } });
    this.sh.ss.flush(); this.sh._invalidate();
    return this;
  }
  copyTo(dst, type) {
    const pasteType = typeof type === 'string' ? type : 'PASTE_NORMAL';
    if (dst.sh.ss !== this.sh.ss) throw new Error('copyTo between different files is not supported');
    this.sh._req({ copyPaste: { source: this._gr(), destination: dst._gr(), pasteType: pasteType } });
    if (pasteType === 'PASTE_NORMAL' || pasteType === 'PASTE_VALUES' || pasteType === 'PASTE_FORMULA') dst.sh._invalidate();
    return this;
  }
  activate() { return this; }
}

// ---------- SpreadsheetApp ----------
function idFromUrl(url) {
  const m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new Error('Not a Google Sheets link: ' + url);
  return m[1];
}
const SpreadsheetApp = {
  openById(id) {
    if (!id) throw new Error('Spreadsheet id is empty');
    if (!OPEN[id]) OPEN[id] = new Spreadsheet(id);
    OPEN[id]._meta();
    return OPEN[id];
  },
  openByUrl(url) { return SpreadsheetApp.openById(idFromUrl(url)); },
  getActiveSpreadsheet() { return null; },
  getActive() { return null; },
  getUi() { throw new Error('The sheet menu is not available on Vercel.'); },
  flush() { Object.keys(OPEN).forEach(k => OPEN[k].flush()); },
  create() { throw new Error('Creating a new Google Sheet is not available on Vercel (service accounts have no Drive storage).'); },
  CopyPasteType: CopyPasteType,
  BorderStyle: BorderStyle,
  WrapStrategy: WrapStrategy
};

/** Typed cells of a tab (for building .xlsx files): [{t:'n'|'s'|'b', v, fmt}] per row */
function typedGrid(spreadsheetId, title) {
  const ss = SpreadsheetApp.openById(spreadsheetId);
  ss.flush();
  const r = call1('GET', SHEETS + spreadsheetId + '?includeGridData=true&ranges=' + encodeURIComponent(qTitle(title)) +
    '&fields=' + encodeURIComponent('sheets(data(rowData(values(effectiveValue,formattedValue,effectiveFormat(numberFormat)))))'), undefined, 'Read ' + title);
  const rows = ((((r.sheets || [])[0] || {}).data || [{}])[0].rowData) || [];
  return rows.map(row => (row.values || []).map(c => {
    const ev = c.effectiveValue;
    if (!ev) return null;
    if (ev.numberValue !== undefined) return { t: 'n', v: ev.numberValue, nf: (c.effectiveFormat || {}).numberFormat || null, txt: c.formattedValue };
    if (ev.boolValue !== undefined) return { t: 'b', v: ev.boolValue };
    if (ev.stringValue !== undefined) return { t: 's', v: ev.stringValue };
    if (ev.errorValue) return { t: 's', v: c.formattedValue || '#ERROR' };
    return null;
  }));
}

module.exports = { setTailHook, SpreadsheetApp, Spreadsheet, Sheet, Range, resetRequest, typedGrid, call1, callAll, idFromUrl, qTitle, SHEETS, DRIVE, dec };
