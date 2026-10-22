'use strict';
// Date helpers that behave like Apps Script (Java SimpleDateFormat patterns, time zones, sheet serial dates).

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const dtfCache = {};
function dtf(tz) {
  if (!dtfCache[tz]) {
    dtfCache[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short'
    });
  }
  return dtfCache[tz];
}
const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of a date in a time zone */
function parts(date, tz) {
  const p = {};
  dtf(tz || 'Asia/Kolkata').formatToParts(date).forEach(x => { p[x.type] = x.value; });
  return { y: +p.year, M: +p.month, d: +p.day, H: +p.hour % 24, m: +p.minute, s: +p.second,
           ms: date.getUTCMilliseconds(), dow: WD[p.weekday] };
}
function offsetMs(date, tz) {
  const p = parts(date, tz);
  return Date.UTC(p.y, p.M - 1, p.d, p.H, p.m, p.s) - (date.getTime() - date.getUTCMilliseconds());
}
/** Date for a wall-clock time in a time zone */
function fromWall(y, M, d, H, m, s, ms, tz) {
  const guess = Date.UTC(y, M - 1, d, H || 0, m || 0, s || 0, ms || 0);
  let t = guess - offsetMs(new Date(guess), tz);
  const o2 = offsetMs(new Date(t), tz);              // second pass (DST edges)
  t = guess - o2;
  return new Date(t);
}

const pad = (n, w) => String(n).padStart(w, '0');

function tzName(date, tz, long) {
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: long ? 'long' : 'short' }).formatToParts(date);
    return (p.find(x => x.type === 'timeZoneName') || {}).value || tz;
  } catch (e) { return tz; }
}

/** Utilities.formatDate(date, tz, pattern) */
function formatDate(date, tz, pattern) {
  if (!(date instanceof Date)) date = new Date(date);
  tz = tz || 'Asia/Kolkata';
  const p = parts(date, tz);
  let out = '';
  const re = /'([^']*)'|y+|M+|d+|H+|h+|k+|K+|m+|s+|S+|a+|E+|Z+|X+|z+|u+|D+/g;
  let last = 0, mt;
  while ((mt = re.exec(pattern)) !== null) {
    out += pattern.slice(last, mt.index);
    last = re.lastIndex;
    const t = mt[0];
    if (mt[1] !== undefined) { out += mt[1] === '' ? "'" : mt[1]; continue; }
    const c = t[0], n = t.length;
    switch (c) {
      case 'y': out += n === 2 ? pad(p.y % 100, 2) : pad(p.y, n); break;
      case 'M': out += n >= 4 ? MONTHS[p.M - 1] : n === 3 ? MONTHS[p.M - 1].slice(0, 3) : pad(p.M, n); break;
      case 'd': out += pad(p.d, n); break;
      case 'H': out += pad(p.H, n); break;
      case 'k': out += pad(p.H === 0 ? 24 : p.H, n); break;
      case 'K': out += pad(p.H % 12, n); break;
      case 'h': out += pad(p.H % 12 === 0 ? 12 : p.H % 12, n); break;
      case 'm': out += pad(p.m, n); break;
      case 's': out += pad(p.s, n); break;
      case 'S': out += pad(p.ms, 3).slice(0, n).padEnd(n, '0'); break;
      case 'a': out += p.H < 12 ? 'AM' : 'PM'; break;
      case 'E': out += n >= 4 ? DAYS[p.dow] : DAYS[p.dow].slice(0, 3); break;
      case 'u': out += String(p.dow === 0 ? 7 : p.dow); break;
      case 'D': {
        const doy = Math.round((Date.UTC(p.y, p.M - 1, p.d) - Date.UTC(p.y, 0, 1)) / 86400000) + 1;
        out += pad(doy, n); break;
      }
      case 'Z': case 'X': {
        const off = Math.round(offsetMs(date, tz) / 60000), sg = off < 0 ? '-' : '+', a = Math.abs(off);
        out += sg + pad(Math.floor(a / 60), 2) + (c === 'X' && n >= 3 ? ':' : '') + pad(a % 60, 2); break;
      }
      case 'z': out += tzName(date, tz, n >= 4); break;
      default: out += t;
    }
  }
  out += pattern.slice(last);
  return out;
}

/** Utilities.parseDate(text, tz, pattern) */
function parseDate(text, tz, pattern) {
  const fields = [];
  let rx = '^\\s*';
  const re = /'([^']*)'|y+|M+|d+|H+|h+|m+|s+|S+|a+|E+/g;
  let last = 0, mt;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  while ((mt = re.exec(pattern)) !== null) {
    rx += esc(pattern.slice(last, mt.index));
    last = re.lastIndex;
    if (mt[1] !== undefined) { rx += esc(mt[1]); continue; }
    const c = mt[0][0], n = mt[0].length;
    if (c === 'M' && n >= 3) { rx += '([A-Za-z]+)'; fields.push('Mname'); }
    else if (c === 'a') { rx += '([AaPp][Mm])'; fields.push('a'); }
    else if (c === 'E') { rx += '[A-Za-z]+'; }
    else { rx += '(\\d{1,' + Math.max(n, c === 'y' ? 4 : c === 'S' ? 3 : 2) + '})'; fields.push(c); }
  }
  rx += esc(pattern.slice(last)) + '\\s*$';
  const m = String(text).match(new RegExp(rx));
  if (!m) throw new Error('Unparseable date: "' + text + '"');
  const v = { y: 1970, M: 1, d: 1, H: 0, m: 0, s: 0, S: 0 };
  let pm = null, h12 = null;
  fields.forEach((f, i) => {
    const s = m[i + 1];
    if (f === 'Mname') { const k = MONTHS.findIndex(x => x.toLowerCase().indexOf(s.toLowerCase().slice(0, 3)) === 0); v.M = k + 1; }
    else if (f === 'a') pm = /p/i.test(s);
    else if (f === 'h') h12 = +s;
    else if (f === 'y') v.y = s.length === 2 ? 2000 + +s : +s;
    else v[f] = +s;
  });
  if (h12 !== null) v.H = (h12 % 12) + (pm ? 12 : 0);
  else if (pm !== null && pm && v.H < 12) v.H += 12;
  return fromWall(v.y, v.M, v.d, v.H, v.m, v.s, v.S, tz || 'Asia/Kolkata');
}

/** Google Sheets serial number (days since 1899-12-30, wall time of the sheet) -> Date */
function serialToDate(serial, tz) {
  const ms = Math.round(Number(serial) * 86400000);
  const w = new Date(Date.UTC(1899, 11, 30) + ms);
  return fromWall(w.getUTCFullYear(), w.getUTCMonth() + 1, w.getUTCDate(), w.getUTCHours(), w.getUTCMinutes(),
                  w.getUTCSeconds(), w.getUTCMilliseconds(), tz);
}
/** Date -> text the sheet understands when written with USER_ENTERED */
function dateToSheetText(date, tz) {
  const p = parts(date, tz);
  const d = p.y + '-' + pad(p.M, 2) + '-' + pad(p.d, 2);
  if (p.H === 0 && p.m === 0 && p.s === 0) return d;
  return d + ' ' + pad(p.H, 2) + ':' + pad(p.m, 2) + ':' + pad(p.s, 2);
}

module.exports = { formatDate, parseDate, serialToDate, dateToSheetText, parts, fromWall };
