'use strict';
// Test double for Google Sheets / Drive / OAuth / Internal Metrics, installed as global fetch.
const BOOKS = {};
const LOG = [];
let IM = { handler: null };

function serial(y, m, d) { return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; }
function cell(v) {
  if (v && typeof v === 'object' && 'raw' in v) return v;
  if (typeof v === 'string' && v.charAt(0) === '=') return { raw: '', f: v, disp: '' };
  return { raw: v === undefined || v === null ? '' : v, f: null, disp: v === undefined || v === null ? '' : String(v) };
}
function addBook(id, title, tabs) {
  const b = { id: id, title: title, tz: 'Asia/Kolkata', sheets: [], nextId: 100, perms: [{ id: 'p0', type: 'user', role: 'owner', emailAddress: 'owner@x.com' }] };
  Object.keys(tabs).forEach((name, i) => {
    b.sheets.push({ sheetId: i === 0 ? 0 : b.nextId++, title: name, index: i, hidden: false, rowCount: 1000, colCount: 26, grid: tabs[name].map(r => r.map(cell)), fmt: {} });
  });
  BOOKS[id] = b;
  return b;
}
function colN(s) { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function parseRange(b, rs) {
  rs = decodeURIComponent(rs);
  let title, ref = '';
  const m = rs.match(/^'((?:[^']|'')*)'(?:!(.*))?$/);
  if (m) { title = m[1].replace(/''/g, "'"); ref = m[2] || ''; }
  else { const i = rs.indexOf('!'); title = i >= 0 ? rs.slice(0, i) : rs; ref = i >= 0 ? rs.slice(i + 1) : ''; }
  const sh = b.sheets.find(s => s.title === title);
  if (!sh) throw { code: 400, msg: 'Unable to parse range: ' + rs };
  let r1 = 1, c1 = 1, r2 = sh.rowCount, c2 = sh.colCount;
  let mm;
  if ((mm = ref.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i))) { r1 = +mm[2]; c1 = colN(mm[1]); r2 = mm[3] ? +mm[4] : r1; c2 = mm[3] ? colN(mm[3]) : c1; }
  else if ((mm = ref.match(/^([A-Z]+):([A-Z]+)$/i))) { c1 = colN(mm[1]); c2 = colN(mm[2]); }
  return { sh, r1, c1, r2, c2 };
}
function userEntered(v) {
  if (typeof v !== 'string') return cell(v);
  if (v.charAt(0) === '=') return { raw: '', f: v, disp: '' };
  if (v.charAt(0) === "'") return { raw: v.slice(1), f: null, disp: v.slice(1) };
  if (/^-?\d+(\.\d+)?$/.test(v)) return { raw: Number(v), f: null, disp: v };
  if (/^(true|false)$/i.test(v)) return { raw: /true/i.test(v), f: null, disp: v.toUpperCase() };
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { raw: serial(+m[1], +m[2], +m[3]), f: null, disp: m[3] + '/' + m[2] + '/' + m[1] };
  return { raw: v, f: null, disp: v };
}
function setCells(sh, r1, c1, values, raw) {
  values.forEach((row, i) => row.forEach((v, j) => {
    const R = r1 - 1 + i, C = c1 - 1 + j;
    while (sh.grid.length <= R) sh.grid.push([]);
    while (sh.grid[R].length <= C) sh.grid[R].push(cell(''));
    sh.grid[R][C] = raw ? cell(v === '' ? '' : String(v)) : userEntered(v);
    if (R + 1 > sh.rowCount) throw { code: 400, msg: 'Range exceeds grid limits' };
  }));
}
function getValues(sh, q, kind) {
  const out = [];
  for (let r = q.r1; r <= Math.min(q.r2, sh.grid.length); r++) {
    const row = sh.grid[r - 1] || [], o = [];
    for (let c = q.c1; c <= Math.min(q.c2, row.length); c++) {
      const x = row[c - 1] || cell('');
      o.push(kind === 'FORMULA' ? (x.f || x.raw) : kind === 'FORMATTED_VALUE' ? x.disp : x.raw);
    }
    while (o.length && (o[o.length - 1] === '' || o[o.length - 1] === null)) o.pop();
    out.push(o);
  }
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}

function J(code, obj) { return new Response(JSON.stringify(obj), { status: code, headers: { 'content-type': 'application/json' } }); }

