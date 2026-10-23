// =====================================================================
// vercel.gs – the few functions that work differently on Vercel.
// Loaded AFTER Code.gs and Admin.gs, so these definitions replace the Apps Script versions.
// =====================================================================

/** No Apps Script authorization screen on Vercel (the server uses its service account). */
function authUrl_() { return ""; }

/**
 * DPP upload: build the small .xlsx straight from the sheet (Info tab with the Update = Yes rows +
 * the question tab of each selected DPP). No temporary Google Sheet is needed.
 * Cells keep their type and number / date format, like a download from Google Sheets.
 */
function webDppUpload(key) {
  assertOwner_("dpp");
  assertNotFrozen_();
  const c = dppCfg_(key), L = { param: DPP_LANG[c.lang].param, batchId: envBatch_(c.lang) };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("Another update is running, please try again shortly.");
  try {
    const src = SpreadsheetApp.openById(c.fileId);
    const it = dppInfoTab_(src), info = it.tab, h = it.h;
    const cId = h.indexOf("id"), cName = h.indexOf("name"), cUpd = h.indexOf("update");
    const lastCol = info.getLastColumn(), lastRow = info.getLastRow();
    const all = info.getRange(1, 1, lastRow, lastCol).getValues();
    const keep = [0];                                  // header
    const picked = [];
    for (let i = 1; i < all.length; i++) {
      if (b_(all[i][cId]) && /^yes$/i.test(b_(all[i][cUpd]))) { keep.push(i); picked.push({ id: b_(all[i][cId]), name: b_(all[i][cName]) }); }
    }
    if (!picked.length) throw new Error("No DPP has Update = Yes. Select at least one DPP first.");
    const missing = picked.filter(p => !src.getSheetByName(p.name));
    if (missing.length) throw new Error("Question tab not found for: " + missing.map(p => p.name + " (" + p.id + ")").join(", ") +
      ". The tab name must be exactly the same as the Name column.");

    // 1) the .xlsx: Info tab (header + selected rows) + one tab per selected DPP
    const infoGrid = __typedGrid(c.fileId, info.getName());
    const out = [{ name: info.getName(), rows: keep.map(i => (infoGrid[i] || []).slice(0, lastCol)) }];
    const done = {};
    done[info.getName()] = 1;
    picked.forEach(p => {
      const sh = src.getSheetByName(p.name), nm = sh.getName();
      if (done[nm]) return;
      done[nm] = 1;
      out.push({ name: nm, rows: __typedGrid(c.fileId, nm) });
    });
    const blob = Utilities.newBlob(__xlsx(out), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", src.getName() + ".xlsx");
    const sizeKb = Math.round(blob.getBytes().length / 1024);

    // 2) upload
    const url = DPP_UPLOAD_URL + "?language=" + L.param + "&batchId=" + L.batchId + "&isDpp=true";
    const res = UrlFetchApp.fetch(url, { method: "post", headers: { avtoken: token_(), origin: ORIGIN }, payload: { file: blob }, muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code === 401) throw new Error(TOKEN_EXPIRED_MSG);
    const text = res.getContentText();
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const updated = lines.filter(s => /^Updating test series ::/i.test(s)).map(s => s.replace(/^Updating test series ::\s*/i, ""));
    const mapped = lines.filter(s => /^Successfully saved dpp-batch-mapping/i.test(s)).length;
    const errors = lines.filter(s => /error|exception|fail|not found|invalid/i.test(s)).slice(0, 30);
    const finished = /Finished db update successfully/i.test(text);
    const ok = code >= 200 && code < 300 && finished && !errors.length;
    logAction_("DPP_UPLOAD", c.key + " (" + L.param + ", batch " + L.batchId + ")", ok ? "OK" : "FAIL",
      "HTTP " + code + " · " + sizeKb + " KB · selected: " + picked.map(p => p.id).join(", ") +
      "\nUpdated: " + (updated.join(", ") || "-") + (errors.length ? "\nErrors:\n" + errors.join("\n") : ""));
    return { ok: ok, code: code, finished: finished, sizeKb: sizeKb, selected: picked, updated: updated, mapped: mapped,
             errors: errors, log: lines.filter(s => !/^(Iterating row number|parsing image options|image options size)/i.test(s)).slice(-60).join("\n") };
  } finally {
    lock.releaseLock();
  }
}

/**
 * PDF update: same as Code.gs, but the Automation PDF cell is read again for a few seconds.
 * That cell is a formula reading the live sheet (another file); the Sheets API returns it before Google has recalculated it.
 */
function webPdfUpdate(lang, code, keyOrUrl) {
  assertOwner_("pdf_update");
  assertNotFrozen_();
  checkCodeLang_(code, lang);
  const url = pdfUrlFromKey_(keyOrUrl);
  if (!url) throw new Error("PDF key or URL is empty");
  const pc = pdfCheck_(url);
  if (pc.ok === false) throw new Error("BLOCKED – this PDF link does not open (HTTP " + pc.code + "):\n" + url + "\nCheck the key or upload the PDF first. The sheet was not changed.");
  const L = livePdfLocate_(code);
  const wrote = [], skipped = [];
  L.cols.forEach((ci, k) => {
    const r = L.tab.getRange(L.row, ci + 1);
    if (r.getFormula()) { skipped.push(L.names[k]); return; }
    r.setValue(url); wrote.push(L.names[k]);
  });
  SpreadsheetApp.flush();
  logAction_("PDF_UPDATE", L.chapterCode, wrote.length ? "OK" : "FAIL", url + " → " + L.fileName + " row " + L.row);

  const p = lecCfg_(lang).p, sh = autoSheet_();
  const sameLecture = String(sh.getRange(p.code + p.row).getDisplayValue()).toUpperCase().indexOf(L.chapterCode) === 0;
  let sheetPdf = sh.getRange(p.pdf + p.row).getDisplayValue().trim();
  for (let i = 0; sameLecture && wrote.length && sheetPdf !== url && i < 5; i++) {      // up to ~8 s
    Utilities.sleep(1500);
    sheetPdf = __refresh(sh).getRange(p.pdf + p.row).getDisplayValue().trim();
  }
  return {
    url: url, where: L.fileName + " / " + L.tabName + " / row " + L.row,
    wrote: wrote, skipped: skipped,
    automationCell: p.pdf + p.row, automationPdf: sheetPdf,
    matches: sameLecture && sheetPdf === url, sameLecture: sameLecture
  };
}

/** Vercel can return at most ~4.5 MB per call, so the base image is limited to 3 MB. */
function webThumbFetch(url) {
  assertOwner_("thumbnail");
  url = String(url || "").trim();
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw new Error("Not a valid https image link.");
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error("Could not load the image (HTTP " + res.getResponseCode() + ").");
  const blob = res.getBlob();
  const type = String(blob.getContentType() || "");
  if (!/^image\//i.test(type)) throw new Error("This link is not an image (" + (type || "unknown type") + ").");
  if (blob.getBytes().length > 3 * 1024 * 1024) throw new Error("Image is larger than 3 MB.");
  return "data:" + type + ";base64," + Utilities.base64Encode(blob.getBytes());
}

// ---------- Daily backup keeps running in Apps Script (service accounts cannot create Drive files) ----------
const VERCEL_BACKUP_MSG = "The daily backup runs in Apps Script (open the old Apps Script dashboard → Admin → Safety). It is not available on Vercel.";
function backupStatus_() { return { last: null, scheduled: false, keepDays: SAFE.BACKUP_KEEP_DAYS, hour: SAFE.BACKUP_HOUR, vercel: true, note: VERCEL_BACKUP_MSG }; }
function dailyBackup() { throw new Error(VERCEL_BACKUP_MSG); }
function adminBackupNow() { admRequire_(); throw new Error(VERCEL_BACKUP_MSG); }
function adminBackupSchedule() { admRequire_(); throw new Error(VERCEL_BACKUP_MSG); }

// ---------- One-time settings import (users, features, admin password, shared token, safety settings) ----------
/** Setup page: is this the owner, and were the settings imported already? */
function vercelSetupStatus() {
  const me = admMe_();
  return { email: me, owner: me === ADM.FIRST_ADMIN, imported: admProps_().getProperty("VERCEL_IMPORTED") || "" };
}
/** Paste the JSON from exportSettingsForMigration() (Apps Script). Owner only; a second import needs the admin password. */
function vercelImportSettings(raw, pass) {
  const me = admMe_();
  if (me !== ADM.FIRST_ADMIN) throw new Error("Only the owner (" + ADM.FIRST_ADMIN + ") can import settings.");
  if (admProps_().getProperty("VERCEL_IMPORTED")) admRecheck_(pass);
  let obj;
  try { obj = JSON.parse(String(raw || "").trim()); } catch (e) { throw new Error("This is not valid JSON. Copy everything between the ----- lines."); }
  const clean = {};
  Object.keys(obj).filter(k => MIGRATE_KEYS_RE.test(k)).forEach(k => clean[k] = String(obj[k]));
  if (!Object.keys(clean).length) throw new Error("No settings found in this JSON.");
  admProps_().setProperties(clean);
  admProps_().setProperty("VERCEL_IMPORTED", admNow_() + " by " + me);
  ADM_USERS_MEMO_ = null;
  logAction_("SETTINGS_IMPORT", "(Vercel)", "OK", Object.keys(clean).map(k => k === "AVTOKEN" ? "AVTOKEN (…" + admTail_(clean[k]) + ")" : k).join(", "));
  return { count: Object.keys(clean).length, keys: Object.keys(clean).map(k => k === "AVTOKEN" ? "AVTOKEN (…" + admTail_(clean[k]) + ")" : k) };
}
