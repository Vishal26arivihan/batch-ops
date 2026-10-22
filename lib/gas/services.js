'use strict';
// Apps Script services for Node: Utilities, UrlFetchApp, CacheService, LockService, PropertiesService,
// Session, ScriptApp, HtmlService, DriveApp, Logger.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { hostCall } = require('./bridge');
const T = require('./time');
const { call1, DRIVE } = require('./sheets');

// ---------- bytes ----------
function toBuf(x) {
  if (x == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(x)) return x;
  if (x instanceof Uint8Array) return Buffer.from(x);
  if (Array.isArray(x)) return Buffer.from(x.map(b => b & 255));
  if (x && typeof x.getBytes === 'function') return toBuf(x.getBytes());
  return Buffer.from(String(x), 'utf8');
}
const signed = buf => Array.from(buf, b => (b > 127 ? b - 256 : b));

// ---------- Blob ----------
class Blob {
  constructor(bytes, type, name) { this.b = toBuf(bytes); this.t = type || null; this.n = name || null; }
  getBytes() { return this.b; }
  getDataAsString() { return this.b.toString('utf8'); }
  getContentType() { return this.t; }
  setContentType(t) { this.t = t; return this; }
  getName() { return this.n; }
  setName(n) { this.n = n; return this; }
  copyBlob() { return new Blob(Buffer.from(this.b), this.t, this.n); }
  getBlob() { return this; }
}

// ---------- Utilities ----------
const Utilities = {
  DigestAlgorithm: { MD2: 'md5', MD5: 'md5', SHA_1: 'sha1', SHA_256: 'sha256', SHA_384: 'sha384', SHA_512: 'sha512' },
  Charset: { UTF_8: 'utf8', US_ASCII: 'ascii' },
  formatDate: (d, tz, p) => T.formatDate(d, tz, p),
  parseDate: (s, tz, p) => T.parseDate(s, tz, p),
  formatString: (fmt, ...a) => { let i = 0; return String(fmt).replace(/%[sdf]/g, () => String(a[i++])); },
  computeDigest: (alg, v) => signed(crypto.createHash(alg).update(toBuf(v)).digest()),
  computeHmacSha256Signature: (v, k) => signed(crypto.createHmac('sha256', toBuf(k)).update(toBuf(v)).digest()),
  computeHmacSignature: (alg, v, k) => signed(crypto.createHmac(String(alg).replace('md5', 'md5'), toBuf(k)).update(toBuf(v)).digest()),
  base64Encode: v => toBuf(v).toString('base64'),
  base64EncodeWebSafe: v => toBuf(v).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
  base64Decode: s => signed(Buffer.from(String(s), 'base64')),
  base64DecodeWebSafe: s => signed(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
  getUuid: () => crypto.randomUUID(),
  newBlob: (data, type, name) => new Blob(data, type, name),
  sleep: ms => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, Number(ms) || 0)); },
  jsonStringify: JSON.stringify,
  jsonParse: JSON.parse
};