async function handle(url, opts) {
  const u = new URL(url);
  const method = (opts.method || 'GET').toUpperCase();
  const body = opts.body ? (typeof opts.body === 'string' ? opts.body : Buffer.from(opts.body).toString('utf8')) : '';
  LOG.push(method + ' ' + u.host + u.pathname + (u.search.length < 160 ? u.search : u.search.slice(0, 160)));
  if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') return J(200, { access_token: 'mock-sa-token', expires_in: 3600 });
  if (u.host === 'sts.googleapis.com') {
    const j = JSON.parse(body);
    if (j.subjectToken !== 'vercel-oidc' || !/workloadIdentityPools\/vercel\/providers\/vercel$/.test(j.audience)) return J(400, { error: 'invalid_grant', error_description: 'bad subject token' });
    return J(200, { access_token: 'federated', expires_in: 3600 });
  }
  if (u.host === 'iamcredentials.googleapis.com') {
    if ((opts.headers || {}).authorization !== 'Bearer federated') return J(403, { error: { message: 'Permission iam.serviceAccounts.getAccessToken denied' } });
    return J(200, { accessToken: 'mock-sa-token', expireTime: new Date(Date.now() + 3600e3).toISOString() });
  }
  if (u.host === 'sheets.googleapis.com') {
    const m = u.pathname.match(/^\/v4\/spreadsheets\/([^/:]+)(.*)$/);
    const b = BOOKS[m[1]];
    if (!b) return J(404, { error: { message: 'Requested entity was not found.' } });
    const rest = m[2];
    const auth = (opts.headers || {}).authorization;
    if (auth !== 'Bearer mock-sa-token') return J(401, { error: { message: 'no auth' } });
    try {
      if (rest === '' && method === 'GET') {
        if (u.searchParams.get('includeGridData') === 'true') {
          const q = parseRange(b, u.searchParams.get('ranges'));
          const rowData = [];
          for (let r = q.r1; r <= Math.min(q.r2, q.sh.grid.length); r++) {
            const row = q.sh.grid[r - 1] || [];
            rowData.push({ values: row.slice(q.c1 - 1, q.c2).map(x => {
              const ev = x.raw === '' ? undefined : typeof x.raw === 'number' ? { numberValue: x.raw } : typeof x.raw === 'boolean' ? { boolValue: x.raw } : { stringValue: String(x.raw) };
              const isDate = typeof x.raw === 'number' && /\//.test(x.disp);
              const o = { effectiveValue: ev, formattedValue: x.disp === '' ? undefined : x.disp, effectiveFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { bold: false },
                       numberFormat: isDate ? { type: 'DATE', pattern: 'dd/mm/yyyy' } : undefined } };
              if (x.f) o.userEnteredValue = { formulaValue: x.f };
              return o;
            }) });
          }
          return J(200, { sheets: [{ data: [{ rowData: rowData, rowMetadata: q.sh.grid.map(() => ({ pixelSize: 21 })), columnMetadata: [{ pixelSize: 100 }] }] }] });
        }
        return J(200, { spreadsheetId: b.id, properties: { title: b.title, timeZone: b.tz },
          sheets: b.sheets.map(s => ({ properties: { sheetId: s.sheetId, title: s.title, index: s.index, hidden: s.hidden, gridProperties: { rowCount: s.rowCount, columnCount: s.colCount } } })) });
      }
      let mm;
      if ((mm = rest.match(/^\/values\/([^:]+)$/)) && method === 'GET') {
        const q = parseRange(b, mm[1]);
        let vals = getValues(q.sh, q, u.searchParams.get('valueRenderOption'));
        if (u.searchParams.get('majorDimension') === 'COLUMNS') { const w = Math.max(0, ...vals.map(r => r.length)); vals = Array.from({ length: w }, (_, j) => vals.map(r => r[j] === undefined ? '' : r[j])); }
        return J(200, { range: mm[1], values: vals });
      }
      if ((mm = rest.match(/^\/values\/([^:]+)$/)) && method === 'PUT') {
        const q = parseRange(b, mm[1]); const j = JSON.parse(body);
        setCells(q.sh, q.r1, q.c1, j.values, u.searchParams.get('valueInputOption') === 'RAW');
        return J(200, {});
      }
      if ((mm = rest.match(/^\/values\/(.+):append$/)) && method === 'POST') {
        const q = parseRange(b, mm[1]); const j = JSON.parse(body);
        const r = q.sh.grid.length + 1;
        if (r > q.sh.rowCount) q.sh.rowCount = r;
        setCells(q.sh, r, 1, j.values, u.searchParams.get('valueInputOption') === 'RAW');
        return J(200, { updates: { updatedRange: "'" + q.sh.title + "'!A" + r + ':I' + r } });
      }
      if (rest === '/values:batchUpdate') {
        const j = JSON.parse(body);
        j.data.forEach(d => { const q = parseRange(b, d.range); setCells(q.sh, q.r1, q.c1, d.values, j.valueInputOption === 'RAW'); });
        return J(200, {});
      }
      if (rest === ':batchUpdate') {
        const j = JSON.parse(body), replies = [];
        j.requests.forEach(rq => {
          const k = Object.keys(rq)[0], v = rq[k];
          const S = id => b.sheets.find(s => s.sheetId === id);
          if (k === 'addSheet') { const s = { sheetId: b.nextId++, title: v.properties.title || 'Sheet' + b.nextId, index: b.sheets.length, hidden: false, rowCount: 1000, colCount: 26, grid: [], fmt: {} }; b.sheets.push(s); replies.push({ addSheet: { properties: { sheetId: s.sheetId, title: s.title, index: s.index, gridProperties: { rowCount: 1000, columnCount: 26 } } } }); return; }
          if (k === 'deleteSheet') { b.sheets = b.sheets.filter(s => s.sheetId !== v.sheetId); }
          else if (k === 'updateSheetProperties') { const s = S(v.properties.sheetId); if ('title' in v.properties) s.title = v.properties.title; if ('hidden' in v.properties) s.hidden = v.properties.hidden; }
          else if (k === 'appendDimension') { const s = S(v.sheetId); if (v.dimension === 'ROWS') s.rowCount += v.length; else s.colCount += v.length; }
          else if (k === 'insertDimension') { const s = S(v.range.sheetId); const n = v.range.endIndex - v.range.startIndex; if (v.range.dimension === 'ROWS') { s.rowCount += n; s.grid.splice(v.range.startIndex, 0, ...Array.from({ length: n }, () => [])); } else s.colCount += n; }
          else if (k === 'deleteDimension') { const s = S(v.range.sheetId); const n = v.range.endIndex - v.range.startIndex; if (v.range.dimension === 'ROWS') { s.rowCount -= n; s.grid.splice(v.range.startIndex, n); } else { s.colCount -= n; s.grid.forEach(r => r.splice(v.range.startIndex, n)); } }
          else if (k === 'updateCells' && /userEnteredValue/.test(v.fields || '')) { const s = S(v.range.sheetId); if (v.range.startRowIndex === undefined) s.grid = []; }
          else if (k === 'sortRange') {
            const s = S(v.range.sheetId), spec = v.sortSpecs[0];
            const part = s.grid.slice(v.range.startRowIndex, v.range.endRowIndex);
            part.sort((a, c) => { const x = (a[spec.dimensionIndex] || {}).raw, y = (c[spec.dimensionIndex] || {}).raw; return (x > y ? 1 : x < y ? -1 : 0) * (spec.sortOrder === 'DESCENDING' ? -1 : 1); });
            s.grid.splice(v.range.startRowIndex, part.length, ...part);
          }
          replies.push({});
        });
        return J(200, { replies: replies });
      }
      if ((mm = rest.match(/^\/sheets\/(\d+):copyTo$/))) {
        const j = JSON.parse(body), src = b.sheets.find(s => s.sheetId === +mm[1]), dst = BOOKS[j.destinationSpreadsheetId];
        const s = { sheetId: dst.nextId++, title: 'Copy of ' + src.title, index: dst.sheets.length, hidden: false, rowCount: src.rowCount, colCount: src.colCount, grid: JSON.parse(JSON.stringify(src.grid)), fmt: {} };
        dst.sheets.push(s);
        return J(200, { sheetId: s.sheetId, title: s.title, index: s.index, gridProperties: { rowCount: s.rowCount, columnCount: s.colCount } });
      }
      return J(400, { error: { message: 'mock: unsupported ' + method + ' ' + rest } });
    } catch (e) { return J(e.code || 500, { error: { message: e.msg || String(e) } }); }
  }
  if (u.host === 'www.googleapis.com' && u.pathname.indexOf('/drive/v3/files/') === 0) {
    const m = u.pathname.match(/files\/([^/]+)(\/permissions)?(?:\/([^/]+))?$/), b = BOOKS[m[1]];
    if (!b) return J(404, { error: { message: 'File not found' } });
    if (!m[2]) return J(200, { name: b.title });
    if (method === 'GET') return J(200, { permissions: b.perms });
    if (method === 'POST') { const j = JSON.parse(body); b.perms.push({ id: 'p' + b.perms.length + 1, type: 'user', role: j.role, emailAddress: j.emailAddress }); return J(200, {}); }
    if (method === 'DELETE') { b.perms = b.perms.filter(p => p.id !== m[3]); return new Response(null, { status: 204 }); }
  }
  if (u.host === 'oauth2.googleapis.com' && u.pathname === '/tokeninfo') {
    const t = u.searchParams.get('id_token');
    if (t === 'good') return J(200, { aud: process.env.GOOGLE_CLIENT_ID, iss: 'https://accounts.google.com', email: 'vishal26.arivihan@gmail.com', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 600) });
    return J(400, { error: 'invalid_token' });
  }
  if (/arivihan\.com$/.test(u.host)) {
    if (IM.handler) { const r = IM.handler(u, method, opts, body); if (r) return r; }
    if ((opts.headers || {}).avtoken !== 'GOODTOKEN1234' && (opts.headers || {}).avtoken !== 'STAGETOKEN5678') return J(401, { message: 'unauthorized' });
    return J(200, { content: [], data: [] });
  }
  if (u.host === 'docs.google.com') return new Response(Buffer.from('PK-fake-xlsx'), { status: 200, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
  return J(404, { error: 'mock: no route ' + u.host });
}

function install() { global.fetch = (url, opts) => handle(String(url), opts || {}); }
module.exports = { install, addBook, BOOKS, LOG, IM, serial };
