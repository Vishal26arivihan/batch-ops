'use strict';
// Minimal .xlsx writer (no dependencies): typed cells, number/date formats kept from the Google Sheet.
const zlib = require('zlib');

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zip(files) {                      // files: [{name, data(Buffer)}]
  const locals = [], centrals = [];
  let off = 0;
  files.forEach(f => {
    const name = Buffer.from(f.name, 'utf8'), raw = f.data, comp = zlib.deflateRawSync(raw), crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    centrals.push(ch, name);
    off += 30 + name.length + comp.length;
  });
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat(locals.concat([cd, end]));
}

const esc = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function col(n) { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

const DEFAULT_FMT = { DATE: 'dd/mm/yyyy', TIME: 'hh:mm:ss', DATE_TIME: 'dd/mm/yyyy hh:mm:ss' };
function excelPattern(nf) {
  if (!nf) return null;
  let p = nf.pattern || DEFAULT_FMT[nf.type] || null;
  if (!p) return null;
  return p.replace(/am\/pm/gi, 'AM/PM');
}

/** sheets: [{name, rows:[[cell|null]]}], cell = {t:'n'|'s'|'b', v, nf} -> Buffer (.xlsx) */
function build(sheets) {
  const fmts = [], fmtStyle = {};                 // pattern -> style index
  const styleFor = nf => {
    const p = excelPattern(nf);
    if (!p) return 0;
    if (fmtStyle[p] === undefined) { fmts.push(p); fmtStyle[p] = fmts.length; }
    return fmtStyle[p];
  };
  const sheetXml = sheets.map(sh => {
    const rows = sh.rows.map((row, r) => {
      const cells = (row || []).map((c, j) => {
        if (!c || c.v === '' || c.v === null || c.v === undefined) return '';
        const ref = col(j) + (r + 1);
        if (c.t === 'n') { const s = styleFor(c.nf); return '<c r="' + ref + '"' + (s ? ' s="' + s + '"' : '') + '><v>' + Number(c.v) + '</v></c>'; }
        if (c.t === 'b') return '<c r="' + ref + '" t="b"><v>' + (c.v ? 1 : 0) + '</v></c>';
        return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(c.v) + '</t></is></c>';
      }).join('');
      return cells ? '<row r="' + (r + 1) + '">' + cells + '</row>' : '';
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows + '</sheetData></worksheet>';
  });
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    (fmts.length ? '<numFmts count="' + fmts.length + '">' + fmts.map((p, i) => '<numFmt numFmtId="' + (164 + i) + '" formatCode="' + esc(p) + '"/>').join('') + '</numFmts>' : '') +
    '<fonts count="1"><font><sz val="10"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="' + (fmts.length + 1) + '"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    fmts.map((p, i) => '<xf numFmtId="' + (164 + i) + '" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>').join('') + '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets.map((s, i) => '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>';
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
    '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
  const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const B = s => Buffer.from(s, 'utf8');
  return zip([{ name: '[Content_Types].xml', data: B(ct) }, { name: '_rels/.rels', data: B(rels) },
    { name: 'xl/workbook.xml', data: B(wb) }, { name: 'xl/_rels/workbook.xml.rels', data: B(wbRels) }, { name: 'xl/styles.xml', data: B(styles) }]
    .concat(sheetXml.map((x, i) => ({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: B(x) }))));
}

module.exports = { build };