// ---------- UrlFetchApp ----------
class HTTPResponse {
  constructor(r) { this.r = r; this.buf = toBuf(r.body); }
  getResponseCode() { return this.r.code; }
  getContentText() { return this.buf.toString('utf8'); }
  getBlob() { return new Blob(this.buf, String(this.r.headers['content-type'] || '').split(';')[0] || null, null); }
  getContent() { return signed(this.buf); }
  getHeaders() { return Object.assign({}, this.r.headers); }
  getAllHeaders() { return Object.assign({}, this.r.headers); }
}
function buildReq(url, p) {
  p = p || {};
  const headers = {};
  Object.keys(p.headers || {}).forEach(k => { headers[k] = String(p.headers[k]); });
  let body = null;
  const pl = p.payload;
  if (pl !== undefined && pl !== null) {
    if (typeof pl === 'string') {
      body = pl;
      if (!headers['content-type'] && !headers['Content-Type']) headers['content-type'] = p.contentType || 'application/x-www-form-urlencoded';
    } else if (pl instanceof Blob || Buffer.isBuffer(pl) || Array.isArray(pl)) {
      body = toBuf(pl);
      headers['content-type'] = p.contentType || (pl instanceof Blob && pl.getContentType()) || 'application/octet-stream';
    } else if (typeof pl === 'object') {
      const keys = Object.keys(pl);
      if (keys.some(k => pl[k] instanceof Blob)) {
        const bnd = '----batchops' + crypto.randomBytes(12).toString('hex');
        const parts = [];
        keys.forEach(k => {
          const v = pl[k];
          if (v instanceof Blob) {
            parts.push(Buffer.from('--' + bnd + '\r\nContent-Disposition: form-data; name="' + k + '"; filename="' + (v.getName() || 'file') +
              '"\r\nContent-Type: ' + (v.getContentType() || 'application/octet-stream') + '\r\n\r\n'));
            parts.push(v.getBytes()); parts.push(Buffer.from('\r\n'));
          } else {
            parts.push(Buffer.from('--' + bnd + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + String(v) + '\r\n'));
          }
        });
        parts.push(Buffer.from('--' + bnd + '--\r\n'));
        body = Buffer.concat(parts);
        headers['content-type'] = 'multipart/form-data; boundary=' + bnd;
      } else {
        body = keys.map(k => encodeURIComponent(k) + '=' + encodeURIComponent(String(pl[k]))).join('&');
        headers['content-type'] = p.contentType || 'application/x-www-form-urlencoded';
      }
    }
  }
  if (p.contentType && body !== null && !/multipart/.test(headers['content-type'] || '')) headers['content-type'] = p.contentType;
  return { url: String(url), method: String(p.method || 'get').toUpperCase(), headers: headers, body: body,
           follow: p.followRedirects !== false, mute: !!p.muteHttpExceptions };
}
function checkRes(q, r) {
  if (!q.mute && r.code >= 400) {
    throw new Error('Request failed for ' + q.url.split('?')[0] + ' returned code ' + r.code + '. Truncated server response: ' + toBuf(r.body).toString('utf8').slice(0, 200));
  }
  return new HTTPResponse(r);
}
const UrlFetchApp = {
  fetch(url, p) { const q = buildReq(url, p); return checkRes(q, hostCall('fetch', q)); },
  fetchAll(list) {
    const qs = list.map(x => (typeof x === 'string' ? buildReq(x, {}) : buildReq(x.url, x)));
    return hostCall('fetchAll', qs).map((r, i) => checkRes(qs[i], r));
  },
  getRequest(url, p) { return buildReq(url, p); }
};

// ---------- CacheService ----------
// Most entries live in the memory of the server (fast). Login-related entries must survive across servers,
// so they are kept in the encrypted store.
const PERSIST = /^(adm_session|adm_fail_|im_cache_clear)/;
function makeCache(scope, store) {
  const pk = k => 'cache|' + scope + '|' + k;
  return {
    get(k) {
      if (PERSIST.test(k)) {
        const raw = store.get(pk(k)); if (!raw) return null;
        try { const o = JSON.parse(raw); if (o.exp > Date.now()) return o.v; } catch (e) {}
        return null;
      }
      return hostCall('cache', { op: 'get', scope: scope, key: k });
    },
    getAll(keys) { const o = {}; keys.forEach(k => { const v = this.get(k); if (v !== null) o[k] = v; }); return o; },
    put(k, v, ttl) {
      const sec = Math.min(21600, Number(ttl) || 600);
      if (PERSIST.test(k)) {
        // QUOTA: an admin session that still has more than 25 of its 30 minutes is not re-written on every click
        try { const o = JSON.parse(store.get(pk(k)) || 'null'); if (o && o.v === String(v) && o.exp > Date.now() + sec * 1000 - 300000) return; } catch (e) {}
        store.set(pk(k), JSON.stringify({ v: String(v), exp: Date.now() + sec * 1000 })); return;
      }
      hostCall('cache', { op: 'put', scope: scope, key: k, value: String(v), ttl: sec });
    },
    putAll(obj, ttl) { Object.keys(obj).forEach(k => this.put(k, obj[k], ttl)); },
    remove(k) {
      if (PERSIST.test(k)) { store.del(pk(k)); return; }
      hostCall('cache', { op: 'remove', scope: scope, key: k });
    },
    removeAll(keys) { (keys || []).forEach(k => this.remove(k)); }
  };
}

// ---------- PropertiesService ----------
function makeProps(prefix, store) {
  return {
    getProperty: k => store.get(prefix + k),
    setProperty(k, v) { store.set(prefix + k, v); return this; },
    setProperties(obj, del) {
      if (del) store.keys(prefix).forEach(k => { if (!(k.slice(prefix.length) in obj)) store.del(k); });
      Object.keys(obj).forEach(k => store.set(prefix + k, obj[k])); return this;
    },
    deleteProperty(k) { store.del(prefix + k); return this; },
    getProperties() { const o = {}; store.keys(prefix).forEach(k => { o[k.slice(prefix.length)] = store.get(k); }); return o; },
    getKeys() { return store.keys(prefix).map(k => k.slice(prefix.length)); },
    deleteAllProperties() { store.keys(prefix).forEach(k => store.del(k)); return this; }
  };
}

function makeServices(ctx) {
  const user = String(ctx.user || '').toLowerCase();
  const store = ctx.store;
  const lockObj = name => {
    let held = false;
    return {
      tryLock(ms) { if (held) return true; held = !!hostCall('lock', { op: 'acquire', name: name, timeout: Number(ms) || 0 }); return held; },
      waitLock(ms) { if (!this.tryLock(ms)) throw new Error('Lock timeout: another process was holding the lock for too long.'); },
      releaseLock() { if (held) { hostCall('lock', { op: 'release', name: name }); held = false; } },
      hasLock() { return held; }
    };
  };
  const htmlOut = s => {
    const o = { getContent: () => s, setTitle: () => o, addMetaTag: () => o, setXFrameOptionsMode: () => o, setSandboxMode: () => o, append: x => { s += x; return o; } };
    return o;
  };
  const driveName = {};
  return {
    Utilities: Utilities,
    UrlFetchApp: UrlFetchApp,
    Logger: { log: (...a) => { console.log(...a); return Logger; } },
    Session: {
      getActiveUser: () => ({ getEmail: () => user }),
      getEffectiveUser: () => ({ getEmail: () => String(ctx.saEmail || '') }),
      getScriptTimeZone: () => 'Asia/Kolkata',
      getTemporaryActiveUserKey: () => crypto.createHash('sha256').update('k|' + user).digest('hex').slice(0, 24),
      getActiveUserLocale: () => 'en'
    },
    CacheService: {
      getScriptCache: () => makeCache('script', store),
      getUserCache: () => makeCache('user:' + user, store),
      getDocumentCache: () => makeCache('script', store)
    },
    LockService: {
      getScriptLock: () => lockObj('script'),
      getDocumentLock: () => lockObj('script'),
      getUserLock: () => lockObj('user:' + user)
    },
    PropertiesService: {
      getScriptProperties: () => makeProps('s|', store),
      getDocumentProperties: () => makeProps('s|', store),
      getUserProperties: () => makeProps('u|' + user + '|', store)
    },
    ScriptApp: {
      AuthMode: { FULL: 'FULL', LIMITED: 'LIMITED', NONE: 'NONE' },
      AuthorizationStatus: { REQUIRED: 'REQUIRED', NOT_REQUIRED: 'NOT_REQUIRED' },
      getOAuthToken: () => hostCall('saToken', {}),
      getAuthorizationInfo: () => ({ getAuthorizationStatus: () => 'NOT_REQUIRED', getAuthorizationUrl: () => '' }),
      getProjectTriggers: () => [],
      getUserTriggers: () => [],
      deleteTrigger: () => {},
      newTrigger: () => { throw new Error('Scheduled triggers are not available on Vercel (the daily backup keeps running in Apps Script).'); },
      getService: () => ({ getUrl: () => String(ctx.appUrl || '') }),
      getScriptId: () => 'vercel'
    },
    HtmlService: {
      createHtmlOutputFromFile(name) {
        const f = path.join(ctx.gasDir, String(name).replace(/[^A-Za-z0-9_-]/g, '') + '.html');
        if (!fs.existsSync(f)) throw new Error('File not found: ' + name);
        return htmlOut(fs.readFileSync(f, 'utf8'));
      },
      createHtmlOutput: s => htmlOut(String(s || '')),
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
      SandboxMode: { IFRAME: 'IFRAME' }
    },
    DriveApp: {
      getFileById(id) {
        const name = () => driveName[id] || (driveName[id] = call1('GET', DRIVE + id + '?supportsAllDrives=true&fields=name', undefined, 'Drive').name);
        return {
          getId: () => id, getName: name, getUrl: () => 'https://drive.google.com/open?id=' + id,
          setTrashed: () => { throw new Error('Deleting files is not available on Vercel.'); },
          makeCopy: () => { throw new Error('Copying files is not available on Vercel – the daily backup runs in Apps Script.'); }
        };
      },
      getFoldersByName: () => { throw new Error('Drive folders are not available on Vercel – the daily backup runs in Apps Script.'); },
      createFolder: () => { throw new Error('Drive folders are not available on Vercel – the daily backup runs in Apps Script.'); }
    }
  };
}
const Logger = { log: (...a) => { console.log(...a); return Logger; } };

module.exports = { makeServices, Blob, Utilities, toBuf };
