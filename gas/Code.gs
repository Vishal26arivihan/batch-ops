// Batch OPS – Dashboard push + NodePath + Web dashboard (Webapp.html)

// ---------- Internal Metrics server: PRODUCTION or STAGE (test) – chosen per user in the dashboard ----------
const IM_ENVS = {
  PROD:  { label: "PRODUCTION", host: "https://prod.arivihan.com/internal-metrics/secure/",
           origin: "https://internal-metrics-ui.arivihan.com",       batch: { ENG: 99, HIN: 100 } },
  STAGE: { label: "STAGE (test server)", host: "https://platform-stage.arivihan.com/internal-metrics/secure/",
           origin: "https://internal-metrics-ui-stage.arivihan.com", batch: { ENG: 99, HIN: 100 } }
};
const STAGE_HOURS = 4;               // SAFETY: Stage mode switches itself back to Production after 4 hours
let ENV_ = null;
/** Current server for this user: "PROD" (default) or "STAGE" (only while the user has switched it on and it has not expired) */
function env_() {
  if (ENV_) return ENV_;
  ENV_ = "PROD";
  try {
    const o = JSON.parse(PropertiesService.getUserProperties().getProperty("IM_ENV") || "null");
    if (o && o.env === "STAGE" && Number(o.until) > Date.now()) ENV_ = "STAGE";
  } catch (e) {}
  return ENV_;
}
function isStage_() { return env_() === "STAGE"; }
function envCfg_() { return IM_ENVS[env_()]; }
function envLabel_() { return envCfg_().label; }
function envBatch_(lang) { return envCfg_().batch[String(lang).toUpperCase()]; }
const STAGE_SHEET_SKIP = "skipped – STAGE mode (production sheets are not changed by test pushes)";
// API / ORIGIN / upload URLs follow the chosen server (read-only getters, used everywhere as before)
(function () {
  const g = globalThis, def = (name, fn) => Object.defineProperty(g, name, { get: fn, configurable: true });
  def("API",             () => envCfg_().host + "api/v1/");
  def("ORIGIN",          () => envCfg_().origin);
  def("UPLOAD_URL",      () => envCfg_().host + "new/path/upload");
  def("DPP_UPLOAD_URL",  () => envCfg_().host + "upload/test");
  def("CACHE_CLEAR_URL", () => envCfg_().host + "redis/clean");
})();
function envInfo_() {
  let until = 0;
  try { const o = JSON.parse(PropertiesService.getUserProperties().getProperty("IM_ENV") || "null"); if (o && isStage_()) until = Number(o.until); } catch (e) {}
  return { env: env_(), label: envLabel_(), until: until,
           untilText: until ? Utilities.formatDate(new Date(until), "Asia/Kolkata", "hh:mm a") : "" };
}
/** Dashboard switch: Production <-> Stage. Returns the new server + the token status for it. */
function webSetEnv(env) {
  assertOwner_();
  env = env === "STAGE" ? "STAGE" : "PROD";
  const up = PropertiesService.getUserProperties();
  if (env === "STAGE") up.setProperty("IM_ENV", JSON.stringify({ env: "STAGE", until: Date.now() + STAGE_HOURS * 3600000 }));
  else up.deleteProperty("IM_ENV");
  ENV_ = null; TOKEN_ = null;
  logAction_("ENV_SWITCH", env === "STAGE" ? "STAGE" : "PRODUCTION", "OK", env === "STAGE" ? "Stage mode on for " + STAGE_HOURS + " h" : "Back to production");
  let token;
  try { token = tokenStatus_(); } catch (e) { token = { valid: false, code: 0, error: String(e.message || e) }; }
  return { envInfo: envInfo_(), token: token };
}
const SHEET_NAME = "Automation"; // exact name of the input tab

const ALLOWED_EMAILS = [
  "vishal26.arivihan@gmail.com", "visshal26.arivihan@gmail.com", "abhishek.arivihan13@gmail.com"
];

const PAIRS = {
  "C4":  "D4",   // English
  "C10": "D10"   // Hindi
};

const PUSH_HINDI   = { name: "Hindi",   row: 13, code: "D", start: "E", vs: "F", ve: "G", pdf: "T", urlSuffix: "HINDI" };
const PUSH_ENGLISH = { name: "English", row: 7,  code: "C", start: "D", vs: "E", ve: "F", pdf: "S", urlSuffix: "" };

const BATCH_CODES = { "HIN": "NEET_DROPPER_PCB_HIN_27", "ENG": "NEET_DROPPER_PCB_ENG_27" };
const SUBJECT_NAMES = { "PHY": "Physics", "CHE": "Chemistry", "BIO": "Biology" };

const DPP_CATEGORY = {
  "HIN": "2027_neet_dpp_hin_live_test",
  "ENG": "2027_neet_dpp_live_test"
};

const KEYS = ["accessType","active","chapterCode","completed","converted",
  "defaultStartTime","dynamicThumbnail","inProgress","language","microLectureCode",
  "microLectureTitle","microLectureTitleLanguage","newLecture","pdfUrl","pos","s3Url",
  "ssd","subject","thumbnail","transcriptionProcessing","transcriptionStatus",
  "v480p","v720p","videoCompleteEndPos","videoCompleteStartPos","videoUrl"];

const CHAPTER_KEYS = ["accessType","availableInEnglish","board","boardCode","chapterInfo",
  "chapterName","chapterNameLanguage","chapterNumber","chapterStatus","chapterType","code",
  "completed","defaultStartTime","dynamicThumbnail","firebaseChapterName","hindiTitle",
  "isActive","language","lockMessage","newLecture","notesUrl","notesUrlHindi","pos",
  "premiumChapter","subTitle","teacherIntro","teacherIntroHindi","teacherName",
  "teacherNameHindi","title","videoImage"];

const NODE_KEYS = ["activityClassName","activityParams","chapterId","coinAward","ctaAction",
  "disabled","isOptional","locked","nodeType","positionOrder","subjectId","subjectName",
  "subscriptionType","subtitle","title"];

// ---------- Owner check ----------
function ensureScopes_() {
  if (IO_) return;                                    // running from the web app – handled there instead
  if (typeof ScriptApp.requireAllScopes === "function") ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
}

function authUrl_() {
  try {
    const info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
    if (info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) return info.getAuthorizationUrl() || "";
  } catch (e) {}
  return "";
}

function isOwner(feature) {
  ensureScopes_();
  const me = (Session.getActiveUser().getEmail() || "").trim().toLowerCase();
  if (!isAllowedUser_(me)) {
    uiAlert_(
      "You do not have permission to use this.\n\n" +
      "Signed-in email: " + (me ? me : "(not available)") + "\n" +
      "Ask an admin to add this email in the Admin panel.");
    return false;
  }
  if (feature && !hasFeature_(me, feature)) {
    uiAlert_("You do not have access to \"" + featureLabel_(feature) + "\".\nAsk an admin to allow it in Admin → Access.");
    return false;
  }
  return true;
}

// ---------- SAFETY helpers (used inside the push functions) ----------
/** If the emergency stop is on: show the message and return true (menu + web). */
function frozenStop_() {
  const f = freezeInfo_();
  if (!f) return false;
  uiAlert_(freezeMsg_(f));
  return true;
}
/** Push limit, checked after the user confirms. Over the limit -> message + false. */
function rateOk_(kind) {
  try { rateTake_(kind); return true; } catch (e) { uiAlert_(e.message); return false; }
}
/** Does the PDF link really open? {ok, code, note} – OK results are cached for 10 min */
function pdfCheck_(url) {
  if (!/^https?:\/\//i.test(String(url || ""))) return { ok: false, code: 0, note: "not a URL" };
  const ck = "pdfok_" + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, url));
  if (cacheGet_(ck)) return { ok: true, code: 200 };
  let code = 0;
  try {
    code = UrlFetchApp.fetch(url, { method: "get", headers: { Range: "bytes=0-0" }, muteHttpExceptions: true, followRedirects: true }).getResponseCode();
  } catch (e) { return { ok: null, code: 0, note: String(e.message || e).substring(0, 120) }; }
  const ok = code === 200 || code === 206;
  if (ok) cachePut_(ck, 1, 600);
  return { ok: ok, code: code };
}
/** Block the push when the PDF link is broken (true = blocked) */
function pdfBlocked_(name, pdf) {
  const r = pdfCheck_(pdf);
  if (r.ok === false) {
    uiAlert_(name + ": BLOCKED – the PDF link does not open (HTTP " + r.code + ").\n" + pdf +
      "\n\nCheck the PDF key (spelling, folder, .pdf) or upload the PDF first. Nothing was pushed.");
    return true;
  }
  return false;
}
/** Was the same push done in the last 10 minutes? Adds a warning line to the preview. */
function recentPushWarn_(kind, chapterCode) {
  try {
    let m = cacheGet_("td_logs");
    if (!m) { m = todayLogMap_(); cachePut_("td_logs", m, 60); }
    const L = (m[String(chapterCode).toUpperCase()] || {})[kind];
    if (!L || !L.ok) return "";
    const tz = Session.getScriptTimeZone() || "Asia/Kolkata";
    const t = Utilities.parseDate(L.at, tz, "dd/MM/yyyy HH:mm:ss");
    const mins = Math.round((Date.now() - t.getTime()) / 60000);
    if (mins < 0 || mins > 10) return "";
    return "⚠️ ALREADY PUSHED " + (mins < 1 ? "less than a minute" : mins + " min") + " ago by " + L.by + ". Make sure you are not pushing it twice.\n\n";
  } catch (e) { return ""; }
}

// ---------- Sheet + dialog helpers (work from both the menu and the web app) ----------
// STANDALONE SETUP: paste the FULL URL of the Batch OPS sheet here (copy it from the browser address bar)
const BOOK_URL = "https://docs.google.com/spreadsheets/d/191KXHslzMCz22dBD3XW5cKEqP1pmGZsbmcPgGIf_fNY/edit";
const BOOK_ID = (String(BOOK_URL).match(/\/d\/([a-zA-Z0-9_-]+)/) || [])[1] || "";
function book_() {
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  if (ss) return ss;
  if (!BOOK_ID) throw new Error("BOOK_URL is not set in Code.gs. Paste the full Batch OPS sheet URL there.");
  try { return SpreadsheetApp.openById(BOOK_ID); } catch (e) {
    throw new Error("Batch OPS sheet could not be opened. Check BOOK_URL in Code.gs (copy the full URL of the Batch OPS sheet).");
  }
}

let IO_ = null;
function uiAlert_(msg) {
  if (IO_) { IO_.msgs.push(String(msg)); return; }
  SpreadsheetApp.getUi().alert(msg);
}
function uiConfirm_(msg) {
  if (IO_) { IO_.confirmText = String(msg); return IO_.apply; }
  const ui = SpreadsheetApp.getUi();
  return ui.alert(msg, ui.ButtonSet.YES_NO) === ui.Button.YES;
}

function rowGetter_(sh, row) {
  const vals = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  return col => { const v = vals[colIdx_(col)]; return v === undefined ? "" : v; };
}
function colIdx_(col) {
  let n = 0;
  String(col).toUpperCase().replace(/[^A-Z]/g, "").split("").forEach(ch => { n = n * 26 + ch.charCodeAt(0) - 64; });
  return n - 1;
}
function a1_(a1) {
  const m = String(a1).toUpperCase().match(/^([A-Z]+)(\d+)$/);
  return { r: Number(m[2]), c: colIdx_(m[1]) + 1 };
}

function pdfFor_(p, sheetVal) {
  if (IO_ && IO_.pdf) return IO_.pdf;
  return String(sheetVal == null ? "" : sheetVal).trim();
}

// ---------- Per-user Automation tab ----------
// The owner uses "Automation"; everyone else gets "Automation - <email prefix>" (created automatically on first use)
const AUTO_TAB_FOR = { "vishal26.arivihan@gmail.com": SHEET_NAME };
const AUTO_CLEAR_CELLS = ["C4", "D4", "G3:I4", "N7:P7", "C10", "D10", "G9:I10", "O13:Q13"];   // inputs cleared in a new copy
let AUTO_SHEET_ = null;

function isAutoTab_(name) { return name === SHEET_NAME || String(name).indexOf(SHEET_NAME + " - ") === 0; }

function autoTabName_() {
  const me = (Session.getActiveUser().getEmail() || "").trim().toLowerCase();
  if (!me) return SHEET_NAME;
  if (AUTO_TAB_FOR[me]) return AUTO_TAB_FOR[me];
  return SHEET_NAME + " - " + me.split("@")[0];
}

/** This user's Automation tab (created as a copy of "Automation" if missing). */
function autoSheet_() {
  if (AUTO_SHEET_) return AUTO_SHEET_;
  const ss = book_();
  const name = autoTabName_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    const tpl = ss.getSheetByName(SHEET_NAME);
    if (!tpl) throw new Error('"' + SHEET_NAME + '" tab not found');
    const lock = LockService.getScriptLock();
    let locked = false;
    try { lock.waitLock(30000); locked = true; } catch (e) {}
    try {
      sh = ss.getSheetByName(name);
      if (!sh) {
        sh = tpl.copyTo(ss).setName(name);
        AUTO_CLEAR_CELLS.forEach(a1 => {
          const r = sh.getRange(a1);
          const f = r.getFormulas();
          if (!f.some(row => row.some(Boolean))) r.clearContent();
        });
        SpreadsheetApp.flush();
      }
    } finally { if (locked) lock.releaseLock(); }
  }
  AUTO_SHEET_ = sh;
  return sh;
}

/** Snapshot used to make sure the sheet data did not change between preview and apply. */
function rowSnap_(p) {
  const get = rowGetter_(autoSheet_(), p.row);
  return [p.code, p.start, p.vs, p.ve, p.pdf].map(c => String(get(c))).join("|");
}

// ---------- Menu (each user only sees the features they are allowed to use) ----------
function onOpen() {
  let me = "";
  try { me = (Session.getActiveUser().getEmail() || "").trim().toLowerCase(); } catch (e) {}
  if (!me) {
    // Google did not share the email (other Gmail account) -> identify via "Load my menu" first
    SpreadsheetApp.getUi().createMenu("Dashboard")
      .addItem("Load my menu", "loadMyMenu")
      .addToUi();
    return;
  }
  buildMenus_(me);
}

function loadMyMenu() {
  const me = (Session.getActiveUser().getEmail() || "").trim().toLowerCase();
  if (!buildMenus_(me)) uiAlert_("No menu options are enabled for " + (me || "your account") + ".\nAsk an admin (Admin → Access).");
}

function buildMenus_(me) {
  const ui = SpreadsheetApp.getUi();
  let f = [];
  try { f = isAllowedUser_(me) ? userFeatures_(me) : []; } catch (e) { f = []; }
  const has = id => f.indexOf(id) >= 0;
  let shown = 0;

  const d = ui.createMenu("Dashboard");
  const groups = [
    ["push_dash",  [["Push to Dashboard - Hindi", "pushHindi"], ["Push to Dashboard - English", "pushEnglish"]]],
    ["push_nodes", [["Push Nodes - Hindi", "pushNodesHindi"], ["Push Nodes - English", "pushNodesEnglish"]]],
    ["push_dpp",   [["Push DPP - Hindi", "pushDppHindi"], ["Push DPP - English", "pushDppEnglish"]]],
    ["push_dash",  [["Sheet backup only - Hindi", "backupHindi"], ["Sheet backup only - English", "backupEnglish"]]],
    ["push_nodes", [["Node sheet update only - Hindi", "nodeSheetHindi"], ["Node sheet update only - English", "nodeSheetEnglish"]]],
    ["nodepath",   [["Live sheets: colour RECORDED rows green", "recolorRecordedAll"]]]
  ];
  let dCount = 0;
  groups.forEach(g => {
    if (!has(g[0])) return;
    if (dCount) d.addSeparator();
    g[1].forEach(it => d.addItem(it[0], it[1]));
    dCount++;
  });
  if (dCount) { d.addToUi(); shown++; }

  if (has("nodepath")) {
    ui.createMenu("NodePath")
      .addItem("Physics Hindi – update + arrange", "menuPhysicsHin")
      .addItem("Chemistry Hindi – update + arrange", "menuChemistryHin")
      .addItem("Biology Hindi – update + arrange", "menuBiologyHin")
      .addSeparator()
      .addItem("Physics English – update + arrange", "menuPhysicsEng")
      .addItem("Chemistry English – update + arrange", "menuChemistryEng")
      .addItem("Biology English – update + arrange", "menuBiologyEng")
      .addSeparator()
      .addItem("Update all subjects (6)", "menuRunAll")
      .addToUi();
    shown++;
  }
  return shown;
}

function pushHindi()        { pushToDashboard(PUSH_HINDI); }
function pushEnglish()      { pushToDashboard(PUSH_ENGLISH); }
function pushNodesHindi()   { pushNodes(PUSH_HINDI); }
function pushNodesEnglish() { pushNodes(PUSH_ENGLISH); }
function pushDppHindi()     { pushDpp(PUSH_HINDI); }
function pushDppEnglish()   { pushDpp(PUSH_ENGLISH); }
function backupHindi()      { backupOnly_(PUSH_HINDI); }
function backupEnglish()    { backupOnly_(PUSH_ENGLISH); }
function nodeSheetHindi()   { nodeSheetOnly_(PUSH_HINDI); }
function nodeSheetEnglish() { nodeSheetOnly_(PUSH_ENGLISH); }

// ---------- Installable onEdit trigger (link fetch only) ----------
function onEditInstallable(e) {
  return;                                   // no longer used: links are fetched by "Click here for links" in the dashboard
  const r = e.range;
  const sh = r.getSheet();
  if (!isAutoTab_(sh.getName())) return;
  const a1 = r.getA1Notation();
  if (PAIRS[a1]) fetchLinkFor(a1, PAIRS[a1], sh);
}

function fetchLink() {
  for (const inCell in PAIRS) fetchLinkFor(inCell, PAIRS[inCell]);
}

// ---------- Link fetch ----------
function fetchLinkFor(inCell, outCell, sheet) {
  const sh = sheet || autoSheet_();
  const out = sh.getRange(outCell);
  const input = String(sh.getRange(inCell).getValue()).trim();
  if (!input) { out.setValue(""); return; }

  const chapterCode = input.replace(/ML\d+$/i, "");
  const lectureCode = /ML\d+$/i.test(input) ? input : chapterCode + "ML1";

  try {
    const lecture = getLecture(lectureCode);
    if (!lecture) { out.setValue("Lecture not found"); return; }
    out.setValue(find720(lecture) || "720p link not found");
  } catch (err) {
    out.setValue(err.message);
  }
}

// ---------- Push: lecture + chapter notes (one click, one confirmation) ----------
function pushToDashboard(p) {
  if (!isOwner("push_dash")) return;
  if (frozenStop_()) return;

  const sh = autoSheet_();
  const get = rowGetter_(sh, p.row);
  const code = String(get(p.code)).trim();

  if (code.length < 10 || !/ML\d+$/i.test(code)) {
    uiAlert_(p.name + ": " + p.code + p.row + " does not have a full lecture code (e.g. ...ML1).\nFound: \"" + code + "\"");
    return;
  }

  const chapterCode = code.replace(/ML\d+$/i, "");
  const pdf = pdfFor_(p, get(p.pdf));
  const pdfOk = /^https?:\/\//i.test(pdf);

  let lectureUrl, current, info;
  try {
    lectureUrl = API + "chapters/micro-lectures/" + code + (p.urlSuffix || "");
    const cl = chapterAndLecture_(chapterCode, code);
    info = cl.info;
    current = cl.current;
  } catch (e) {
    uiAlert_(p.name + ": " + e.message);
    return;
  }
  if (!info) { uiAlert_(p.name + ": chapter " + chapterCode + " not found in Internal Metrics"); return; }
  if (!current) { uiAlert_(p.name + ": lecture not found in Internal Metrics"); return; }

  const oldVals = [current.defaultStartTime, current.videoCompleteStartPos,
                   current.videoCompleteEndPos, current.pdfUrl];

  const upd = {};
  KEYS.forEach(k => { if (current[k] !== undefined) upd[k] = current[k]; });

  const s = Number(get(p.start)), a = Number(get(p.vs)), b = Number(get(p.ve));
  // SAFETY: Video End (video_start_position) must be after Video Start (default_start_time)
  if (get(p.start) !== "" && get(p.vs) !== "" && !isNaN(s) && !isNaN(a) && a > 0 && a <= s) {
    uiAlert_(p.name + ": BLOCKED – Video End (" + Math.round(a / 1000) + "s) must be after Video Start (" + Math.round(s / 1000) + "s). Fix the times – nothing was pushed.");
    return;
  }
  if (pdfOk && pdfBlocked_(p.name, pdf)) return;
  const restoreOld = {};
  KEYS.forEach(k => { if (current[k] !== undefined) restoreOld[k] = current[k]; });
  if (get(p.start) !== "" && !isNaN(s)) upd.defaultStartTime = s;
  if (get(p.vs) !== "" && !isNaN(a)) upd.videoCompleteStartPos = a;
  if (get(p.ve) !== "" && !isNaN(b)) upd.videoCompleteEndPos = b;
  if (pdfOk) upd.pdfUrl = pdf;

  const ch = info.chapter;
  let chBody = null, oldNotes, oldHindi, notesMsg = "";
  if (!pdfOk) {
    notesMsg = "Notes: skipped (PDF URL is not valid)";
  } else if (ch.notesUrl === undefined && ch.notesUrlHindi === undefined) {
    notesMsg = "Notes: skipped (notes fields not found in chapter data)";
  } else {
    chBody = {};
    CHAPTER_KEYS.forEach(k => { if (ch[k] !== undefined) chBody[k] = ch[k]; });
    oldNotes = chBody.notesUrl;
    oldHindi = chBody.notesUrlHindi;
    chBody.notesUrl = pdf;
    chBody.notesUrlHindi = pdf;
  }

  let summary =
    "LECTURE (" + code + ")\n" +
    "  Start Time: " + oldVals[0] + " -> " + upd.defaultStartTime + "\n" +
    "  Complete Start: " + oldVals[1] + " -> " + upd.videoCompleteStartPos + "\n" +
    "  Complete End: " + oldVals[2] + " -> " + upd.videoCompleteEndPos + "\n" +
    "  PDF: " + (upd.pdfUrl === oldVals[3] ? "same" : "will change") + "\n\n";

  if (chBody) {
    summary += "CHAPTER NOTES (" + chapterCode + ")\n" +
      "  Notes URL: " + oldNotes + "\n    -> " + pdf + "\n" +
      "  Notes URL (Hindi): " + oldHindi + "\n    -> " + pdf;
  } else {
    summary += notesMsg;
  }

  summary += isStage_() ? "\n\nSHEET BACKUP: " + STAGE_SHEET_SKIP : "\n\nSHEET BACKUP (after lecture update)\n" +
    "  " + chapterCode + "Microlecture tab gets the data\n" +
    "  Chapters sheet: RECORDED_CHAPTER / RECORDED";

  if (!uiConfirm_(recentPushWarn_("dash", chapterCode) + envLabel_() + " Internal Metrics will be updated (" + p.name + "):\n\n" + summary + "\n\nContinue?")) return;
  if (!rateOk_("PUSH_DASHBOARD " + code)) return;
  // SAFETY: save the old values (can be restored from Admin → Safety)
  const rItems = [{ label: "Lecture " + code, url: lectureUrl, body: restoreOld }];
  if (chBody) { const oldCh = {}; CHAPTER_KEYS.forEach(k => { if (ch[k] !== undefined) oldCh[k] = ch[k]; }); rItems.push({ label: "Chapter notes " + chapterCode, url: API + "chapter/" + info.id, body: oldCh }); }
  const rid = restorePointSave_("PUSH_DASHBOARD", code, rItems);

  // lecture + chapter notes PATCHed in parallel
  const resAll = UrlFetchApp.fetchAll([patchReq_(lectureUrl, upd)].concat(chBody ? [patchReq_(API + "chapter/" + info.id, chBody)] : []));
  const res1 = resAll[0];
  const c1 = res1.getResponseCode();
  let msg = "Lecture: " + (c1 === 200 ? "Updated ✅" :
    "Failed " + c1 + "\n" + res1.getContentText().substring(0, 250));

  if (chBody) {
    const res2 = resAll[1];
    const c2 = res2.getResponseCode();
    msg += "\n\nNotes: " + (c2 === 200 ? "Updated ✅" :
      "Failed " + c2 + "\n" + res2.getContentText().substring(0, 250));
  } else {
    msg += "\n\n" + notesMsg;
  }

  if (c1 === 200) {
    let b;
    if (isStage_()) b = STAGE_SHEET_SKIP;
    else { try { b = backupRow_(p); } catch (e) { b = "⚠️ " + (e.message || e); } }
    msg += "\n\nSheet Backup:\n" + b;
  } else {
    msg += "\n\nSheet Backup: skipped (lecture update failed)";
  }
  logAction_("PUSH_DASHBOARD", code, c1 === 200 ? "OK" : "FAIL", msg + (rid ? "\nRestore point: " + rid : ""));
  uiAlert_(p.name + ":\n\n" + msg);
}

// ---------- Push Nodes: video node + live class notes node ----------
function pushNodes(p) {
  if (!isOwner("push_nodes")) return;
  if (frozenStop_()) return;

  const sh = autoSheet_();
  const get = rowGetter_(sh, p.row);
  const code = String(get(p.code)).trim();

  if (code.length < 10 || !/ML\d+$/i.test(code)) {
    uiAlert_(p.name + ": " + p.code + p.row + " does not have a full lecture code (e.g. ...ML1).\nFound: \"" + code + "\"");
    return;
  }

  const chapterCode = code.replace(/ML\d+$/i, "");
  const pdf = pdfFor_(p, get(p.pdf));
  const pdfOk = /^https?:\/\//i.test(pdf);

  let bp, nodes;
  try {
    bp = findBatchPath(chapterCode);
    nodes = fetchChapterNodes(chapterCode, bp.id);
  } catch (e) {
    uiAlert_(p.name + ": " + e.message);
    return;
  }
  const bpText = "batchPathId " + bp.id + " (v" + bp.version + ")";
  if (!nodes.length) { uiAlert_(p.name + ": no nodes found for this chapter (" + bpText + ")"); return; }

  const jobs = [];
  const lines = [];

  // ----- 1. Video node: LIVE_LECTURE -> VIDEO_LECTURE -----
  const videoNodes = nodes.filter(n => n.ctaAction === "OPEN_LECTURE");
  if (videoNodes.length === 1) {
    const n = videoNodes[0];
    if (n.nodeType === "LIVE_LECTURE") {
      const body = buildNodeBody(n);
      body.nodeType = "VIDEO_LECTURE";
      jobs.push({ label: "Video node", id: n.id, body: body, old: buildNodeBody(n) });
      lines.push("VIDEO NODE #" + n.id + " (" + n.title + ")\n  Node Type: LIVE_LECTURE -> VIDEO_LECTURE");
    } else {
      lines.push("VIDEO NODE #" + n.id + " (" + n.title + ")\n  Already " + n.nodeType + ", no change");
    }
  } else {
    lines.push("VIDEO NODE: skip (" + videoNodes.length + " nodes found, expected 1)");
  }

  // ----- 2. Live Class Notes node: unlock + pdfUrl only when a PDF is available -----
  const notesNodes = nodes.filter(n => n.ctaAction === "LIVE_CLASS_NOTES");
  if (notesNodes.length === 1) {
    const n = notesNodes[0];
    if (!pdfOk) {
      lines.push("LIVE CLASS NOTES NODE #" + n.id + "\n  Skip: pdf cell (" + p.pdf + p.row +
        ") is empty/invalid, so it will not be unlocked and pdfUrl will not change");
    } else {
      try {
        const body = buildNodeBody(n);
        const params = JSON.parse(n.activityParams);
        let l = "LIVE CLASS NOTES NODE #" + n.id + "\n";
        let changed = false;

        if (n.locked) {
          body.locked = false;
          l += "  Locked: true -> false\n";
          changed = true;
        } else {
          l += "  Locked: already false\n";
        }

        const oldPdf = params.pdfUrl;
        if (oldPdf === pdf) {
          l += "  pdfUrl: already same";
        } else {
          params.pdfUrl = pdf;
          body.activityParams = JSON.stringify(params);
          l += "  pdfUrl: " + oldPdf + "\n    -> " + pdf;
          changed = true;
        }
        lines.push(l);
        if (changed) jobs.push({ label: "Live Class Notes node", id: n.id, body: body, old: buildNodeBody(n) });
      } catch (e) {
        lines.push("LIVE CLASS NOTES NODE #" + n.id + "\n  Skipped: could not read activityParams JSON, nothing will change");
      }
    }
  } else {
    lines.push("LIVE CLASS NOTES NODE: skip (" + notesNodes.length + " nodes found, expected 1)");
  }

  lines.push("DPP node: not touched");
  lines.push(isStage_() ? "NODE PATH SHEET: " + STAGE_SHEET_SKIP : "NODE PATH SHEET: Lecture row (LIVE -> VIDEO) + Notes row (pdf + unlock) will also be updated");

  if (!jobs.length) {
    uiAlert_(p.name + " (" + chapterCode + ", " + bpText + "):\n\nNothing to change in Internal Metrics.\n\n" +
      lines.join("\n\n") + "\n\nNode Path Sheet:\n" + (isStage_() ? STAGE_SHEET_SKIP : nodeSheetSafe_(p, ["lecture", "notes"])));
    return;
  }

  if (pdfOk && notesNodes.length === 1 && pdfBlocked_(p.name, pdf)) return;
  if (!uiConfirm_(recentPushWarn_("nodes", chapterCode) + envLabel_() + " nodes will be updated (" + p.name + ", " + chapterCode + ")\n" +
    bpText + "\n\n" + lines.join("\n\n") + "\n\nContinue?")) return;
  if (!rateOk_("PUSH_NODES " + chapterCode)) return;
  const rid = restorePointSave_("PUSH_NODES", chapterCode, jobs.map(j => ({ label: j.label + " #" + j.id, url: API + "personalised-paths/nodes/" + j.id, body: j.old })));

  let allOk = true;
  const resAll = UrlFetchApp.fetchAll(jobs.map(j => patchReq_(API + "personalised-paths/nodes/" + j.id, j.body)));   // in parallel
  const msgs = jobs.map((j, k) => {
    const res = resAll[k];
    const c = res.getResponseCode();
    if (c !== 200) allOk = false;
    return j.label + ": " + (c === 200 ? "Updated ✅" :
      "Failed " + c + "\n" + res.getContentText().substring(0, 250));
  });
  msgs.push("Node Path Sheet:\n" + (isStage_() ? STAGE_SHEET_SKIP : allOk ? nodeSheetSafe_(p, ["lecture", "notes"])
                                           : "skipped (node update failed)"));
  logAction_("PUSH_NODES", chapterCode, allOk ? "OK" : "FAIL", msgs.join("\n") + (rid ? "\nRestore point: " + rid : ""));
  uiAlert_(p.name + " nodes:\n\n" + msgs.join("\n\n"));
}

// ---------- Push DPP: testSeriesId + testCategoryId + unlock ----------
function pushDpp(p) {
  if (!isOwner("push_dpp")) return;
  if (frozenStop_()) return;

  const sh = autoSheet_();
  const code = String(sh.getRange(p.code + p.row).getValue()).trim();

  if (code.length < 10 || !/ML\d+$/i.test(code)) {
    uiAlert_(p.name + ": " + p.code + p.row + " does not have a full lecture code (e.g. ...ML1).\nFound: \"" + code + "\"");
    return;
  }

  const chapterCode = code.replace(/ML\d+$/i, "");
  const m = chapterCode.match(/^2027NEET(PHY|CHE|BIO)(HIN|ENG)/i);
  if (!m) {
    uiAlert_(p.name + ": code format not recognised (" + chapterCode + "). It must contain PHY/CHE/BIO and HIN/ENG.");
    return;
  }
  const lang = m[2].toUpperCase();

  const newSeries = chapterCode + "DPP";
  const newCategory = DPP_CATEGORY[lang];

  let bp, nodes;
  try {
    bp = findBatchPath(chapterCode);
    nodes = fetchChapterNodes(chapterCode, bp.id);
  } catch (e) {
    uiAlert_(p.name + ": " + e.message);
    return;
  }
  const bpText = "batchPathId " + bp.id + " (v" + bp.version + ")";
  const dppNodes = nodes.filter(n => n.ctaAction === "START_ADAPTIVE_PRACTICE");
  if (dppNodes.length !== 1) {
    uiAlert_(p.name + " (" + chapterCode + ", " + bpText + "):\n\nDPP node skipped: " + dppNodes.length + " nodes found, expected 1.");
    return;
  }

  const n = dppNodes[0];
  if (n.testSeriesId === newSeries && n.testCategoryId === newCategory && !n.locked) {
    uiAlert_(p.name + " (" + chapterCode + ", " + bpText + "):\n\nDPP node #" + n.id + " is already correct, nothing to change." +
      "\n\nNode Path Sheet:\n" + (isStage_() ? STAGE_SHEET_SKIP : nodeSheetSafe_(p, ["dpp"])));
    return;
  }

  const body = buildNodeBody(n);
  body.testSeriesId = newSeries;
  body.testCategoryId = newCategory;
  body.locked = false;

  const summary =
    "DPP NODE #" + n.id + " (" + n.title + ")\n" +
    "  Test Series ID: " + (n.testSeriesId || "(empty)") + "\n    -> " + newSeries + "\n" +
    "  Test Category ID: " + (n.testCategoryId || "(empty)") + "\n    -> " + newCategory + "\n" +
    "  Locked: " + n.locked + " -> false\n\n" +
    "NODE PATH SHEET: DPP row (series/category + unlock) will also be updated";

  if (!uiConfirm_(recentPushWarn_("dpp", chapterCode) + envLabel_() + " DPP will be updated (" + p.name + ", " + chapterCode + ")\n" +
    bpText + "\n\n" + summary + "\n\nContinue?")) return;
  if (!rateOk_("PUSH_DPP " + chapterCode)) return;
  const rid = restorePointSave_("PUSH_DPP", chapterCode, [{ label: "DPP node #" + n.id, url: API + "personalised-paths/nodes/" + n.id, body: buildNodeBody(n) }]);

  const res = patchJson(API + "personalised-paths/nodes/" + n.id, body);
  const c = res.getResponseCode();
  if (c !== 200) {
    logAction_("PUSH_DPP", chapterCode, "FAIL", "HTTP " + c + " " + res.getContentText().substring(0, 250));
    uiAlert_(p.name + " DPP: Failed " + c + "\n" + res.getContentText().substring(0, 250));
    return;
  }

  let verify = "";
  try {
    const after = fetchChapterNodes(chapterCode, bp.id).filter(x => x.id === n.id)[0];
    if (!after) {
      verify = "Check: node not found again, please verify in Internal Metrics.";
    } else {
      const bad = [];
      if (after.testSeriesId !== newSeries) bad.push("Test Series ID");
      if (after.testCategoryId !== newCategory) bad.push("Test Category ID");
      if (after.locked) bad.push("Locked");
      verify = bad.length
        ? "⚠️ Server returned 200, but these were not saved: " + bad.join(", ") +
          ".\nPlease check in Internal Metrics (PATCH payload may need a fix)."
        : "Check: Test Series ID, Test Category ID and Unlock all saved correctly ✅";
    }
  } catch (e) {
    verify = "Could not verify (" + e.message + "), please check in Internal Metrics.";
  }
  const dppSheet = isStage_() ? STAGE_SHEET_SKIP : nodeSheetSafe_(p, ["dpp"]);
  logAction_("PUSH_DPP", chapterCode, "OK", verify + "\n" + dppSheet + (rid ? "\nRestore point: " + rid : ""));
  uiAlert_(p.name + " DPP: Updated ✅\n\n" + verify + "\n\nNode Path Sheet:\n" + dppSheet);
}

// ---------- Batch path (picked automatically from the active list) ----------
function findBatchPath(chapterCode) {
  const m = chapterCode.match(/^2027NEET(PHY|CHE|BIO)(HIN|ENG)/i);
  if (!m) throw new Error("Code format not recognised (" + chapterCode + "). It must contain PHY/CHE/BIO and HIN/ENG.");
  const subject = SUBJECT_NAMES[m[1].toUpperCase()];
  const batchCode = BATCH_CODES[m[2].toUpperCase()];

  const cache = CacheService.getScriptCache();
  const ck = "bp_" + batchCode + "_" + subject;
  const hit = cache.get(ck);
  if (hit) return JSON.parse(hit);

  const data = getJson(API + "personalised-paths?pageNo=0&pageSize=50&active=true");
  const matches = (data.content || []).filter(x =>
    x.active === true && x.batchCode === batchCode && x.subjectName === subject);

  if (matches.length === 0) {
    throw new Error("Active batch path not found (" + batchCode + ", " + subject + ")");
  }
  if (matches.length > 1) {
    throw new Error(matches.length + " active batch paths found (" + batchCode + ", " + subject +
      "): IDs " + matches.map(x => x.id + " v" + x.version).join(", ") + ". Stopped to avoid choosing the wrong path.");
  }
  const out = { id: matches[0].id, version: matches[0].version };
  try { cache.put(ck, JSON.stringify(out), 300); } catch (e) {}
  return out;
}

function fetchChapterNodes(chapterCode, batchPathId) {
  const url = API + "personalised-paths/nodes?pageNo=0&pageSize=10&active=true&batchPathId=" +
    batchPathId + "&chapterCode=" + encodeURIComponent(chapterCode);
  const data = getJson(url);
  return (data.content || []).filter(n => n.chapterCode === chapterCode);
}

function buildNodeBody(n) {
  const body = {};
  NODE_KEYS.forEach(k => { if (n[k] !== undefined) body[k] = n[k]; });
  return body;
}

// ---------- Helpers ----------
let TOKEN_ = null;
// Each user has their own token (User Properties). Without one, the shared token (Script Properties) is used.
function token_() {
  if (TOKEN_ === null && isStage_()) {            // Stage: only the user's own Stage token (no shared token)
    const st = (PropertiesService.getUserProperties().getProperty("AVTOKEN_STAGE") || "").trim();
    if (!st) throw new Error("NO TOKEN (STAGE): add your Stage token under Token (Stage mode is on).");
    TOKEN_ = st;
  }
  if (TOKEN_ === null) {
    let own = "";
    try { own = (PropertiesService.getUserProperties().getProperty("AVTOKEN") || "").trim(); } catch (e) {}
    try { if (own && admTokenRevoked_((Session.getActiveUser().getEmail() || "").trim().toLowerCase())) own = ""; } catch (e) {}
    if (own) TOKEN_ = own;
    else {
      const me = (Session.getActiveUser().getEmail() || "").trim().toLowerCase();
      if (!canUseShared_(me)) throw new Error(NO_TOKEN_MSG);       // the admin has not allowed this user to use the shared token
      TOKEN_ = (PropertiesService.getScriptProperties().getProperty("AVTOKEN") || "").trim();
    }
  }
  return TOKEN_;
}

const NO_TOKEN_MSG = "NO TOKEN: you are not allowed to use the shared token. Add your own Internal Metrics token under Token.";

const TOKEN_EXPIRED_MSG = "TOKEN EXPIRED (401): your Internal Metrics token is invalid or expired. Paste a new token under Token.";

// ---------- SPEED: cache + parallel API calls ----------
function envKey_(k) { return isStage_() && /^(chid_|lp_)/.test(k) ? "S_" + k : k; }   // IM data cached per server
function cacheGet_(k) {
  k = envKey_(k);
  try { const v = CacheService.getScriptCache().get(k); return v === null ? null : JSON.parse(v); } catch (e) { return null; }
}
function cachePut_(k, v, sec) {
  k = envKey_(k);
  try { CacheService.getScriptCache().put(k, JSON.stringify(v), sec); } catch (e) {}      // silently skipped when larger than 100KB
}
function cacheDel_(keys) {
  try { CacheService.getScriptCache().removeAll([].concat(keys)); } catch (e) {}
}
/** Drop cached data after anything that changes a sheet or Internal Metrics (called from logAction_ in Admin.gs). */
function cacheBustAfter_(action) {
  if (!/^(PUSH_|PDF_UPDATE|SHEET_BACKUP|NODE_SHEET_UPDATE|NODEPATH_UPDATE|IM_UPLOAD|UPLOAD_FLAG|FEATURES_SET)/.test(String(action))) return;
  const today = todayKey_(new Date());
  const keys = ["td_logs", "up_ENG", "up_HIN"];
  Object.keys(BACKUP_FILES).forEach(k => keys.push("td_" + k + "_" + today));
  CFG.SUBJECTS.forEach(x => keys.push("np_" + x.key));
  cacheDel_(keys);
}

function getReq_(url) { return { url: url, headers: { avtoken: token_(), origin: ORIGIN }, muteHttpExceptions: true }; }
function patchReq_(url, body) {
  return { url: url, method: "patch", contentType: "application/json",
           headers: { avtoken: token_(), origin: ORIGIN }, payload: JSON.stringify(body), muteHttpExceptions: true };
}
function parseRes_(res) {
  const c = res.getResponseCode();
  if (c === 401) throw new Error(TOKEN_EXPIRED_MSG);
  if (c !== 200) throw new Error("Error " + c);
  return JSON.parse(res.getContentText());
}
/** Several GETs at once (UrlFetchApp.fetchAll) – much faster than one by one */
function getJsonAll_(urls) { return UrlFetchApp.fetchAll(urls.map(getReq_)).map(parseRes_); }

function patchJson(url, body) {
  const r = patchReq_(url, body);
  const u = r.url; delete r.url;
  return UrlFetchApp.fetch(u, r);
}

function chapterSearchUrl_(chapterCode) { return API + "chapter?page=0&size=10&search=" + encodeURIComponent(chapterCode); }
function lecPageUrl_(chapterId, page) { return API + "chapters/" + chapterId + "/micro-lectures?pageNo=" + page + "&pageSize=10"; }

function chapterInfoFrom_(chData, chapterCode) {
  const chapter = findObj(chData, v => String(v).toLowerCase() === chapterCode.toLowerCase());
  if (!chapter) return null;
  const id = chapter.id || chapter.chapterId ||
    Object.values(chapter).find(v => typeof v === "string" && /^[0-9a-f]{32}$/.test(v));
  if (!id) return null;
  cachePut_("chid_" + chapterCode.toUpperCase(), id, 21600);          // chapter id cached for 6 hours
  return { chapter: chapter, id: id };
}

function getChapterInfo(chapterCode) {
  return chapterInfoFrom_(getJson(chapterSearchUrl_(chapterCode)), chapterCode);
}

/** Find a lecture: try the remembered page first, otherwise 5 pages at a time */
function getLectureFromChapter(chapterId, code) {
  const ck = "lp_" + chapterId + "_" + code;
  const known = cacheGet_(ck);
  if (known !== null) {
    const l = findObj(getJson(lecPageUrl_(chapterId, known)), v => String(v) === code);
    if (l) return l;
  }
  const BATCH = 5;
  for (let start = 0; start < 50; start += BATCH) {
    const pages = [];
    for (let pg = start; pg < start + BATCH; pg++) pages.push(pg);
    const res = UrlFetchApp.fetchAll(pages.map(pg => getReq_(lecPageUrl_(chapterId, pg))));
    for (let i = 0; i < res.length; i++) {
      const c = res[i].getResponseCode();
      if (c === 401) throw new Error(TOKEN_EXPIRED_MSG);
      if (c !== 200) { if (i === 0 && start === 0) throw new Error("Error " + c); return null; }   // past the last page = done
      const data = JSON.parse(res[i].getContentText());
      const l = findObj(data, v => String(v) === code);
      if (l) { cachePut_(ck, pages[i], 21600); return l; }
      if (!hasItems(data)) return null;
    }
  }
  return null;
}

/** For a push: fresh chapter + lecture, fetched together when both locations are known */
function chapterAndLecture_(chapterCode, code) {
  const id = cacheGet_("chid_" + chapterCode.toUpperCase());
  const pg = id ? cacheGet_("lp_" + id + "_" + code) : null;
  if (id && pg !== null) {
    try {
      const r = getJsonAll_([chapterSearchUrl_(chapterCode), lecPageUrl_(id, pg)]);
      const info = chapterInfoFrom_(r[0], chapterCode);
      const cur = findObj(r[1], v => String(v) === code);
      if (info && info.id === id && cur) return { info: info, current: cur };
    } catch (e) { if (/TOKEN EXPIRED/.test(e.message)) throw e; }
  }
  const info = getChapterInfo(chapterCode);
  return { info: info, current: info ? getLectureFromChapter(info.id, code) : null };
}

function getLecture(code) {
  const chap = code.replace(/ML\d+$/i, "");
  let id = cacheGet_("chid_" + chap.toUpperCase());
  if (!id) { const info = getChapterInfo(chap); if (!info) return null; id = info.id; }
  return getLectureFromChapter(id, code);
}

function getJson(url) {
  const token = token_();
  const res = UrlFetchApp.fetch(url, {
    headers: { avtoken: token, origin: ORIGIN },
    muteHttpExceptions: true
  });
  const c = res.getResponseCode();
  if (c === 401) throw new Error(TOKEN_EXPIRED_MSG);
  if (c !== 200) throw new Error("Error " + c);
  return JSON.parse(res.getContentText());
}

function findObj(node, test) {
  if (node && typeof node === "object") {
    if (!Array.isArray(node) && Object.values(node).some(v => typeof v !== "object" && test(v))) return node;
    for (const k in node) {
      const r = findObj(node[k], test);
      if (r) return r;
    }
  }
  return null;
}

function find720(obj) {
  return Object.values(obj).some ? (Object.values(obj).find(v => typeof v === "string" && v.includes("720p")) || "") : "";
}

function hasItems(node) {
  if (Array.isArray(node)) return node.length > 0;
  if (node && typeof node === "object") return Object.values(node).some(hasItems);
  return false;
}

// ---------- SHEET BACKUP (runs together with Push to Dashboard) ----------

const BACKUP_FILES = {
  PHYENG: { name: "Physics English",   url: "https://docs.google.com/spreadsheets/d/1Qr8K0RNrtN2XvjchqwxwTyKpA3XenexC4n37xehS1zc/edit" },
  PHYHIN: { name: "Physics Hindi",     url: "https://docs.google.com/spreadsheets/d/1rmiMk7f0LqUfGSTgFsoh1YNSe9SfWO_dOXSttb0rAh0/edit" },
  CHEENG: { name: "Chemistry English", url: "https://docs.google.com/spreadsheets/d/1Fp9Oq2y7885WMDVqdysNiFQjEur57hmxm1vT8sOe5RM/edit" },
  CHEHIN: { name: "Chemistry Hindi",   url: "https://docs.google.com/spreadsheets/d/1f4_STBtJOYa-pPLZzzPBGxhT9omLhruqVsNO_KZaH0Y/edit" },
  BIOENG: { name: "Biology English",   url: "https://docs.google.com/spreadsheets/d/13zmhMUyRgnBmgrxvvo35JWUYMCQwqJ1gqXd73-Eu36s/edit" },
  BIOHIN: { name: "Biology Hindi",     url: "https://docs.google.com/spreadsheets/d/1CfQfP0Q_NGvqdhihsjFFqTnzbzold9Q5x-QLsIXKH7o/edit" }
};
const BACKUP_KEY_HEADER = "micro_lecture_code";
const BACKUP_TAB_SUFFIX = "Microlecture";

function backupOnly_(p) {
  if (!isOwner("push_dash")) return;
  if (frozenStop_()) return;
  let b;
  try { b = backupRow_(p); } catch (e) { b = "⚠️ " + (e.message || e); }
  logAction_("SHEET_BACKUP", p.name, /⚠️/.test(b) ? "PARTIAL" : "OK", b);
  uiAlert_(p.name + " Sheet Backup:\n\n" + b);
}

function backupRow_(p) {
  const sh = autoSheet_();
  const lastCol = sh.getLastColumn();
  const two = sh.getRange(p.row - 1, 1, 2, lastCol).getValues();
  const hdr = two[0].map(b_);
  const keyCol = hdr.indexOf(BACKUP_KEY_HEADER);
  if (keyCol < 0) throw new Error("Row " + (p.row - 1) + ": \"" + BACKUP_KEY_HEADER + "\" header not found");

  let c1 = hdr.findIndex(h => h !== "");
  let c2 = hdr.length - 1;
  while (c2 > c1 && hdr[c2] === "") c2--;
  const header = hdr.slice(c1, c2 + 1);
  const data = two[1].slice(c1, c2 + 1);
  const pdf = pdfFor_(p, sh.getRange(p.pdf + p.row).getValue());
  const pdfCol = header.indexOf("pdf_url");
  if (pdfCol >= 0 && /^https?:\/\//i.test(pdf)) data[pdfCol] = pdf;       // the backup gets the same PDF that was sent to the dashboard

  const micro = b_(two[1][keyCol]);
  const m = micro.toUpperCase().match(/(PHY|CHE|BIO)(ENG|HIN)LIVE\d+/);
  if (!m) throw new Error("Lecture code is empty/invalid (\"" + micro + "\")");
  const chapterCode = micro.replace(/ML\d+$/i, "");
  const f = BACKUP_FILES[m[1] + m[2]];
  if (!f || !f.url) throw new Error("Backup file is not set for this subject: " + m[1] + m[2]);

  const dest = SpreadsheetApp.openByUrl(f.url);
  const tabName = chapterCode + BACKUP_TAB_SUFFIX;
  const fmt = { sheet: sh, row: p.row - 1, col: c1 + 1, n: header.length };   // formatting source
  if (writeBackupTab_(dest, tabName, header, data, fmt) === "missing") {
    return "⚠️ \"" + tabName + "\" tab not found in " + f.name + " file (nothing changed)";
  }
  return "  " + tabName + " (" + f.name + "): data copied ✅\n  " + markRecorded_(dest, chapterCode, pdf);
}

function writeBackupTab_(dest, tabName, header, data, fmt) {
  const sh = dest.getSheetByName(tabName);
  if (!sh) return "missing";
  sh.clear();
  const dst = sh.getRange(1, 1, 2, header.length);
  if (fmt) {
    try { copyFormat_(fmt, sh, dst); } catch (e) { /* data is safe even if the formatting cannot be copied */ }
  }
  dst.setNumberFormat("General");
  dst.setValues([header, data]);
  return "ok";
}

function copyFormat_(fmt, sh, dst) {
  const src = fmt.sheet.getRange(fmt.row, fmt.col, 2, fmt.n);
  dst.setBackgrounds(src.getBackgrounds())
     .setFontColors(src.getFontColors())
     .setFontFamilies(src.getFontFamilies())
     .setFontSizes(src.getFontSizes())
     .setFontWeights(src.getFontWeights())
     .setFontStyles(src.getFontStyles())
     .setHorizontalAlignments(src.getHorizontalAlignments())
     .setVerticalAlignments(src.getVerticalAlignments())
     .setWrapStrategies(src.getWrapStrategies());
  dst.setBorder(true, true, true, true, true, true, "#000000", SpreadsheetApp.BorderStyle.SOLID);
  const w = [];
  for (let j = 0; j < fmt.n; j++) w.push(fmt.sheet.getColumnWidth(fmt.col + j));
  for (let j = 0; j < fmt.n;) {
    let k = j;
    while (k + 1 < fmt.n && w[k + 1] === w[j]) k++;
    sh.setColumnWidths(j + 1, k - j + 1, w[j]);
    j = k + 1;
  }
  sh.setRowHeight(1, fmt.sheet.getRowHeight(fmt.row));
  sh.setRowHeight(2, fmt.sheet.getRowHeight(fmt.row + 1));
}

function markRecorded_(dest, code, pdf) {
  const sh = dest.getSheets().filter(s => /^chapters?\s*_?\s*(hindi)?$/i.test(s.getName().trim()))[0];
  if (!sh) return "⚠️ Chapters sheet not found";
  const v = sh.getDataRange().getValues();
  const h = v[0].map(x => b_(x).toLowerCase());
  const cCode = h.indexOf("chapter_code"), cType = h.indexOf("chapter_type"), cStat = h.indexOf("chapter_status");
  if (cCode < 0 || cType < 0 || cStat < 0) return "⚠️ " + sh.getName() + ": chapter_code / chapter_type / chapter_status column not found";
  const pdfCols = PDF_NOTE_COLS.map(n => h.indexOf(n)).filter(x => x >= 0);
  const pdfOk = /^https?:\/\//i.test(String(pdf || ""));
  for (let i = 1; i < v.length; i++) {
    if (b_(v[i][cCode]) !== code) continue;
    let pdfMsg = "";
    if (pdfOk && pdfCols.length) {
      let changed = 0;
      pdfCols.forEach(ci => {
        const r = sh.getRange(i + 1, ci + 1);
        if (r.getFormula() || b_(v[i][ci]) === pdf) return;
        r.setValue(pdf); changed++;
      });
      pdfMsg = changed ? "\n  " + sh.getName() + " (row " + (i + 1) + "): PDF updated ✅" : "\n  PDF already same ✅";
    }
    if (b_(v[i][cType]) === "RECORDED_CHAPTER" && b_(v[i][cStat]) === "RECORDED") {
      const c0 = colorRecordedRow_(sh, v, cStat, i);
      return sh.getName() + ": already RECORDED ✅" + (c0 ? " (row coloured green)" : "") + pdfMsg;
    }
    sh.getRange(i + 1, cType + 1).setValue("RECORDED_CHAPTER");
    sh.getRange(i + 1, cStat + 1).setValue("RECORDED");
    v[i][cStat] = "RECORDED";
    const c1 = colorRecordedRow_(sh, v, cStat, i);
    return sh.getName() + " (row " + (i + 1) + "): set to RECORDED_CHAPTER / RECORDED ✅" + (c1 ? " + coloured green" : "") + pdfMsg;
  }
  return "⚠️ " + code + " not found in " + sh.getName();
}

function recordedPalette_(bgs, v, cStat, skipIdx) {
  const n = v[0].length, counts = [];
  for (let j = 0; j < n; j++) counts.push({});
  let any = false;
  for (let i = 1; i < v.length; i++) {
    if (i === skipIdx || b_(v[i][cStat]) !== "RECORDED") continue;
    any = true;
    for (let j = 0; j < n; j++) { const c = bgs[i][j]; counts[j][c] = (counts[j][c] || 0) + 1; }
  }
  if (!any) return null;
  return counts.map(m => Object.keys(m).sort((a, b) => m[b] - m[a])[0] || "#ffffff");
}

function colorRecordedRow_(sh, v, cStat, rowIdx) {
  const n = v[0].length;
  const bgs = sh.getRange(1, 1, v.length, n).getBackgrounds();
  const pal = recordedPalette_(bgs, v, cStat, rowIdx);
  if (!pal) return false;
  const same = pal.every((c, j) => String(bgs[rowIdx][j]).toLowerCase() === String(c).toLowerCase());
  if (same) return false;
  sh.getRange(rowIdx + 1, 1, 1, n).setBackgrounds([pal]);
  return true;
}

function recolorRecordedAll() {
  if (!isOwner("nodepath")) return;
  if (frozenStop_()) return;
  const out = [];
  Object.keys(BACKUP_FILES).forEach(k => {
    const f = BACKUP_FILES[k];
    try {
      const sh = SpreadsheetApp.openByUrl(f.url).getSheets().filter(t => /^chapters?\s*_?\s*(hindi)?$/i.test(t.getName().trim()))[0];
      if (!sh) { out.push("⚠️ " + f.name + ": Chapters tab not found"); return; }
      const v = sh.getDataRange().getValues();
      const h = v[0].map(x => b_(x).toLowerCase());
      const cStat = h.indexOf("chapter_status"), cCode = h.indexOf("chapter_code");
      if (cStat < 0 || cCode < 0) { out.push("⚠️ " + f.name + ": chapter_status / chapter_code column not found"); return; }
      const n = v[0].length;
      const bgs = sh.getRange(1, 1, v.length, n).getBackgrounds();
      const pal = recordedPalette_(bgs, v, cStat, -1);
      if (!pal) { out.push(f.name + ": no RECORDED rows"); return; }
      const fixed = [];
      for (let i = 1; i < v.length; i++) {
        if (b_(v[i][cStat]) !== "RECORDED") continue;
        if (String(bgs[i][cCode]).toLowerCase() === String(pal[cCode]).toLowerCase()) continue;
        sh.getRange(i + 1, 1, 1, n).setBackgrounds([pal]);
        fixed.push(i + 1);
      }
      out.push(f.name + ": " + (fixed.length ? fixed.length + " rows coloured green (rows " + fixed.join(", ") + ")" : "all already green ✅"));
    } catch (e) { out.push("⚠️ " + f.name + ": " + (e.message || e)); }
  });
  uiAlert_("Live sheets – colour of RECORDED rows:\n\n" + out.join("\n"));
}

function b_(x) { return x === null || x === undefined ? "" : String(x).trim(); }
/** Backup copies of a tab (e.g. "_bk_20261024T104254-260e_NEET_2026_CHEMISTRY_PATH_1"): never read or changed. */
function isBackupTab_(name) { return /^_bk_/i.test(String(name).trim()); }

// ---------- NODE PATH SHEET UPDATE (runs together with Push Nodes / Push DPP) ----------

const NODE_FILES = {
  ENG: "https://docs.google.com/spreadsheets/d/1CEZsIXi2_E-uYUhcmYZ2QjGiPOM5IExFBzZC9_0CTyg/edit",
  HIN: "https://docs.google.com/spreadsheets/d/1SVn0hqNGDuESuSGZ_J7GAjGNOQ0dpTon5CM6DPxxTM0/edit"
};

function lockedNoValue_(tab, col, vals) {
  if (col.locked === undefined) return "NO";
  for (const r of vals) {
    const v = b_(r[col.locked]);
    if (v.toLowerCase() === "no") return v;
  }
  try {
    const dv = tab.getRange(2, col.locked + 1).getDataValidation();
    const list = dv && dv.getCriteriaValues()[0];
    if (Array.isArray(list)) {
      const f = list.find(v => String(v).trim().toLowerCase() === "no");
      if (f !== undefined) return String(f).trim();
    }
  } catch (e) {}
  return "NO";
}

function nodeSheetOnly_(p) {
  if (!isOwner("push_nodes")) return;
  if (frozenStop_()) return;
  let n;
  try { n = updateNodeSheet_(p); } catch (e) { n = "⚠️ " + (e.message || e); }
  logAction_("NODE_SHEET_UPDATE", p.name, /⚠️/.test(n) ? "PARTIAL" : "OK", n);
  uiAlert_(p.name + " Node Sheet:\n\n" + n);
}

function nodeSheetSafe_(p, parts) {
  try { return updateNodeSheet_(p, parts); } catch (e) { return "⚠️ " + (e.message || e); }
}

function updateNodeSheet_(p, parts) {
  const want = k => !parts || parts.indexOf(k) !== -1;
  const sh = autoSheet_();
  const code = b_(sh.getRange(p.code + p.row).getValue());
  if (code.length < 10 || !/ML\d+$/i.test(code)) throw new Error("Lecture code is incomplete (\"" + code + "\")");
  const chapterCode = code.replace(/ML\d+$/i, "");
  const m = chapterCode.match(/^2027NEET(PHY|CHE|BIO)(HIN|ENG)/i);
  if (!m) throw new Error("Code format not recognised (" + chapterCode + ")");
  const lang = m[2].toUpperCase();
  const pdf = pdfFor_(p, sh.getRange(p.pdf + p.row).getValue());
  const pdfOk = /^https?:\/\//i.test(pdf);

  const file = SpreadsheetApp.openByUrl(NODE_FILES[lang]);
  const lines = [];
  let found = 0, changed = 0, tabName = "";

  file.getSheets().forEach(tab => {
    if (isBackupTab_(tab.getName()) || tab.getLastRow() < 2) return;
    const lastCol = tab.getLastColumn();
    const hdr = tab.getRange(1, 1, 1, lastCol).getValues()[0].map(x => b_(x));
    const col = {};
    hdr.forEach((h, i) => { if (h && col[h] === undefined) col[h] = i; });
    if (col.chapter_code === undefined || col.task_type === undefined) return;

    const vals = tab.getRange(2, 1, tab.getLastRow() - 1, lastCol).getValues();
    const NO = lockedNoValue_(tab, col, vals);
    vals.forEach((r, i) => {
      if (b_(r[col.chapter_code]) !== chapterCode) return;
      found++; tabName = tab.getName();
      const rowNo = i + 2;
      const type = b_(r[col.task_type]);
      let rowChanged = false;
      const set = (k, v, label) => {
        if (col[k] === undefined || b_(r[col[k]]) === b_(v)) return;
        tab.getRange(rowNo, col[k] + 1).setValue(v);
        r[col[k]] = v; changed++; rowChanged = true;
        lines.push("  row " + rowNo + " " + label);
      };

      if ((type === "LIVE_LECTURE" || type === "VIDEO_LECTURE") && want("lecture")) {
        set("task_type", "VIDEO_LECTURE", "LIVE_LECTURE -> VIDEO_LECTURE");
        if (!b_(r[col.microlecture_code])) set("microlecture_code", code, "microlecture_code = " + code);
      } else if (type === "LIVE_CLASS_NOTES" && want("notes")) {
        if (pdfOk) {
          set("pdf_url", pdf, "Notes pdf_url");
          set("locked", NO, "Notes unlock");
        } else {
          lines.push("  row " + rowNo + " Notes: skipped (PDF cell " + p.pdf + p.row + " empty/invalid)");
        }
      } else if (type === "DAILY_PRACTICE_PROBLEMS" && want("dpp")) {
        set("test_series_id", chapterCode + "DPP", "DPP test_series_id = " + chapterCode + "DPP");
        set("test_category_id", DPP_CATEGORY[lang], "DPP test_category_id");
        set("locked", NO, "DPP unlock");
      }
    });

    // colour this chapter's rows green where they do not have the RECORDED colour yet
    // (RECORDED = the chapter has a VIDEO_LECTURE row)
    if (vals.some(r => b_(r[col.chapter_code]) === chapterCode)) {
      const bgs = tab.getRange(2, 1, vals.length, lastCol).getBackgrounds();
      const vid = {};
      vals.forEach(r => { if (b_(r[col.task_type]) === "VIDEO_LECTURE") vid[b_(r[col.chapter_code])] = true; });
      const types = vals.map(r => b_(r[col.task_type]));
      const done = vals.map(r => !!vid[b_(r[col.chapter_code])]);
      const targets = planDoneColors_(bgs, col.chapter_code, types, done, lastCol)
        .filter(t => b_(vals[t.i][col.chapter_code]) === chapterCode);
      targets.forEach(t => tab.getRange(t.i + 2, 1, 1, lastCol).setBackgrounds([t.row]));
      if (targets.length) lines.push("  " + targets.length + " rows coloured green");
    }
  });

  if (!found) return "⚠️ " + chapterCode + " not found in node sheet (nothing changed)";
  if (!changed && !lines.length) return "  " + tabName + ": " + chapterCode + " already up to date ✅";
  return "  " + tabName + " (" + chapterCode + "):\n" + lines.join("\n") + (changed ? "\n  ✅ " + changed + " cells updated" : "");
}

const CFG = {
  FILES: {
    HIN: 'https://docs.google.com/spreadsheets/d/1SVn0hqNGDuESuSGZ_J7GAjGNOQ0dpTon5CM6DPxxTM0/edit',
    ENG: 'https://docs.google.com/spreadsheets/d/1CEZsIXi2_E-uYUhcmYZ2QjGiPOM5IExFBzZC9_0CTyg/edit'
  },

  COLS: {
    code:     ['chapter_code'],
    position: ['position', 'pos'],
    status:   ['chapter_status'],
    notes:    ['notes', 'notes_url', 'notesurl', 'notes_url_hindi', 'pdf_url'],
    title:    ['title'],
    name:     ['chapter_name'],
    number:   ['chapter_number'],
    active:   ['active']
  },
  SUBJECTS: [
    { key: 'PHYSICS_HIN',   subject: 'PHYSICS',   lang: 'HIN', label: 'Physics (Hindi)',     sheet: null, tabRe: /PHY/i,       orderFile: 'PHYHIN' },
    { key: 'CHEMISTRY_HIN', subject: 'CHEMISTRY', lang: 'HIN', label: 'Chemistry (Hindi)',   sheet: null, tabRe: /CHE/i,       orderFile: 'CHEHIN' },
    { key: 'BIOLOGY_HIN',   subject: 'BIOLOGY',   lang: 'HIN', label: 'Biology (Hindi)',     sheet: null, tabRe: /BIO/i,       orderFile: 'BIOHIN' },
    { key: 'PHYSICS_ENG',   subject: 'PHYSICS',   lang: 'ENG', label: 'Physics (English)',   sheet: null, tabRe: /PHY/i,       orderFile: 'PHYENG' },
    { key: 'CHEMISTRY_ENG', subject: 'CHEMISTRY', lang: 'ENG', label: 'Chemistry (English)', sheet: null, tabRe: /CHE/i,       orderFile: 'CHEENG' },
    { key: 'BIOLOGY_ENG',   subject: 'BIOLOGY',   lang: 'ENG', label: 'Biology (English)',   sheet: null, tabRe: /BIO/i,       orderFile: 'BIOENG' }
  ],
  ORDER_BY: 'ROW',
  ADD_INACTIVE: true,                  // true = lectures with active=0 in the Chapters sheet are also added to the PATH (as locked rows)
  DONE_STATUS: ['RECORDED'],
  DONE_COLOR: '#d9ead3',               // green for RECORDED rows (only used when the sheet has no green reference row)
  ML_SUFFIX: 'ML1',
  DPP_SUFFIX: 'DPP',
  POSITION_STEP: 100,
  TYPE_RANK: {
    LIVE_LECTURE: 0, VIDEO_LECTURE: 0,
    LIVE_CLASS_NOTES: 1, DAILY_PRACTICE_PROBLEMS: 2,
    TEST: 3, TEST_ANALYSIS: 4, WEAK_TOPIC_PRACTICE: 5
  },
  CHAPTER_END_TYPES: ['TEST', 'TEST_ANALYSIS', 'WEAK_TOPIC_PRACTICE'],
  CLICK_TYPE: {
    DEMO_LECTURE: 'SINGLE', DEMO_CLASS_NOTES: 'SINGLE',
    LIVE_LECTURE: 'SINGLE', VIDEO_LECTURE: 'SINGLE', LIVE_CLASS_NOTES: 'SINGLE',
    DAILY_PRACTICE_PROBLEMS: 'LIST', TEST: 'LIST', TEST_ANALYSIS: 'LIST', WEAK_TOPIC_PRACTICE: 'LIST'
  }
};

// ============================== MENU ==============================

function menuPhysicsHin()   { menuRun_('PHYSICS_HIN'); }
function menuChemistryHin() { menuRun_('CHEMISTRY_HIN'); }
function menuBiologyHin()   { menuRun_('BIOLOGY_HIN'); }
function menuPhysicsEng()   { menuRun_('PHYSICS_ENG'); }
function menuChemistryEng() { menuRun_('CHEMISTRY_ENG'); }
function menuBiologyEng()   { menuRun_('BIOLOGY_ENG'); }

function menuRunAll() {
  if (!isOwner("nodepath")) return;
  if (frozenStop_()) return;
  const ui = SpreadsheetApp.getUi();
  const previews = [], errs = [];
  CFG.SUBJECTS.forEach(function (s) {
    try { previews.push(runSubject(s.key, { apply: false })); }
    catch (e) { errs.push('⚠️ ' + s.label + ': ' + (e.message || e)); }
  });
  const todo = previews.filter(function (p) { return p.totalChanges; });
  const warn = previews.filter(function (p) { return p.warnings && p.warnings.length; })
    .map(function (p) { return p.label + ':\n' + p.warnings.join('\n'); }).join('\n\n');
  const tail = (errs.length ? '\n\n' + errs.join('\n') : '') + (warn ? '\n\n' + warn : '');
  if (!todo.length) { ui.alert('Everything is already up to date and arranged ✅' + tail); return; }
  const txt = todo.map(function (p) { return '• ' + p.label + '\n' + p.lines.join('\n'); }).join('\n\n');
  const a = ui.alert('These changes will be made:\n\n' + txt + tail + '\n\nApply all?', ui.ButtonSet.YES_NO);
  if (a !== ui.Button.YES) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { ui.alert('Another update is running. Please try again shortly.'); return; }
  const out = [];
  try {
    todo.forEach(function (p) {
      try { const r = runSubject(p.key, { apply: true, renumber: true }); out.push('✅ ' + r.label + ' (' + r.lines.length + ' changes)'); logAction_("NODEPATH_UPDATE", p.key, "OK", r.lines.join("\n")); }
      catch (e) { out.push('⚠️ ' + p.label + ': ' + (e.message || e)); }
    });
  } finally { lock.releaseLock(); }
  ui.alert('Update complete:\n\n' + out.join('\n'));
}

function menuRun_(key) {
  if (!isOwner("nodepath")) return;
  if (frozenStop_()) return;
  const ui = SpreadsheetApp.getUi();
  let p;
  try { p = runSubject(key, { apply: false }); }
  catch (e) { ui.alert('⚠️ ' + (e.message || e)); return; }
  const w = p.warnings && p.warnings.length ? '\n\n' + p.warnings.join('\n') : '';
  if (!p.totalChanges) { ui.alert(p.label + ': already up to date and arranged ✅' + w + '\n\nSource: ' + p.source); return; }
  const a = ui.alert(p.label + ' – these changes will be made:\n\n' + p.lines.join('\n') + w + '\n\nSource: ' + p.source + '\n\nApply?', ui.ButtonSet.YES_NO);
  if (a !== ui.Button.YES) return;
  const r = runSubject(key, { apply: true, renumber: true });
  logAction_("NODEPATH_UPDATE", key, "OK", r.lines.join("\n"));
  ui.alert(r.label + ' updated ✅\n\n' + r.lines.join('\n'));
}

// ====================== OWNER CHECK (web) ======================

function assertOwner_(feature) {
  const me = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!isAllowedUser_(me)) throw new Error('You do not have permission to update.');
  if (feature) {
    const list = [].concat(feature);
    if (!list.some(f => hasFeature_(me, f))) throw new Error('You do not have access to "' + list.map(featureLabel_).join(' / ') + '". Ask an admin to allow it in Admin → Access.');
  }
}

// ====================== WEB DASHBOARD (PC + Mobile) ======================

function doGet() {
  const names = ['WebApp', 'Webapp', 'webapp', 'WEBAPP'];
  let out = null;
  for (let i = 0; i < names.length && !out; i++) {
    try { out = HtmlService.createHtmlOutputFromFile(names[i]); } catch (e) {}
  }
  if (!out) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:20px">Dashboard HTML file not found. In Apps Script use + → HTML to create a file named "WebApp".</p>');
  return out
    .setTitle('NodePath Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
}

function webInit(lang) {
  const me = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  const ok = isAllowedUser_(me);
  // SPEED: token status + lecture form in the same call (previously 3 separate calls)
  let token = null, lecture = null, lecErr = "";
  if (ok) {
    try { token = tokenStatus_(); } catch (e) { token = { valid: false, code: 0, error: String(e.message || e) }; }
    if (hasFeature_(me, "lecture")) {
      try { lecture = webLectureLoad(lang === "HIN" ? "HIN" : "ENG"); } catch (e) { lecErr = String(e.message || e); }
    }
  }
  return {
    token: token, lecture: lecture, lectureError: lecErr, envInfo: ok ? envInfo_() : null,
    freeze: ok ? freezeInfo_() : null,
    email: me,
    allowed: ok,
    isAdmin: isAdminUser_(me),
    features: ok ? userFeatures_(me) : [],
    authUrl: authUrl_(),
    pdfBase: PDF_BASE,
    tab: ok ? (function () { try { return autoSheet_().getName(); } catch (e) { return ""; } })() : "",
    subjects: CFG.SUBJECTS.map(function (s) { return { key: s.key, label: s.label, lang: s.lang, subject: s.subject }; })
  };
}

function webPreview(key, force) {
  assertOwner_("nodepath");
  const ck = "np_" + key;
  if (!force) { const hit = cacheGet_(ck); if (hit) { hit.cached = true; return hit; } }
  const r = runSubject(key, { apply: false });
  r.checkedAt = Utilities.formatDate(new Date(), "Asia/Kolkata", "hh:mm a");
  cachePut_(ck, r, 120);                        // cached for 2 min; cleared as soon as an update or push happens
  return r;
}

function webApply(key) {
  assertOwner_("nodepath");
  assertNotFrozen_();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another update is running, please try again shortly.');
  try {
    const r = runSubject(key, { apply: true, renumber: true });
    logAction_("NODEPATH_UPDATE", key, "OK", (r.lines || []).join("\n"));
    return r;
  } catch (e) {
    logAction_("NODEPATH_UPDATE", key, "FAIL", e.message || e);
    throw e;
  } finally { lock.releaseLock(); }
}

// ---------- Web: per-user AVTOKEN ----------
function tokenTest_(tok) {
  const res = UrlFetchApp.fetch(API + "personalised-paths?pageNo=0&pageSize=1&active=true", {
    headers: { avtoken: tok, origin: ORIGIN }, muteHttpExceptions: true
  });
  return res.getResponseCode();
}

function stageTokenStatus_(force) {
  const up = PropertiesService.getUserProperties();
  const tok = (up.getProperty("AVTOKEN_STAGE") || "").trim();
  const uc = CacheService.getUserCache();
  const sig = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, "stage|" + tok));
  if (!force && tok) { try { const hit = uc.get("tokst_stage"); if (hit) { const o = JSON.parse(hit); if (o.sig === sig) return o.out; } } catch (e) {} }
  const code = tok ? tokenTest_(tok) : 0;
  const out = { env: "STAGE", sharedAllowed: false, source: tok ? "own" : "none", tail: tok ? tok.slice(-4) : "",
                valid: code === 200, code: code, revoked: false, savedAt: up.getProperty("AVTOKEN_STAGE_AT") || "" };
  try { if (out.valid) uc.put("tokst_stage", JSON.stringify({ sig: sig, out: out }), 600); else uc.remove("tokst_stage"); } catch (e) {}
  return out;
}

function tokenStatus_(force) {
  if (isStage_()) return stageTokenStatus_(force);
  const me = (Session.getActiveUser().getEmail() || "").trim().toLowerCase();
  const revoked = admTokenRevoked_(me);
  const own = revoked ? "" : (PropertiesService.getUserProperties().getProperty("AVTOKEN") || "").trim();
  const sharedOk = canUseShared_(me);
  const shared = sharedOk ? (PropertiesService.getScriptProperties().getProperty("AVTOKEN") || "").trim() : "";
  const tok = own || shared;
  // SPEED: a valid token result is cached for 10 min (no API call on every page load). A different token changes the signature.
  const uc = CacheService.getUserCache();
  const sig = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, me + "|" + tok + "|" + revoked + "|" + sharedOk));
  if (!force && tok) {
    try { const hit = uc.get("tokst"); if (hit) { const o = JSON.parse(hit); if (o.sig === sig) return o.out; } } catch (e) {}
  }
  const code = tok ? tokenTest_(tok) : 0;
  const out = {
    sharedAllowed: sharedOk,
    source: own ? "own" : (shared ? "shared" : "none"),
    tail: tok ? tok.slice(-4) : "",
    valid: code === 200,
    code: code,
    revoked: revoked,
    savedAt: PropertiesService.getUserProperties().getProperty("AVTOKEN_AT") || ""
  };
  tokenRegistryUpdate_(me, { tail: out.tail, source: out.source, status: revoked ? "reset by admin" : (out.valid ? "valid" : (code === 401 ? "expired (401)" : "error " + code)),
                             checkedAt: new Date().toLocaleString(), savedAt: out.savedAt });
  try { if (out.valid) uc.put("tokst", JSON.stringify({ sig: sig, out: out }), 600); else uc.remove("tokst"); } catch (e) {}
  return out;
}

function webTokenStatus(force) { assertOwner_(); return tokenStatus_(!!force); }

function webTokenSave(tok) {
  assertOwner_();
  tok = String(tok || "").trim().replace(/^avtoken\s*:\s*/i, "").replace(/^["']|["']$/g, "");
  if (!tok) throw new Error("Token is empty");
  const code = tokenTest_(tok);
  if (code === 401) throw new Error("This token is not valid (401) for " + envLabel_() + ". Copy a fresh token from " + (isStage_() ? "Stage " : "") + "Internal Metrics and try again.");
  if (code !== 200) throw new Error("Could not verify the token (HTTP " + code + "). Nothing was saved.");
  const up = PropertiesService.getUserProperties();
  if (isStage_()) {
    const old = (up.getProperty("AVTOKEN_STAGE") || "").trim().slice(-4);
    up.setProperty("AVTOKEN_STAGE", tok); up.setProperty("AVTOKEN_STAGE_AT", new Date().toLocaleString());
    TOKEN_ = null;
    logAction_("TOKEN_SAVE", "stage", "OK", "Stage token …" + old + " → …" + tok.slice(-4));
    return tokenStatus_(true);
  }
  const me = (Session.getActiveUser().getEmail() || "").trim().toLowerCase();
  const oldTail = (up.getProperty("AVTOKEN") || "").trim().slice(-4);
  up.setProperty("AVTOKEN", tok);
  up.setProperty("AVTOKEN_AT", new Date().toLocaleString());
  up.setProperty("AVTOKEN_AT_MS", String(Date.now()));
  TOKEN_ = null;
  tokenHistory_(me, "SAVED_BY_USER", oldTail, tok.slice(-4), "");
  logAction_("TOKEN_SAVE", me, "OK", "…" + oldTail + " → …" + tok.slice(-4));
  return tokenStatus_(true);
}

function webTokenClear() {
  assertOwner_();
  const up = PropertiesService.getUserProperties();
  if (isStage_()) {
    const old = (up.getProperty("AVTOKEN_STAGE") || "").trim().slice(-4);
    up.deleteProperty("AVTOKEN_STAGE"); up.deleteProperty("AVTOKEN_STAGE_AT");
    TOKEN_ = null;
    logAction_("TOKEN_REMOVE", "stage", "OK", "Stage token …" + old);
    return tokenStatus_(true);
  }
  const me = (Session.getActiveUser().getEmail() || "").trim().toLowerCase();
  const oldTail = (up.getProperty("AVTOKEN") || "").trim().slice(-4);
  up.deleteProperty("AVTOKEN"); up.deleteProperty("AVTOKEN_AT"); up.deleteProperty("AVTOKEN_AT_MS");
  TOKEN_ = null;
  tokenHistory_(me, "REMOVED_BY_USER", oldTail, "", "");
  logAction_("TOKEN_REMOVE", me, "OK", "…" + oldTail);
  return tokenStatus_(true);
}

// ---------- Web: Lecture Push (input cells of the Automation sheet) ----------
const LEC_INPUT = {
  ENG: { p: PUSH_ENGLISH, code: "C4",  link: "D4",  start: ["G3", "H3", "I3"], end: ["G4", "H4", "I4"],   vids: "N7:P7" },
  HIN: { p: PUSH_HINDI,   code: "C10", link: "D10", start: ["G9", "H9", "I9"], end: ["G10", "H10", "I10"], vids: "O13:Q13" }
};
// Video links written straight into the push row: SSD (360p), 480p, 720p – in this order
const VIDEO_FIELDS = [["ssd", "SSD / 360p"], ["v480p", "480p"], ["v720p", "720p"]];

/** Find the lecture in Internal Metrics and write SSD / 480p / 720p into the push row (replaces any formula there). */
function writeVideoLinks_(sh, c, code) {
  const rng = sh.getRange(c.vids);
  if (!code) { rng.clearContent(); return ""; }
  const lectureCode = /ML\d+$/i.test(code) ? code : code.replace(/ML\d+$/i, "") + CFG.ML_SUFFIX;
  let lecture = null;
  try { lecture = getLecture(lectureCode); }
  catch (e) { rng.clearContent(); return "Could not fetch the video links: " + (e.message || e); }
  if (!lecture) { rng.clearContent(); return lectureCode + " was not found in Internal Metrics yet – try again after the video is uploaded."; }
  const vals = VIDEO_FIELDS.map(f => { const v = String(lecture[f[0]] || "").trim(); return /^https?:\/\//i.test(v) ? v : ""; });
  if (!vals[2]) vals[2] = find720(lecture) || "";
  rng.setValues([vals]);
  const missing = VIDEO_FIELDS.filter((f, i) => !vals[i]).map(f => f[1]);
  return missing.length ? "Not available in Internal Metrics yet: " + missing.join(", ") + ". Click \"Click here for links\" again later." : "";
}

function checkCodeLang_(code, lang) {
  code = String(code || "").trim().toUpperCase();
  if (!code) return;
  const m = code.match(/^2027NEET(?:PHY|CHE|BIO)(HIN|ENG)/);
  const want = String(lang).toUpperCase();
  const name = x => x === "HIN" ? "Hindi" : "English";
  if (!m) throw new Error("Invalid lecture code format: " + code + "\n(must be 2027NEET + PHY/CHE/BIO + HIN/ENG ...)");
  if (m[1] !== want) throw new Error("This is a " + name(m[1]) + " lecture code (" + code + ").\nEnter it in the " + name(m[1]) + " tab, not " + name(want) + ".");
}

function lecCfg_(lang) {
  const c = LEC_INPUT[String(lang).toUpperCase()];
  if (!c) throw new Error("Invalid language: " + lang);
  return c;
}

function webLectureLoad(lang) {
  assertOwner_("lecture");
  const c = lecCfg_(lang), p = c.p;
  const sh = autoSheet_();
  if (!sh) throw new Error('"' + SHEET_NAME + '" tab not found');
  const r0 = Math.min(a1_(c.code).r, a1_(c.start[0]).r), r1 = p.row;
  const ncol = Math.max(colIdx_(p.pdf), colIdx_(c.end[2])) + 1;
  const blk = sh.getRange(r0, 1, r1 - r0 + 1, ncol).getDisplayValues();
  const v = a1 => { const q = a1_(a1); return blk[q.r - r0][q.c - 1]; };
  const pdfFormula = sh.getRange(p.pdf + p.row).getFormula();
  return {
    lang: String(lang).toUpperCase(),
    code: v(c.code),
    links: (function () { const a = sh.getRange(c.vids).getDisplayValues()[0]; return VIDEO_FIELDS.map((f, i) => ({ label: f[1], url: a[i] || "" })); })(),
    start: c.start.map(v), end: c.end.map(v),
    row: {
      lectureCode: v(p.code + p.row),
      defaultStart: v(p.start + p.row),
      videoStart: v(p.vs + p.row),
      videoEnd: v(p.ve + p.row),
      pdf: v(p.pdf + p.row),
      pdfIsFormula: !!pdfFormula
    }
  };
}

function webLectureSave(lang, d) {
  assertOwner_("lecture");
  const c = lecCfg_(lang), p = c.p;
  const sh = autoSheet_();
  if (!sh) throw new Error('"' + SHEET_NAME + '" tab not found');
  d = d || {};
  const num = x => { const s = String(x == null ? "" : x).trim(); return s === "" ? "" : Number(s); };

  const skipped = [];
  const r0 = Math.min(a1_(c.code).r, a1_(c.start[0]).r), r1 = Math.max(a1_(c.code).r, a1_(c.end[0]).r);
  const ncol = colIdx_(c.end[2]) + 1;
  const rg = sh.getRange(r0, 1, r1 - r0 + 1, ncol);
  const F = rg.getFormulas(), V = rg.getValues(), D = rg.getDisplayValues();
  const at = (M, a1) => { const q = a1_(a1); return M[q.r - r0][q.c - 1]; };
  const put = (a1, val) => {
    if (at(F, a1)) { skipped.push(a1); return; }
    if (String(at(V, a1)) !== String(val)) sh.getRange(a1).setValue(val);
  };

  const code = String(d.code || "").trim().toUpperCase();
  checkCodeLang_(code, lang);                 // Hindi codes only in the Hindi tab, English codes only in the English tab
  const oldCode = String(at(D, c.code)).trim().toUpperCase();
  put(c.code, code);
  [0, 1, 2].forEach(i => {
    put(c.start[i], num(d.start && d.start[i]));
    put(c.end[i], num(d.end && d.end[i]));
  });

  const pdfNote = skipped.length ? "These cells contain formulas, so they were not written: " + skipped.join(", ") : "";
  SpreadsheetApp.flush();

  // Video links (SSD / 480p / 720p) go straight into the push row (N7:P7 English, O13:Q13 Hindi).
  // Fetched when the code changed, when asked (Click here for links), or when a link is still missing.
  let linkNote = "";
  const haveAll = sh.getRange(c.vids).getDisplayValues()[0].every(x => /^https?:\/\//i.test(String(x).trim()));
  if (!code || code !== oldCode || d.refetch || !haveAll) { linkNote = writeVideoLinks_(sh, c, code); SpreadsheetApp.flush(); }

  const out = webLectureLoad(lang);
  out.note = [pdfNote, linkNote].filter(Boolean).join("\n");
  // check that the copied tab's formulas work (row 7/13 must show this tab's code)
  if (code && String(out.row.lectureCode || "").toUpperCase().indexOf(code) !== 0) {
    out.note = (out.note ? out.note + "\n" : "") + "⚠️ Row " + p.row + " in tab \"" + sh.getName() + "\" shows \"" + (out.row.lectureCode || "(empty)") +
      "\" instead of " + code + ". This tab's formulas may still read from another tab – please check before pushing.";
  }
  return out;
}

// ---------- Web: PDF (notes column of the subject live sheet's Chapters tab) ----------
const PDF_BASE = "https://dm80t6147awlm.cloudfront.net/";
const PDF_NOTE_COLS = ["notes", "notes_url", "notesurl", "notes_url_hindi"];   // every one of these columns that exists is written

function pdfUrlFromKey_(k) {
  k = String(k || "").trim();
  if (!k) return "";
  if (/^https?:\/\//i.test(k)) return k;
  k = k.replace(/^s3:\/\/[^\/]+\//i, "").replace(/^\/+/, "");
  if (!/\.pdf$/i.test(k)) k += ".pdf";
  return PDF_BASE + k;
}

function livePdfLocate_(code) {
  const chapterCode = String(code || "").trim().toUpperCase().replace(/ML\d+$/i, "");
  const m = chapterCode.match(/^2027NEET(PHY|CHE|BIO)(HIN|ENG)/);
  if (!m) throw new Error("Enter a valid lecture code first (current: \"" + chapterCode + "\")");
  const f = BACKUP_FILES[m[1] + m[2]];
  if (!f || !f.url) throw new Error("Live sheet is not set for this subject: " + m[1] + m[2]);
  const file = SpreadsheetApp.openByUrl(f.url);
  const tab = file.getSheets().filter(t => /^chapters?\s*_?\s*(hindi)?$/i.test(t.getName().trim()))[0];
  if (!tab) throw new Error("Chapters / ChaptersHindi tab not found (" + f.name + ")");
  const v = tab.getDataRange().getValues();
  const hdr = v[0].map(h => b_(h).toLowerCase());
  const cCode = hdr.indexOf("chapter_code");
  if (cCode < 0) throw new Error("chapter_code column not found (" + f.name + " / " + tab.getName() + ")");
  let cols = PDF_NOTE_COLS.map(n => hdr.indexOf(n)).filter(i => i >= 0);
  if (!cols.length && hdr.indexOf("pdf_url") >= 0) cols = [hdr.indexOf("pdf_url")];
  if (!cols.length) throw new Error("Notes / PDF column not found (" + f.name + " / " + tab.getName() + ")");
  let row = -1;
  for (let i = 1; i < v.length; i++) if (b_(v[i][cCode]).toUpperCase() === chapterCode) { row = i; break; }
  if (row < 0) throw new Error(chapterCode + " not found in " + f.name + " / " + tab.getName());
  return { chapterCode: chapterCode, tab: tab, row: row + 1, cols: cols, names: cols.map(i => hdr[i]),
           values: cols.map(i => b_(v[row][i])), fileName: f.name, tabName: tab.getName() };
}

function webPdfImport(lang, code) {
  assertOwner_("lecture");
  checkCodeLang_(code, lang);
  const L = livePdfLocate_(code);
  const out = { url: L.values.filter(Boolean)[0] || "", where: L.fileName + " / " + L.tabName + " / row " + L.row,
                chapterCode: L.chapterCode, backup: null };

  const bt = L.tab.getParent().getSheetByName(L.chapterCode + BACKUP_TAB_SUFFIX);
  if (bt && bt.getLastRow() >= 2 && bt.getLastColumn() >= 1) {
    const two = bt.getRange(1, 1, 2, bt.getLastColumn()).getDisplayValues();
    const h = two[0].map(x => b_(x).toLowerCase());
    const get = n => { const i = h.indexOf(n); return i >= 0 ? b_(two[1][i]) : ""; };
    out.backup = {
      tab: bt.getName(),
      lectureCode: get("micro_lecture_code"),
      defaultStart: get("default_start_time"),
      videoStart: get("video_start_position"),
      videoEnd: get("video_end_position"),
      link: get("720p"),
      pdf: get("pdf_url")
    };
    if (!out.url && /^https?:\/\//i.test(out.backup.pdf)) out.url = out.backup.pdf;
  }
  return out;
}

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

  const p = lecCfg_(lang).p;
  const sheetPdf = autoSheet_().getRange(p.pdf + p.row).getDisplayValue().trim();
  const sameLecture = String(autoSheet_().getRange(p.code + p.row).getDisplayValue())
    .toUpperCase().indexOf(L.chapterCode) === 0;
  return {
    url: url, where: L.fileName + " / " + L.tabName + " / row " + L.row,
    wrote: wrote, skipped: skipped,
    automationCell: p.pdf + p.row, automationPdf: sheetPdf,
    matches: sameLecture && sheetPdf === url, sameLecture: sameLecture
  };
}

function webLectureClear(lang) {
  assertOwner_("lecture");
  const c = lecCfg_(lang), p = c.p;
  const sh = autoSheet_();
  if (!sh) throw new Error('"' + SHEET_NAME + '" tab not found');
  const cells = [c.code].concat(c.start, c.end);
  sh.getRange(c.vids).clearContent();                 // video links of this lecture
  logAction_("CLEAR_ENTRY", sh.getName() + " (" + lang + ")", "OK", sh.getRange(c.code).getDisplayValue());
  const skipped = [];
  cells.forEach(a1 => {
    const r = sh.getRange(a1);
    if (r.getFormula()) { skipped.push(a1); return; }
    r.clearContent();
  });
  SpreadsheetApp.flush();
  const out = webLectureLoad(lang);
  out.note = "";
  return out;
}

// ---------- Web: TODAY tab (today's work in one place, read-only) ----------
const TODAY_TZ = "Asia/Kolkata";
const TODAY_BACKLOG_DAYS = 0;          // 0 = only the selected day (earlier days are not shown)
const TODAY_LOG_ROWS = 4000;           // number of rows read from the end of the Logs tab

function todayKey_(d) { return Utilities.formatDate(d, TODAY_TZ, "yyyy-MM-dd"); }

/** live_date cell -> "yyyy-MM-dd" (accepts Date objects, dd/MM/yyyy, yyyy-MM-dd, 19-Oct-2026) */
function todayDateKey_(raw, disp) {
  if (raw instanceof Date && !isNaN(raw)) return todayKey_(raw);
  const s = b_(disp || raw);
  if (!s) return "";
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return y + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2); }
  const d = new Date(s);
  return isNaN(d) ? "" : todayKey_(d);
}

/** "10:30 AM" / "14:05" / "14:05:00" -> minutes since midnight (or -1) */
function todayMin_(raw, disp) {
  if (raw instanceof Date && !isNaN(raw)) {
    const hm = Utilities.formatDate(raw, TODAY_TZ, "HH:mm").split(":");
    return Number(hm[0]) * 60 + Number(hm[1]);
  }
  const m = b_(disp || raw).match(/^(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  if (!m) return -1;
  let h = Number(m[1]) % 24;
  const ap = (m[3] || "").toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + Number(m[2]);
}

/** PUSH_* records from the Logs tab (chapterCode -> {dash, nodes, dpp}) */
function todayLogMap_() {
  const out = {};
  const sh = book_().getSheetByName(ADM.LOG_TAB);
  if (!sh || sh.getLastRow() < 2) return out;
  const n = Math.min(TODAY_LOG_ROWS, sh.getLastRow() - 1);
  const v = sh.getRange(sh.getLastRow() - n + 1, 1, n, 5).getDisplayValues();   // Time, Email, Action, Target, Result
  const KIND = { PUSH_DASHBOARD: "dash", PUSH_NODES: "nodes", PUSH_DPP: "dpp" };
  v.forEach(r => {
    const k = KIND[b_(r[2])];
    if (!k) return;
    const chap = b_(r[3]).toUpperCase().replace(/ML\d+$/, "");
    if (!chap) return;
    const ok = /^OK$/i.test(b_(r[4]));
    const o = out[chap] = out[chap] || {};
    if (ok) o[k] = { ok: true, at: b_(r[0]), by: b_(r[1]) };                 // a later row = more recent
    else if (!o[k] || !o[k].ok) o[k] = { ok: false, at: b_(r[0]), by: b_(r[1]) };
  });
  return out;
}

/**
 * dateStr: "yyyy-MM-dd" (empty = today). Classes of that day from every subject live sheet
 * plus unfinished classes of the previous TODAY_BACKLOG_DAYS days.
 */
function todayDay_(dateStr) {
  const now = new Date();
  const todayK = todayKey_(now);
  const dayK = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || "")) ? String(dateStr) : todayK;
  const p = dayK.split("-").map(Number);
  const dayNoon = new Date(Date.UTC(p[0], p[1] - 1, p[2], 6, 30));          // IST dopahar, timezone safe
  return { now: now, todayK: todayK, dayK: dayK,
           fromK: todayKey_(new Date(dayNoon.getTime() - TODAY_BACKLOG_DAYS * 86400000)),
           nowMin: todayMin_(Utilities.formatDate(now, TODAY_TZ, "HH:mm")),
           nowText: Utilities.formatDate(now, TODAY_TZ, "dd MMM yyyy, hh:mm a") };
}

/** Lectures of the day from one live sheet (without log status – that is merged on the client) */
function todayFileItems_(key, D) {
  const f = BACKUP_FILES[key];
  if (!f) throw new Error("Unknown subject: " + key);
  const file = SpreadsheetApp.openByUrl(f.url);
  const tab = file.getSheets().filter(t => /^chapters?\s*_?\s*(hindi)?$/i.test(t.getName().trim()))[0];
  if (!tab) throw new Error(f.name + ": Chapters tab not found");
  const rng = tab.getDataRange();
  const v = rng.getValues(), d = rng.getDisplayValues();
  const h = d[0].map(x => b_(x).toLowerCase());
  const ci = n => h.indexOf(n);
  const C = {
    code: ci("chapter_code"), title: ci("title"), teacher: ci("teacher_name"), date: ci("live_date"),
    start: ci("live_start_time"), end: ci("live_end_time"), type: ci("chapter_type"), status: ci("chapter_status")
  };
  if (C.code < 0 || C.date < 0) throw new Error(f.name + ": chapter_code / live_date column not found");
  let pdfCols = PDF_NOTE_COLS.map(n => h.indexOf(n)).filter(i => i >= 0);
  if (!pdfCols.length && h.indexOf("pdf_url") >= 0) pdfCols = [h.indexOf("pdf_url")];
  const lang = key.slice(3);
  const items = [];
  for (let i = 1; i < v.length; i++) {
    const code = b_(d[i][C.code]).toUpperCase();
    if (!/^2027NEET(PHY|CHE|BIO)(HIN|ENG)/.test(code)) continue;
    const dk = todayDateKey_(v[i][C.date], d[i][C.date]);
    if (!dk || dk > D.dayK || dk < D.fromK) continue;
    const status = C.status >= 0 ? b_(d[i][C.status]).toUpperCase() : "";
    const recorded = status === "RECORDED";
    const endMin = C.end >= 0 ? todayMin_(v[i][C.end], d[i][C.end]) : -1;
    const bt = file.getSheetByName(code + BACKUP_TAB_SUFFIX);
    items.push({
      key: key, subject: f.name, lang: lang, code: code, lectureCode: code + CFG.ML_SUFFIX,
      title: C.title >= 0 ? b_(d[i][C.title]) : "", teacher: C.teacher >= 0 ? b_(d[i][C.teacher]) : "",
      date: dk, dateText: b_(d[i][C.date]), backlog: dk < D.dayK,
      start: C.start >= 0 ? b_(d[i][C.start]) : "", end: C.end >= 0 ? b_(d[i][C.end]) : "",
      startMin: C.start >= 0 ? todayMin_(v[i][C.start], d[i][C.start]) : -1, endMin: endMin,
      type: C.type >= 0 ? b_(d[i][C.type]).toUpperCase() : "", status: status, row: i + 1,
      recorded: recorded, pdf: pdfCols.map(j => b_(d[i][j])).filter(x => /^https?:\/\//i.test(x))[0] || "",
      backup: !!(bt && bt.getLastRow() >= 2)
    });
  }
  return items;
}

/** SPEED: the dashboard sends these 6 calls in parallel (each call opens a single sheet) */
function webTodayFile(key, dateStr, force) {
  assertOwner_("today");
  const D = todayDay_(dateStr);
  const ck = "td_" + key + "_" + D.dayK;
  let out = force ? null : cacheGet_(ck);
  if (!out) {
    out = { key: key, items: [], error: "" };
    try { out.items = todayFileItems_(key, D); } catch (e) { out.error = (BACKUP_FILES[key] ? BACKUP_FILES[key].name + ": " : "") + (e.message || e); }
    if (!out.error) cachePut_(ck, out, 120);
  }
  out.date = D.dayK; out.today = D.todayK; out.now = D.nowText; out.nowMin = D.nowMin; out.backlogDays = TODAY_BACKLOG_DAYS;
  return out;
}

function webTodayLogs(force) {
  assertOwner_("today");
  let m = force ? null : cacheGet_("td_logs");
  if (!m) { m = {}; try { m = todayLogMap_(); } catch (e) {} cachePut_("td_logs", m, 60); }
  return m;
}

/** Merge status (the client does the same) */
function todayMerge_(items, logs, D) {
  items.forEach(x => {
    const L = logs[x.code] || {};
    x.over = x.recorded || x.date < D.todayK || (x.date === D.todayK && x.endMin >= 0 && D.nowMin >= x.endMin);
    x.dash = !!(L.dash && L.dash.ok) || (x.recorded && x.backup);
    x.nodes = !!(L.nodes && L.nodes.ok);
    x.dpp = !!(L.dpp && L.dpp.ok);
    x.done = x.recorded && x.dash && x.nodes && !!x.pdf && x.dpp;
    x.log = { dash: L.dash || null, nodes: L.nodes || null, dpp: L.dpp || null };
  });
  return items;
}

/** Legacy single-call version – the dashboard now uses the parallel calls */
function webToday(dateStr) {
  assertOwner_("today");
  const D = todayDay_(dateStr);
  const logs = webTodayLogs(false);
  let items = [];
  const errors = [];
  Object.keys(BACKUP_FILES).forEach(key => {
    const r = webTodayFile(key, D.dayK, false);
    if (r.error) errors.push(r.error); else items = items.concat(r.items);
  });
  todayMerge_(items, logs, D);
  items = items.filter(x => !(x.backlog && x.done));
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || (a.startMin - b.startMin) || (a.code < b.code ? -1 : 1));
  return { date: D.dayK, today: D.todayK, from: D.fromK, now: D.nowText, backlogDays: TODAY_BACKLOG_DAYS, items: items, errors: errors };
}

// ---------- Web: NodePath file -> Internal Metrics upload ----------
// UPLOAD_URL comes from the chosen server (see IM_ENVS at the top); batchId per language: IM_ENVS[..].batch

function upCfg_(lang) {
  lang = String(lang).toUpperCase();
  if (!envBatch_(lang)) throw new Error("Invalid language: " + lang);
  const url = CFG.FILES[lang];
  const id = (String(url).match(/\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
  if (!id) throw new Error("NodePath file URL is not set for " + lang);
  return { lang: lang, batchId: envBatch_(lang), fileId: id, url: url };
}

/** Info tab of the NodePath file (with path_id / subject / update / active) */
function upInfoTab_(ss) {
  const tabs = ss.getSheets().filter(t => !isBackupTab_(t.getName()));
  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i];
    if (t.getLastRow() < 1 || t.getLastColumn() < 1) continue;
    const h = t.getRange(1, 1, 1, t.getLastColumn()).getDisplayValues()[0].map(x => b_(x).toLowerCase());
    if (h.indexOf("path_id") >= 0 && h.indexOf("update") >= 0) return { tab: t, h: h };
  }
  throw new Error("Info tab (with path_id and update columns) not found in the NodePath file");
}

function webUploadInfo(lang, force) {
  assertOwner_("upload");
  const c = upCfg_(lang);
  const ck = "up_" + c.lang;
  if (!force) { const hit = cacheGet_(ck); if (hit) { hit.last = upLast_(c.lang); return hit; } }
  const out = webUploadInfoRead_(c);
  cachePut_(ck, out, 120);
  out.last = upLast_(c.lang);
  return out;
}
function webUploadInfoRead_(c) {
  const ss = SpreadsheetApp.openById(c.fileId);
  const it = upInfoTab_(ss), h = it.h, t = it.tab;
  const v = t.getLastRow() > 1 ? t.getRange(2, 1, t.getLastRow() - 1, h.length).getDisplayValues() : [];
  const col = n => h.indexOf(n);
  const rows = v.map((r, i) => ({
    row: i + 2,
    pathId: r[col("path_id")], subject: col("subject") >= 0 ? r[col("subject")] : "",
    language: col("language") >= 0 ? r[col("language")] : "", version: col("version") >= 0 ? r[col("version")] : "",
    update: String(r[col("update")]).trim().toLowerCase() === "yes",
    active: col("active") >= 0 ? r[col("active")] : ""
  })).filter(x => x.pathId);
  return { lang: c.lang, batchId: c.batchId, fileName: ss.getName(), tabName: t.getName(), rows: rows };
}

/** Set update = yes / no in the info tab */
function webUploadSetFlag(lang, row, yes) {
  assertOwner_("upload");
  assertNotFrozen_();
  const c = upCfg_(lang);
  const it = upInfoTab_(SpreadsheetApp.openById(c.fileId));
  const cell = it.tab.getRange(Number(row), it.h.indexOf("update") + 1);
  const old = b_(cell.getDisplayValue());
  const val = old && old === old.toUpperCase() ? (yes ? "YES" : "NO") : (yes ? "yes" : "no");   // keep the case used in the sheet
  cell.setValue(val);
  logAction_("UPLOAD_FLAG", c.lang + " row " + row, "OK", "update: " + old + " → " + val);
  return webUploadInfo(lang, true);
}

function upLastKey_(lang) { return "IM_LAST_UPLOAD_" + lang + (isStage_() ? "_STAGE" : ""); }
function upLast_(lang) {
  try { return JSON.parse(PropertiesService.getUserProperties().getProperty(upLastKey_(lang)) || "null"); } catch (e) { return null; }
}

/** Export the whole NodePath file as .xlsx and upload it to Internal Metrics */
function webUploadNow(lang) {
  assertOwner_("upload");
  assertNotFrozen_();
  const c = upCfg_(lang);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("Another update is running, please try again shortly.");
  try {
    const info = webUploadInfo(lang);
    const yes = info.rows.filter(r => r.update).map(r => r.subject || r.pathId);
    if (!yes.length) throw new Error("No subject has update = yes in the info tab. Nothing to upload.");

    const name = DriveApp.getFileById(c.fileId).getName();
    const exp = UrlFetchApp.fetch("https://docs.google.com/spreadsheets/d/" + c.fileId + "/export?format=xlsx", {
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
    });
    if (exp.getResponseCode() !== 200) throw new Error("Could not export the NodePath file as .xlsx (HTTP " + exp.getResponseCode() + ")");
    const blob = exp.getBlob().setName(name + ".xlsx")
      .setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

    const res = UrlFetchApp.fetch(UPLOAD_URL, {
      method: "post",
      headers: { avtoken: token_(), origin: ORIGIN },
      payload: { file: blob, batchId: String(c.batchId) },
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code === 401) throw new Error(TOKEN_EXPIRED_MSG);
    const body = res.getContentText().substring(0, 2000);
    const ok = code >= 200 && code < 300;
    const last = { at: Date.now(), batchId: c.batchId, subjects: yes, code: code, done: false };
    if (ok) PropertiesService.getUserProperties().setProperty(upLastKey_(c.lang), JSON.stringify(last));
    logAction_("IM_UPLOAD", name + " (batch " + c.batchId + ")", ok ? "PENDING" : "FAIL",
      "HTTP " + code + " · subjects: " + yes.join(", ") + (body ? "\n" + body : ""));
    return { ok: ok, code: code, body: body, subjects: yes, last: ok ? last : upLast_(c.lang), fileName: name };
  } finally { lock.releaseLock(); }
}

// ---------- Web: DPP upload (selected DPPs only -> small file -> Internal Metrics) ----------
// One DPP file per subject + language. Paste the full URL of each file here.
const DPP_FILES = {
  PHYHIN: "https://docs.google.com/spreadsheets/d/1RtooDZMOtShNv0hEvbcnP7SMXasFD0A6DiD9aaNFLdc/edit",
  PHYENG: "https://docs.google.com/spreadsheets/d/1_dZNeKEHcsLeoITpWduicSiPXITmOkOILuF72NfRZls/edit",
  CHEHIN: "https://docs.google.com/spreadsheets/d/1wweNGyf3e5bi8_htoNQYszVJ_Ns5sRc5f1bgZPtEZKk/edit",
  CHEENG: "https://docs.google.com/spreadsheets/d/1ICQAt-Gdv3JrjpsfkRDZaQfWc2aWM0e8w8FCMjdS4cc/edit",
  BIOHIN: "https://docs.google.com/spreadsheets/d/1TxuZaKuC-Lruipv0ZGphA778plWETAMN-DtNPl8wPvY/edit",
  BIOENG: "https://docs.google.com/spreadsheets/d/16l3YjEXNzhwuHludV1fhn4UiMaAZO7VSJ_NygZbMZ18/edit"
};
const DPP_LANG = { HIN: { param: "HINDI", batchId: 100 }, ENG: { param: "ENGLISH", batchId: 99 } };

function dppCfg_(key) {
  key = String(key || "").toUpperCase();
  const m = key.match(/^(PHY|CHE|BIO)(HIN|ENG)$/);
  if (!m) throw new Error("Invalid DPP subject: " + key);
  const id = (String(DPP_FILES[key] || "").match(/\/d\/([a-zA-Z0-9_-]+)/) || [])[1];
  if (!id) throw new Error("DPP file link is not set for " + key + " (DPP_FILES in Code.gs).");
  return { key: key, lang: m[2], fileId: id, name: (BACKUP_FILES[key] || {}).name || key };
}

/** Info tab of a DPP file (name starts with "Info", or the first tab with Id / Name / Update headers). */
function dppInfoTab_(ss) {
  const tabs = ss.getSheets().filter(t => !isBackupTab_(t.getName()));
  const byHeader = t => {
    if (t.getLastRow() < 1 || t.getLastColumn() < 1) return null;
    const h = t.getRange(1, 1, 1, t.getLastColumn()).getDisplayValues()[0].map(x => b_(x).toLowerCase());
    return h.indexOf("id") >= 0 && h.indexOf("name") >= 0 && h.indexOf("update") >= 0 ? h : null;
  };
  const named = tabs.filter(t => /^info/i.test(t.getName().trim()));
  for (const t of named.concat(tabs)) { const h = byHeader(t); if (h) return { tab: t, h: h }; }
  throw new Error("Info tab (with Id, Name and Update columns) not found in " + ss.getName());
}

/** List of DPPs for the dashboard */
function webDppList(key) {
  assertOwner_("dpp");
  const c = dppCfg_(key);
  const ss = SpreadsheetApp.openById(c.fileId);
  const it = dppInfoTab_(ss), t = it.tab, h = it.h;
  const col = n => h.indexOf(n);
  const n = t.getLastRow() - 1;
  const rng = n > 0 ? t.getRange(2, 1, n, h.length) : null;
  const d = rng ? rng.getDisplayValues() : [], v = rng ? rng.getValues() : [];
  const tabNames = {};
  ss.getSheets().forEach(s => { tabNames[s.getName().trim()] = 1; });
  const cDate = col("live_date");
  const rows = [];
  d.forEach((r, i) => {
    const id = b_(r[col("id")]);
    if (!id) return;
    const name = b_(r[col("name")]);
    rows.push({
      row: i + 2, id: id, name: name,
      position: col("position") >= 0 ? r[col("position")] : "",
      liveDate: cDate >= 0 ? r[cDate] : "",
      liveStart: col("live_start_time") >= 0 ? r[col("live_start_time")] : "",
      liveEnd: col("live_end_time") >= 0 ? r[col("live_end_time")] : "",
      liveKey: cDate >= 0 ? todayDateKey_(v[i][cDate], r[cDate]) : "",
      update: /^yes$/i.test(b_(r[col("update")])),
      hasTab: !!tabNames[name]
    });
  });
  return { key: c.key, lang: c.lang, name: c.name, fileName: ss.getName(), infoTab: t.getName(),
           fileUrl: "https://docs.google.com/spreadsheets/d/" + c.fileId + "/edit", rows: rows,
           today: todayKey_(new Date()) };
}

/** Set Update = Yes / No for the given rows ({row, yes}) – keeps the sheet's own spelling (Yes/No, YES/NO …) */
function webDppSetFlags(key, changes) {
  assertOwner_("dpp");
  assertNotFrozen_();
  const c = dppCfg_(key);
  changes = (changes || []).filter(x => x && Number(x.row) >= 2);
  if (!changes.length) return webDppList(key);
  const ss = SpreadsheetApp.openById(c.fileId);
  const it = dppInfoTab_(ss), t = it.tab, cu = it.h.indexOf("update") + 1;
  const last = t.getLastRow();
  const rng = t.getRange(2, cu, last - 1, 1);
  const vals = rng.getValues(), forms = rng.getFormulas();
  const sample = vals.map(r => b_(r[0])).filter(x => /^(yes|no)$/i.test(x))[0] || "Yes";
  const word = yes => sample === sample.toUpperCase() ? (yes ? "YES" : "NO") : sample === sample.toLowerCase() ? (yes ? "yes" : "no") : (yes ? "Yes" : "No");
  const done = [], skipped = [];
  changes.forEach(ch => {
    const i = Number(ch.row) - 2;
    if (i < 0 || i >= vals.length) return;
    if (forms[i][0]) { skipped.push(ch.row); return; }
    vals[i][0] = word(!!ch.yes); done.push((ch.yes ? "Yes: " : "No: ") + "row " + ch.row);
  });
  rng.setValues(vals);
  SpreadsheetApp.flush();
  logAction_("DPP_FLAG", c.key, "OK", done.join(", ") + (skipped.length ? " | formula cells skipped: " + skipped.join(", ") : ""));
  return webDppList(key);
}

/**
 * Change live_date / live_start_time / live_end_time of one DPP row.
 * date = "yyyy-MM-dd", start / end = "HH:mm" or "HH:mm:ss". Keeps the cell type the sheet already uses
 * (real date/time values stay date/time values, text stays text in the same style). Formula cells are not touched.
 */
function webDppSetSchedule(key, row, date, start, end) {
  assertOwner_("dpp");
  assertNotFrozen_();
  const c = dppCfg_(key);
  row = Number(row);
  if (!(row >= 2)) throw new Error("Invalid row");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) throw new Error("Choose a valid date.");
  const tm = x => { const m = String(x || "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/); return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null; };
  const ts = tm(start), te = tm(end);
  if (!ts || !te) throw new Error("Enter a valid start and end time.");
  if (te[0] * 3600 + te[1] * 60 + te[2] <= ts[0] * 3600 + ts[1] * 60 + ts[2]) throw new Error("End time must be after the start time.");

  const ss = SpreadsheetApp.openById(c.fileId);
  const it = dppInfoTab_(ss), t = it.tab, h = it.h;
  const cols = { date: h.indexOf("live_date"), start: h.indexOf("live_start_time"), end: h.indexOf("live_end_time") };
  if (cols.date < 0 || cols.start < 0 || cols.end < 0) throw new Error("live_date / live_start_time / live_end_time column not found in " + t.getName());
  if (row > t.getLastRow()) throw new Error("Row " + row + " does not exist.");
  const id = b_(t.getRange(row, h.indexOf("id") + 1).getDisplayValue());
  const tz = ss.getSpreadsheetTimeZone();
  const p2 = n => ("0" + n).slice(-2);
  const dParts = date.split("-").map(Number);
  const before = [], after = [];

  // does this column hold real date/time values or text? (decided from the column, so empty cells match the others)
  const colVals = c2 => t.getRange(2, c2 + 1, Math.max(1, t.getLastRow() - 1), 1);
  const colType = ci => {
    const v = colVals(ci).getValues(), d = colVals(ci).getDisplayValues();
    for (let i = 0; i < v.length; i++) if (b_(d[i][0])) return { isDate: v[i][0] instanceof Date, sample: b_(d[i][0]) };
    return { isDate: true, sample: "" };
  };
  const write = (ci, kind) => {
    const cell = t.getRange(row, ci + 1);
    if (cell.getFormula()) throw new Error(h[ci] + " (row " + row + ") contains a formula – change it in the sheet.");
    const ct = colType(ci);
    const old = ct.isDate ? new Date(0) : "", oldText = cell.getDisplayValue() || ct.sample;
    let val;
    if (kind === "date") {
      if (old instanceof Date) val = Utilities.parseDate(date + " 00:00:00", tz, "yyyy-MM-dd HH:mm:ss");
      else {                                                         // text: keep the dd/MM/yyyy (or yyyy-MM-dd) style
        val = /^\d{4}-/.test(oldText) ? date : p2(dParts[2]) + "/" + p2(dParts[1]) + "/" + dParts[0];
      }
    } else {
      const v = kind === "start" ? ts : te;
      if (old instanceof Date) val = Utilities.parseDate("1899-12-30 " + p2(v[0]) + ":" + p2(v[1]) + ":" + p2(v[2]), tz, "yyyy-MM-dd HH:mm:ss");
      else val = /^\d{1,2}:\d{2}$/.test(oldText) ? p2(v[0]) + ":" + p2(v[1]) : p2(v[0]) + ":" + p2(v[1]) + ":" + p2(v[2]);
    }
    if (!(old instanceof Date) && typeof val === "string") cell.setNumberFormat("@");      // keep text as text
    const shown = cell.getDisplayValue();
    cell.setValue(val);
    before.push(h[ci] + " " + (shown || "(empty)"));
  };
  write(cols.date, "date"); write(cols.start, "start"); write(cols.end, "end");
  SpreadsheetApp.flush();
  [cols.date, cols.start, cols.end].forEach(ci => after.push(h[ci] + " " + t.getRange(row, ci + 1).getDisplayValue()));
  logAction_("DPP_SCHEDULE", c.key + " " + id, "OK", before.join(", ") + "  →  " + after.join(", "));
  return webDppList(key);
}

/** Build a small file with only the Update = Yes DPPs (Info tab + their question tabs) and upload it. */
function webDppUpload(key) {
  assertOwner_("dpp");
  assertNotFrozen_();
  const c = dppCfg_(key), L = { param: DPP_LANG[c.lang].param, batchId: envBatch_(c.lang) };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("Another update is running, please try again shortly.");
  let tmpId = "";
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

    // 1) temporary file with the Info tab (Yes rows only) + the question tabs of those DPPs
    const tmp = SpreadsheetApp.create("DPP upload " + c.key + " " + Utilities.formatDate(new Date(), TODAY_TZ, "yyyy-MM-dd HHmm"));
    tmpId = tmp.getId();
    const copyTab = (sheet, name) => {
      const t = sheet.copyTo(tmp).setName(name);
      // drop dropdown / validation rules in the copy – writing plain values must never be rejected by them
      try { t.getRange(1, 1, t.getMaxRows(), t.getMaxColumns()).clearDataValidations(); } catch (e) {}
      const lr = sheet.getLastRow(), lc = sheet.getLastColumn();
      if (lr > 0 && lc > 0) t.getRange(1, 1, lr, lc).setValues(sheet.getRange(1, 1, lr, lc).getValues());   // values only (no broken formulas)
      return t;
    };
    const tInfo = copyTab(info, info.getName());
    // delete the rows that are not selected (bottom-up, in blocks)
    const drop = [];
    for (let i = all.length - 1; i >= 1; i--) if (keep.indexOf(i) < 0) drop.push(i + 1);
    let k = 0;
    while (k < drop.length) {
      let start = drop[k], cnt = 1;
      while (k + cnt < drop.length && drop[k + cnt] === start - cnt) cnt++;
      tInfo.deleteRows(start - cnt + 1, cnt);
      k += cnt;
    }
    picked.forEach(p => copyTab(src.getSheetByName(p.name), p.name));
    tmp.getSheets().filter(s => s.getSheetId() !== tInfo.getSheetId() && picked.every(p => p.name !== s.getName())).forEach(s => tmp.deleteSheet(s));
    tmp.setActiveSheet(tInfo); tmp.moveActiveSheet(1);
    SpreadsheetApp.flush();

    // 2) export as .xlsx
    const exp = UrlFetchApp.fetch("https://docs.google.com/spreadsheets/d/" + tmpId + "/export?format=xlsx", {
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
    });
    if (exp.getResponseCode() !== 200) throw new Error("Could not export the DPP file as .xlsx (HTTP " + exp.getResponseCode() + ")");
    const blob = exp.getBlob().setName(src.getName() + ".xlsx")
      .setContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const sizeKb = Math.round(blob.getBytes().length / 1024);

    // 3) upload
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
    if (tmpId) { try { DriveApp.getFileById(tmpId).setTrashed(true); } catch (e) {} }
    lock.releaseLock();
  }
}

// ---------- Web: clear the Internal Metrics cache (same as "Clear Cache" in the Internal Metrics menu) ----------
const CACHE_CLEAR_COOLDOWN_SEC = 30;                  // no repeated clicks within 30 seconds (for everyone)

function webClearCache() {
  assertOwner_("clear_cache");
  const cache = CacheService.getScriptCache();
  const ccKey = "im_cache_clear" + (isStage_() ? "_stage" : "");
  const last = cache.get(ccKey);
  if (last) throw new Error("The cache was cleared less than " + CACHE_CLEAR_COOLDOWN_SEC + " seconds ago (by " + last + "). Please wait a moment.");
  const res = UrlFetchApp.fetch(CACHE_CLEAR_URL, { method: "get", headers: { avtoken: token_(), origin: ORIGIN }, muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code === 401) throw new Error(TOKEN_EXPIRED_MSG);
  const body = res.getContentText().substring(0, 300);
  const ok = code >= 200 && code < 300;
  if (ok) cache.put(ccKey, admMe_() || "someone", CACHE_CLEAR_COOLDOWN_SEC);
  logAction_("CACHE_CLEAR", "Internal Metrics (redis)", ok ? "OK" : "FAIL", "HTTP " + code + (body ? " · " + body : ""));
  return { ok: ok, code: code, body: body };
}

// ---------- Web: Video Image (chapter thumbnail) maker ----------
const THUMB_COL_RE = /^video[\s_-]*image$/i;                 // live sheet column with the thumbnail link

function thumbSheet_(code) {
  const chapterCode = String(code || "").trim().toUpperCase().replace(/ML\d+$/i, "");
  const m = chapterCode.match(/^2027NEET(PHY|CHE|BIO)(HIN|ENG)/);
  if (!m) throw new Error("Enter a valid lecture code (e.g. 2027NEETPHYENGLIVE31).");
  const f = BACKUP_FILES[m[1] + m[2]];
  const file = SpreadsheetApp.openByUrl(f.url);
  const tab = file.getSheets().filter(t => /^chapters?\s*_?\s*(hindi)?$/i.test(t.getName().trim()))[0];
  if (!tab) throw new Error("Chapters tab not found (" + f.name + ")");
  const v = tab.getDataRange().getDisplayValues();
  const h = v[0].map(x => b_(x));
  const lc = h.map(x => x.toLowerCase());
  const col = { code: lc.indexOf("chapter_code"), title: lc.indexOf("title"), teacher: lc.indexOf("teacher_name"), img: h.findIndex(x => THUMB_COL_RE.test(x)) };
  if (col.code < 0) throw new Error("chapter_code column not found (" + f.name + ")");
  if (col.img < 0) throw new Error('"video image" column not found in ' + f.name + " / " + tab.getName());
  return { chapterCode: chapterCode, file: f, tab: tab, v: v, col: col };
}

/** Details for the thumbnail maker: title, teacher, current image + one recent image per teacher (used as the base). */
function webThumbInfo(code) {
  assertOwner_("thumbnail");
  const S = thumbSheet_(code), v = S.v, c = S.col;
  let row = -1;
  for (let i = 1; i < v.length; i++) if (b_(v[i][c.code]).toUpperCase() === S.chapterCode) { row = i; break; }
  if (row < 0) throw new Error(S.chapterCode + " not found in " + S.file.name);
  const bases = {};
  for (let i = 1; i < v.length; i++) {
    const t = c.teacher >= 0 ? b_(v[i][c.teacher]) : "", u = b_(v[i][c.img]);
    if (t && /^https?:\/\//i.test(u)) bases[t] = { teacher: t, url: u, from: b_(v[i][c.code]) };     // later rows win = most recent
  }
  const teacher = c.teacher >= 0 ? b_(v[row][c.teacher]) : "";
  return {
    code: S.chapterCode, subject: S.file.name, row: row + 1,
    title: c.title >= 0 ? b_(v[row][c.title]) : "", teacher: teacher,
    current: b_(v[row][c.img]), column: v[0][c.img],
    bases: Object.keys(bases).map(k => bases[k]),
    defaultBase: (bases[teacher] || {}).url || ""
  };
}

/** Load an image (thumbnail base) as a data URL – the browser cannot read CloudFront images directly. */
function webThumbFetch(url) {
  assertOwner_("thumbnail");
  url = String(url || "").trim();
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw new Error("Not a valid https image link.");
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error("Could not load the image (HTTP " + res.getResponseCode() + ").");
  const blob = res.getBlob();
  const type = String(blob.getContentType() || "");
  if (!/^image\//i.test(type)) throw new Error("This link is not an image (" + (type || "unknown type") + ").");
  if (blob.getBytes().length > 8 * 1024 * 1024) throw new Error("Image is larger than 8 MB.");
  return "data:" + type + ";base64," + Utilities.base64Encode(blob.getBytes());
}

/** Write the uploaded thumbnail link into the "video image" column of the lecture's row. */
function webThumbSaveLink(code, url) {
  assertOwner_("thumbnail");
  assertNotFrozen_();
  url = String(url || "").trim();
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error("Paste the full image link (https://…).");
  const S = thumbSheet_(code), v = S.v, c = S.col;
  let row = -1;
  for (let i = 1; i < v.length; i++) if (b_(v[i][c.code]).toUpperCase() === S.chapterCode) { row = i; break; }
  if (row < 0) throw new Error(S.chapterCode + " not found in " + S.file.name);
  const cell = S.tab.getRange(row + 1, c.img + 1);
  if (cell.getFormula()) throw new Error("The video image cell (row " + (row + 1) + ") contains a formula – it was not changed.");
  const old = cell.getDisplayValue();
  cell.setValue(url);
  logAction_("VIDEO_IMAGE_SET", S.chapterCode, "OK", (old || "(empty)") + " → " + url + " · " + S.file.name + " row " + (row + 1));
  return webThumbInfo(code);
}

/** Path Upload History (Internal Metrics) + result of the latest upload */
function webUploadHistory(lang) {
  assertOwner_("upload");
  const c = upCfg_(lang);
  const data = getJson(API + "personalised-paths/node-path-history?pageNo=0&pageSize=20");
  const groups = (data.content || []).map(g => ({
    uploadTime: g.uploadTime,
    at: (function () { try { return Utilities.parseDate(String(g.uploadTime), "Asia/Kolkata", "yyyy-MM-dd HH:mm:ss").getTime(); } catch (e) { return 0; } })(),
    items: (g.pathUploadDetails || []).filter(d => Number(d.batchId) === c.batchId).map(d => ({
      pathId: d.pathId, subject: d.subjectName, language: d.language, version: d.version,
      status: d.uploadStatus, details: d.details || [], by: (d.createdBy && d.createdBy.name) || "",
      updatedAt: d.updatedAt
    }))
  })).filter(g => g.items.length);

  const last = upLast_(c.lang);
  let current = null;
  if (last) {
    current = groups.filter(g => g.at >= last.at - 2 * 60 * 1000).sort((a, b) => a.at - b.at)[0] || null;
    const finished = x => /^(SUCCESS|FAILED)$/i.test(String(x.status));
    const doneCount = current ? current.items.filter(finished).length : 0;
    const allDone = !!current && doneCount >= Math.max(1, (last.subjects || []).length) && current.items.every(finished);
    if (allDone && !last.done) {
      last.done = true;
      PropertiesService.getUserProperties().setProperty(upLastKey_(c.lang), JSON.stringify(last));
      const fail = current.items.filter(x => /FAILED/i.test(x.status));
      logAction_("IM_UPLOAD_RESULT", "batch " + c.batchId, fail.length ? "FAIL" : "OK",
        current.items.map(x => x.subject + ": " + x.status + (x.details.length ? "\n  " + x.details.join("\n  ") : "")).join("\n"));
    }
    last.allDone = allDone;
  }
  return { lang: c.lang, batchId: c.batchId, last: last, current: current, groups: groups.slice(0, 10) };
}

/** Extra tools: sheet backup / node sheet update / colour RECORDED rows (also available in the sheet menu). */
function webTool(lang, kind) {
  assertNotFrozen_();
  assertOwner_({ backup: "push_dash", nodesheet: "push_nodes", recolor: "nodepath" }[kind] || "lecture");
  const p = lecCfg_(lang).p;
  const fn = { backup: () => backupOnly_(p), nodesheet: () => nodeSheetOnly_(p), recolor: () => recolorRecordedAll() }[kind];
  if (!fn) throw new Error("Invalid tool: " + kind);
  if (kind !== "recolor") checkCodeLang_(autoSheet_().getRange(p.code + p.row).getDisplayValue(), lang);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("Another update is running, please try again shortly.");
  IO_ = { apply: true, confirmText: null, msgs: [], pdf: "" };
  try { fn(); return { messages: IO_.msgs }; }
  finally { IO_ = null; lock.releaseLock(); }
}

/** Standalone setup check: run this in the Apps Script editor and read the Execution log. */
function setupCheck() {
  const out = [];
  try { const ss = book_(); out.push("✅ Batch OPS opened: " + ss.getName()); } catch (e) { out.push("⚠️ " + e.message); }
  const sp = PropertiesService.getScriptProperties().getProperties();
  ["AVTOKEN", "ADM_USERS", "ADM_PASS_HASH", "ADM_PASS_SALT"].forEach(k => out.push((sp[k] ? "✅ " : "⚠️ missing ") + "Script Property " + k));
  let bound = false; try { bound = !!SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
  out.push(bound ? "⚠️ Script is inside the Batch OPS sheet – editors can see the code and Script Properties (move to standalone)" : "✅ Standalone script (code hidden from sheet editors)");
  Object.keys(BACKUP_FILES).forEach(k => {
    try { SpreadsheetApp.openByUrl(BACKUP_FILES[k].url); out.push("✅ " + BACKUP_FILES[k].name); } catch (e) { out.push("⚠️ " + BACKUP_FILES[k].name + ": " + e.message); }
  });
  Object.keys(NODE_FILES).forEach(k => {
    try { SpreadsheetApp.openByUrl(NODE_FILES[k]); out.push("✅ NodePath " + k); } catch (e) { out.push("⚠️ NodePath " + k + ": " + e.message); }
  });
  try { const c = tokenTest_((sp.AVTOKEN || "").trim()); out.push((c === 200 ? "✅" : "⚠️") + " Shared token test: HTTP " + c); } catch (e) { out.push("❌ token test: " + e.message); }
  Logger.log(out.join("\n"));
  return out.join("\n");
}

const PUSH_FEATURE = { dashboard: "push_dash", nodes: "push_nodes", dpp: "push_dpp" };
function webPush(lang, kind, apply, pdfKey, form, snap) {
  assertOwner_(PUSH_FEATURE[kind] || "lecture");
  const saved = form ? webLectureSave(lang, form) : null;     // save the form before the preview (same call)
  const p = lecCfg_(lang).p;
  const fn = { dashboard: pushToDashboard, nodes: pushNodes, dpp: pushDpp }[kind];
  if (!fn) throw new Error("Invalid action: " + kind);
  checkCodeLang_(autoSheet_().getRange(p.code + p.row).getDisplayValue(), lang);
  let lock = null;
  if (apply) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error("Another push is running, please try again shortly.");
  }
  IO_ = { apply: !!apply, confirmText: null, msgs: [], pdf: pdfUrlFromKey_(pdfKey) };
  try {
    const now = rowSnap_(p);
    if (apply && snap && snap !== now) {
      throw new Error("The sheet data changed after the preview (" + autoSheet_().getName() + "). Nothing was pushed – please click the button again to see a fresh preview.");
    }
    fn(p);
    return { kind: kind, preview: IO_.confirmText, messages: IO_.msgs, applied: !!apply && IO_.confirmText !== null, saved: saved, snap: now, tab: autoSheet_().getName() };
  } finally {
    IO_ = null;
    if (lock) lock.releaseLock();
  }
}

// ====================== ADD CLASS (live sheet + Microlecture tab + NodePath) ======================
// The new lecture goes right below the last lecture of its chapter (NodePath follows the Chapters row order).
// The new row gets plain values only (no formulas); format + dropdowns come from the nearest row that is not RECORDED.
const ADD_CLASS_FILL = { code: "chapter_code", title: "title", teacher: "teacher_name", date: "live_date",
                         start: "live_start_time", end: "live_end_time", type: "chapter_type", status: "chapter_status" };
const ADD_CLASS_COPY = ["chapter_name", "chapter_number", "active"];     // same chapter -> same value as its last lecture
const ADD_CLASS_NEW = "__new__";                                         // chapter id for "new chapter (at the end)"

function acTab_(key) {
  const f = BACKUP_FILES[key];
  if (!f) throw new Error("Unknown subject: " + key);
  const file = SpreadsheetApp.openByUrl(f.url);
  const tab = file.getSheets().filter(t => /^chapters?\s*_?\s*(hindi)?$/i.test(t.getName().trim()))[0];
  if (!tab) throw new Error(f.name + ": Chapters tab not found");
  const rng = tab.getDataRange();
  const v = rng.getValues(), d = rng.getDisplayValues(), fx = rng.getFormulas();
  const h = d[0].map(x => b_(x).toLowerCase());
  const ci = n => [].concat(n).map(x => h.indexOf(x)).filter(i => i >= 0)[0];
  if (ci("chapter_code") === undefined) throw new Error(f.name + " / " + tab.getName() + ": chapter_code column not found");
  return { key: key, f: f, file: file, tab: tab, v: v, d: d, fx: fx, h: h, ci: ci, lastCol: h.length, lastRow: d.length };
}

function acRoman_(n) {
  const t = [[100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  t.forEach(p => { while (n >= p[0]) { s += p[1]; n -= p[0]; } });
  return s;
}

/** Chapters in row order – same grouping as NodePath (title without " - II", else chapter_name / chapter_number). */
function acChapters_(T) {
  const cCode = T.ci("chapter_code"), cTitle = T.ci("title"), cName = T.ci("chapter_name"), cNo = T.ci("chapter_number");
  const get = (i, c) => c === undefined ? "" : b_(T.d[i][c]);
  const list = [], byId = {};
  for (let i = 1; i < T.d.length; i++) {
    const code = get(i, cCode);
    if (!code) continue;
    const title = get(i, cTitle), name = get(i, cName), no = get(i, cNo);
    const base = stripRoman_(title || name) || stripRoman_(name);
    const id = base ? chapKey_(base) : "C|" + no;
    let c = byId[id];
    if (!c) { c = byId[id] = { id: id, name: base || ("Chapter " + no), lectures: 0 }; list.push(c); }
    c.lectures++; c.lastRow = i + 1; c.lastCode = code; c.lastTitle = title;
  }
  list.forEach(c => {
    const m = c.lastTitle.match(/^(.*?)\s*-\s*([IVXLC]+)\s*$/i);
    c.nextTitle = m ? m[1] + " - " + acRoman_(roman_(m[2]) + 1) : (c.lastTitle ? c.lastTitle + " - II" : "");
  });
  return list;
}

function acNextCode_(T) {
  const re = new RegExp("^2027NEET" + T.key + "LIVE(\\d+)$", "i"), cCode = T.ci("chapter_code");
  let max = 0;
  for (let i = 1; i < T.d.length; i++) { const m = b_(T.d[i][cCode]).match(re); if (m) max = Math.max(max, Number(m[1])); }
  return "2027NEET" + T.key + "LIVE" + (max + 1);
}

function acNodeSubject_(key) {
  const s = CFG.SUBJECTS.filter(x => x.orderFile === key)[0];
  if (!s) throw new Error("NodePath subject not found for " + key);
  return s;
}

/** Dropdowns for the Add class form */
function webAddClassInfo(key) {
  assertOwner_("add_class");
  const T = acTab_(key);
  const distinct = c => {
    if (c === undefined) return [];
    const seen = {}, out = [];
    for (let i = T.d.length - 1; i >= 1; i--) { const x = b_(T.d[i][c]); if (x && !seen[x]) { seen[x] = 1; out.push(x); } }
    return out;
  };
  const cStat = T.ci("chapter_status"), cType = T.ci("chapter_type");
  let tplRow = -1;                                           // latest lecture that is not RECORDED -> default type / status
  for (let i = T.d.length - 1; i >= 1 && tplRow < 0; i--) if (cStat !== undefined && b_(T.d[i][cStat]) && b_(T.d[i][cStat]).toUpperCase() !== "RECORDED") tplRow = i;
  return {
    key: key, fileName: T.f.name, tabName: T.tab.getName(), lastRow: T.lastRow,
    chapters: acChapters_(T), nextCode: acNextCode_(T),
    teachers: distinct(T.ci("teacher_name")).slice(0, 60),
    types: distinct(cType), statuses: distinct(cStat),
    defType: tplRow > 0 && cType !== undefined ? b_(T.d[tplRow][cType]) : "LIVE",
    defStatus: tplRow > 0 ? b_(T.d[tplRow][cStat]) : "LIVE",
    nodeSubject: acNodeSubject_(key).label
  };
}

/** Checks the form against the sheet and works out every change. Nothing is written here. */
function acPlan_(T, d) {
  d = d || {};
  const code = b_(d.code).toUpperCase();
  if (!new RegExp("^2027NEET" + T.key + "LIVE\\d+$").test(code)) {
    if (/ML\d+$/.test(code)) throw new Error("Enter the chapter code without ML1 (the sheet adds it).");
    throw new Error("Chapter code must look like 2027NEET" + T.key + "LIVE123 (current: \"" + code + "\").");
  }
  const cCode = T.ci("chapter_code");
  for (let i = 1; i < T.d.length; i++) if (b_(T.d[i][cCode]).toUpperCase() === code) throw new Error(code + " already exists in " + T.f.name + " (row " + (i + 1) + ").");
  const title = b_(d.title);
  if (!title) throw new Error("Enter the title.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.date || ""))) throw new Error("Choose a valid date.");
  const tm = x => { const m = String(x || "").match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/); return m ? [Number(m[1]), Number(m[2]), Number(m[3] || 0)] : null; };
  const ts = tm(d.start), te = tm(d.end);
  if (!ts || !te) throw new Error("Enter a valid start and end time.");
  if (te[0] * 3600 + te[1] * 60 + te[2] <= ts[0] * 3600 + ts[1] * 60 + ts[2]) throw new Error("End time must be after the start time.");

  const chapters = acChapters_(T);
  let ch = null, afterRow;
  if (d.chapter === ADD_CLASS_NEW) {
    if (!b_(d.chapterName)) throw new Error("Enter the name of the new chapter.");
    afterRow = T.lastRow;
  } else {
    ch = chapters.filter(c => c.id === d.chapter)[0];
    if (!ch) throw new Error("Chapter not found in the sheet – reopen Add class.");
    if (d.afterCode && d.afterCode !== ch.lastCode) throw new Error("The sheet changed (the last lecture of " + ch.name + " is now " + ch.lastCode + "). Reopen Add class.");
    afterRow = ch.lastRow;
  }
  const newRow = afterRow + 1;

  // number sequences: position (shifted for every row below), chapter_number (new chapter = next number)
  const num = (i, c) => { const x = T.v[i - 1][c]; return typeof x === "number" ? x : (b_(x) !== "" && !isNaN(Number(x)) ? Number(x) : null); };
  const cPos = T.ci(["position", "pos"]);
  const pos = { col: cPos, value: "", shift: 0, step: 0, note: "" };
  if (cPos !== undefined) {
    const diffs = {};
    for (let i = 3; i <= T.lastRow; i++) { const a = num(i - 1, cPos), b = num(i, cPos); if (a !== null && b !== null && b > a) diffs[b - a] = (diffs[b - a] || 0) + 1; }
    pos.step = Number(Object.keys(diffs).sort((a, b) => diffs[b] - diffs[a])[0]) || 1;
    const prev = num(afterRow, cPos);
    if (prev === null) pos.note = "position left empty (the row above has no number)";
    else {
      pos.value = prev + pos.step;
      for (let i = newRow; i <= T.lastRow; i++) if (num(i, cPos) !== null) pos.shift++;
    }
  }
  const cNo = T.ci("chapter_number");
  let chapterNo = "";
  if (!ch && cNo !== undefined) {
    let max = 0;
    for (let i = 2; i <= T.lastRow; i++) { const n = num(i, cNo); if (n !== null) max = Math.max(max, n); }
    chapterNo = max + 1;
  }

  // format source: nearest row that is not RECORDED (a RECORDED row is coloured green)
  const cStat = T.ci("chapter_status");
  const notRec = i => cStat === undefined || b_(T.d[i - 1][cStat]).toUpperCase() !== "RECORDED";
  let fmtRow = afterRow;
  for (let k = 0; k < T.lastRow; k++) {
    if (afterRow - k >= 2 && notRec(afterRow - k)) { fmtRow = afterRow - k; break; }
    if (afterRow + k + 1 <= T.lastRow && notRec(afterRow + k + 1)) { fmtRow = afterRow + k + 1; break; }
  }

  const microTab = code + BACKUP_TAB_SUFFIX;
  const microTpl = (ch && T.file.getSheetByName(ch.lastCode + BACKUP_TAB_SUFFIX)) ||
    T.file.getSheets().filter(s => !isBackupTab_(s.getName()) && s.getName().slice(-BACKUP_TAB_SUFFIX.length) === BACKUP_TAB_SUFFIX).slice(-1)[0] || null;
  const filled = Object.keys(ADD_CLASS_FILL).map(k => ADD_CLASS_FILL[k]).filter(n => T.ci(n) !== undefined)
    .concat(ADD_CLASS_COPY.filter(n => T.ci(n) !== undefined), cPos !== undefined && pos.value !== "" ? [T.h[cPos]] : []);
  return {
    code: code, title: title, teacher: b_(d.teacher), date: d.date, ts: ts, te: te,
    type: b_(d.type) || "LIVE", status: b_(d.status) || "LIVE",
    chapter: ch, chapterName: ch ? ch.name : b_(d.chapterName), chapterNo: chapterNo,
    afterRow: afterRow, newRow: newRow, fmtRow: fmtRow, pos: pos,
    filled: filled, empty: T.h.filter(n => n && filled.indexOf(n) < 0),
    microTab: microTab, microExists: !!T.file.getSheetByName(microTab), microTpl: microTpl ? microTpl.getName() : "",
    node: acNodeSubject_(T.key)
  };
}

function acSummary_(T, p) {
  return [
    T.f.name + " → " + T.tab.getName() + ": new row " + p.newRow + (p.chapter ? " (below " + (p.chapter.lastTitle || p.chapter.lastCode) + ", row " + p.afterRow + ")" : " (new chapter \"" + p.chapterName + "\", at the end)"),
    p.code + " · " + p.title + (p.teacher ? " · " + p.teacher : "") + " · " + p.date + " " + p.ts.slice(0, 2).map(n => ("0" + n).slice(-2)).join(":") + "–" + p.te.slice(0, 2).map(n => ("0" + n).slice(-2)).join(":") + " · " + p.type + " / " + p.status,
    "Filled: " + p.filled.join(", "),
    p.empty.length ? "Left empty: " + p.empty.join(", ") : "",
    p.pos.col !== undefined ? (p.pos.note ? "⚠️ " + p.pos.note : "position = " + p.pos.value + (p.pos.shift ? ", " + p.pos.shift + " rows below +" + p.pos.step : "")) : "",
    p.microExists ? "Microlecture tab " + p.microTab + " already exists (not changed)" : "New tab " + p.microTab + (p.microTpl ? " (layout of " + p.microTpl + ")" : ""),
    "NodePath " + p.node.label + ": new lecture added + node_id / position renumbered"
  ].filter(Boolean);
}

/** Preview for the first confirmation (also shows other pending NodePath changes of that subject, they are applied too). */
function webAddClassPlan(key, d) {
  assertOwner_("add_class");
  if (isStage_()) throw new Error("STAGE mode is on – Add class changes the production sheets. Switch to Production first.");
  const T = acTab_(key), p = acPlan_(T, d);
  const lines = acSummary_(T, p);
  let np = null;
  try { const r = runSubject(p.node.key, { apply: false }); np = { lines: r.lines, warnings: r.warnings }; }
  catch (e) { np = { error: String(e.message || e) }; }
  return { lines: lines, nodepath: np, newRow: p.newRow };
}

/** live_date / time value in the style the column already uses (real date/time or text) */
function acCellValue_(T, c, kind, p) {
  let isDate = true, sample = "";
  for (let i = 1; i < T.d.length; i++) if (b_(T.d[i][c])) { isDate = T.v[i][c] instanceof Date; sample = b_(T.d[i][c]); break; }
  const tz = T.file.getSpreadsheetTimeZone(), p2 = n => ("0" + n).slice(-2);
  if (kind === "date") {
    const dp = p.date.split("-").map(Number);
    if (isDate) return { v: Utilities.parseDate(p.date + " 00:00:00", tz, "yyyy-MM-dd HH:mm:ss"), text: false };
    return { v: /^\d{4}-/.test(sample) ? p.date : p2(dp[2]) + "/" + p2(dp[1]) + "/" + dp[0], text: true };
  }
  const t = kind === "start" ? p.ts : p.te;
  if (isDate) return { v: Utilities.parseDate("1899-12-30 " + p2(t[0]) + ":" + p2(t[1]) + ":" + p2(t[2]), tz, "yyyy-MM-dd HH:mm:ss"), text: false };
  return { v: /^\d{1,2}:\d{2}$/.test(sample) ? p2(t[0]) + ":" + p2(t[1]) : p2(t[0]) + ":" + p2(t[1]) + ":" + p2(t[2]), text: true };
}

function webAddClass(key, d) {
  assertOwner_("add_class");
  assertNotFrozen_();
  if (isStage_()) throw new Error("STAGE mode is on – Add class changes the production sheets. Switch to Production first.");
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("Another update is running, please try again shortly.");
  const steps = [];
  let ok = true, p = null, T = null, inserted = false, microCreated = false;
  try {
    T = acTab_(key);
    p = acPlan_(T, d);
    const sh = T.tab, n = T.lastCol;

    // 1) Chapters: new row below the chapter's last lecture (plain values, no formulas)
    sh.insertRowsAfter(p.afterRow, 1);
    inserted = true;
    const fmtRow = p.fmtRow > p.afterRow ? p.fmtRow + 1 : p.fmtRow;           // rows below moved down by one
    const src = sh.getRange(fmtRow, 1, 1, n), dst = sh.getRange(p.newRow, 1, 1, n);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    const row = new Array(n).fill("");
    const put = (name, val) => { const c = T.ci(name); if (c !== undefined) row[c] = val; };
    put("chapter_code", p.code); put("title", p.title); put("teacher_name", p.teacher);
    put("chapter_type", p.type); put("chapter_status", p.status);
    ["date", "start", "end"].forEach(k => {
      const c = T.ci(ADD_CLASS_FILL[k]);
      if (c === undefined) return;
      const cv = acCellValue_(T, c, k, p);
      if (cv.text) sh.getRange(p.newRow, c + 1).setNumberFormat("@");          // keep text as text
      row[c] = cv.v;
    });
    ADD_CLASS_COPY.forEach(name => { const c = T.ci(name); if (c !== undefined && p.chapter) row[c] = T.v[p.afterRow - 1][c]; });
    if (!p.chapter) { put("chapter_name", p.chapterName); put("chapter_number", p.chapterNo); const ca = T.ci("active"); if (ca !== undefined) row[ca] = T.v[p.afterRow - 1][ca]; }
    if (p.pos.col !== undefined) row[p.pos.col] = p.pos.value;
    sh.getRange(p.newRow, 1, 1, n).setValues([row]);
    steps.push("✓ " + T.f.name + " / " + sh.getName() + ": row " + p.newRow + " added" + (p.chapter ? " (below row " + p.afterRow + ")" : " (new chapter)"));

    // 2) position: every numbered row below goes up by one step (formula cells are left as they are)
    if (p.pos.col !== undefined && p.pos.value !== "" && p.pos.shift) {
      const c = p.pos.col, cnt = T.lastRow - p.afterRow;
      const vals = [];
      for (let i = p.afterRow + 1; i <= T.lastRow; i++) {
        const f = T.fx[i - 1][c], x = T.v[i - 1][c];
        vals.push([f ? f : (typeof x === "number" || (b_(x) !== "" && !isNaN(Number(x))) ? Number(x) + p.pos.step : x)]);
      }
      sh.getRange(p.newRow + 1, c + 1, cnt, 1).setValues(vals);
      steps.push("✓ position: " + p.pos.shift + " rows below +" + p.pos.step);
    } else if (p.pos.note) steps.push("⚠️ " + p.pos.note);
    SpreadsheetApp.flush();

    // 3) Microlecture tab (filled later by the push / sheet backup)
    try {
      if (p.microExists) steps.push("• Microlecture tab " + p.microTab + " already exists (not changed)");
      else {
        const tpl = p.microTpl ? T.file.getSheetByName(p.microTpl) : null;
        let mt;
        if (tpl) {
          mt = tpl.copyTo(T.file).setName(p.microTab);
          const lr = mt.getLastRow(), lc = Math.max(1, mt.getLastColumn());
          if (lr >= 2) mt.getRange(2, 1, lr - 1, lc).clearContent();
          const hdr = mt.getRange(1, 1, 1, lc).getValues()[0].map(b_);
          const k = hdr.indexOf(BACKUP_KEY_HEADER);
          if (k >= 0) mt.getRange(2, k + 1).setValue(p.code + CFG.ML_SUFFIX);
        } else {
          mt = T.file.insertSheet(p.microTab);
          mt.getRange(1, 1, 2, 1).setValues([[BACKUP_KEY_HEADER], [p.code + CFG.ML_SUFFIX]]);
        }
        SpreadsheetApp.flush();
        microCreated = true;
        steps.push("✓ Microlecture tab " + p.microTab + " created" + (tpl ? " (layout of " + p.microTpl + ")" : ""));
      }
    } catch (e) { ok = false; steps.push("⚠️ Microlecture tab not created: " + (e.message || e) + " – create " + p.microTab + " by hand."); }

    // 4) NodePath: same as "NodePath update" for this subject (adds the 3 rows of the new lecture, renumbers)
    try {
      const r = runSubject(p.node.key, { apply: true, renumber: true });
      steps.push("✓ NodePath " + p.node.label + " (" + r.sheet + "): " + (r.lines.length ? r.lines.map(x => x.replace(/^•\s*/, "")).join(" · ") : "no change"));
      (r.warnings || []).forEach(w => steps.push(w));
    } catch (e) { ok = false; steps.push("⚠️ NodePath not updated: " + (e.message || e) + " – run NodePath update for " + p.node.label + "."); }

    cacheDel_(["td_" + key + "_" + p.date, "np_" + p.node.key]);
    acRecordAdd_({ code: p.code, key: key, title: p.title, date: p.date, row: p.newRow, at: admNow_(),
                   by: (Session.getActiveUser().getEmail() || "").toLowerCase(), micro: microCreated,
                   posStep: p.pos.value !== "" && p.pos.shift ? p.pos.step : 0 });
    logAction_("ADD_CLASS", p.code, ok ? "OK" : "PARTIAL", acSummary_(T, p).concat(steps).join("\n"));
    return { ok: ok, code: p.code, row: p.newRow, date: p.date, steps: steps };
  } catch (e) {
    if (inserted) {                                        // the Chapters sheet was changed – record what happened
      if (!steps.length) steps.push("⚠️ an empty row may have been inserted at row " + p.newRow + " of " + T.f.name + " – check the sheet");
      logAction_("ADD_CLASS", p.code, "FAIL", steps.concat("⚠️ " + (e.message || e)).join("\n"));
      throw new Error((e.message || e) + "\n\nDone before the error:\n" + steps.join("\n"));
    }
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// ---------- Undo add class (only classes added from the dashboard, before anything was pushed) ----------
const ADD_CLASS_LOG_KEY = "ADD_CLASS_LOG";              // Script Properties: last 20 classes added from the dashboard
const ADD_CLASS_NODE_TYPES = ["LIVE_LECTURE", "VIDEO_LECTURE", "LIVE_CLASS_NOTES", "DAILY_PRACTICE_PROBLEMS"];

function acRecords_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(ADD_CLASS_LOG_KEY) || "[]"); } catch (e) { return []; }
}
function acSaveRecords_(list) { PropertiesService.getScriptProperties().setProperty(ADD_CLASS_LOG_KEY, JSON.stringify(list.slice(0, 20))); }
function acRecordAdd_(rec) { acSaveRecords_([rec].concat(acRecords_().filter(r => r.code !== rec.code))); }

/** Classes added from the dashboard (newest first) */
function webAddClassRecent() {
  assertOwner_("add_class");
  return acRecords_();
}

/** What undo would do, and whether it is allowed. Nothing is written here. */
function acUndoPlan_(code) {
  const rec = acRecords_().filter(r => r.code === code)[0];
  if (!rec) throw new Error(code + " was not added from the dashboard (or is too old) – undo is not available.");
  if (rec.undone) throw new Error(code + " was already undone (" + rec.undone + ").");
  const T = acTab_(rec.key);
  const cCode = T.ci("chapter_code"), cStat = T.ci("chapter_status");
  let row = -1;
  for (let i = 1; i < T.d.length; i++) if (b_(T.d[i][cCode]).toUpperCase() === code) { row = i + 1; break; }
  const blocks = [];
  if (row > 0 && cStat !== undefined && b_(T.d[row - 1][cStat]).toUpperCase() === "RECORDED") blocks.push("the class is RECORDED in the live sheet");
  const pushed = (todayLogMap_()[code] || {});
  const done = ["dash", "nodes", "dpp"].filter(k => pushed[k] && pushed[k].ok);
  if (done.length) blocks.push("it was already pushed to Internal Metrics (" + done.join(", ") + ") – undo would not remove it there");
  const mt = T.file.getSheetByName(code + BACKUP_TAB_SUFFIX);
  let microData = false;
  if (mt && mt.getLastRow() >= 2) {
    const v = mt.getRange(1, 1, mt.getLastRow(), Math.max(1, mt.getLastColumn())).getDisplayValues();
    const k = v[0].map(b_).indexOf(BACKUP_KEY_HEADER);
    microData = v.slice(1).some(r => r.some((x, j) => j !== k && b_(x) !== ""));
  }
  const node = acNodeSubject_(rec.key);
  const lines = [
    row > 0 ? T.f.name + " / " + T.tab.getName() + ": delete row " + row + " (" + code + ")" : "⚠️ " + code + " is no longer in " + T.f.name + " (already deleted?)",
    rec.posStep && row > 0 ? "position: rows below −" + rec.posStep : "",
    !rec.micro ? "Microlecture tab: not created by Add class – left as it is" :
      !mt ? "Microlecture tab " + code + BACKUP_TAB_SUFFIX + " is already gone" :
      microData ? "⚠️ Microlecture tab " + mt.getName() + " has data – it is NOT deleted" : "delete tab " + mt.getName(),
    "NodePath " + node.label + ": delete the rows of " + code + " (lecture / notes / DPP), node_id / position renumbered"
  ].filter(Boolean);
  return { rec: rec, T: T, row: row, mt: mt, microData: microData, node: node, blocks: blocks, lines: lines };
}

function webAddClassUndoPlan(code) {
  assertOwner_("add_class");
  if (isStage_()) throw new Error("STAGE mode is on – undo changes the production sheets. Switch to Production first.");
  const u = acUndoPlan_(String(code || "").toUpperCase());
  let np = null;
  try { const r = runSubject(u.node.key, { apply: false }); np = { lines: r.lines, warnings: r.warnings }; }
  catch (e) { np = { error: String(e.message || e) }; }
  return { code: u.rec.code, lines: u.lines, blocks: u.blocks, nodepath: np };
}

function webAddClassUndo(code) {
  assertOwner_("add_class");
  assertNotFrozen_();
  if (isStage_()) throw new Error("STAGE mode is on – undo changes the production sheets. Switch to Production first.");
  code = String(code || "").toUpperCase();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error("Another update is running, please try again shortly.");
  const steps = [];
  let ok = true;
  try {
    const u = acUndoPlan_(code);
    if (u.blocks.length) throw new Error("Undo is not possible: " + u.blocks.join("; ") + ".");
    const T = u.T, sh = T.tab;

    // 1) Chapters row + position numbers below
    if (u.row > 0) {
      const cPos = T.ci(["position", "pos"]);
      sh.deleteRow(u.row);
      if (u.rec.posStep && cPos !== undefined && u.row <= T.lastRow - 1) {
        const vals = [];
        for (let i = u.row + 1; i <= T.lastRow; i++) {
          const f = T.fx[i - 1][cPos], x = T.v[i - 1][cPos];
          vals.push([f ? f : (typeof x === "number" || (b_(x) !== "" && !isNaN(Number(x))) ? Number(x) - u.rec.posStep : x)]);
        }
        sh.getRange(u.row, cPos + 1, vals.length, 1).setValues(vals);
      }
      SpreadsheetApp.flush();
      steps.push("✓ " + T.f.name + " / " + sh.getName() + ": row " + u.row + " deleted" + (u.rec.posStep ? ", position below −" + u.rec.posStep : ""));
    } else steps.push("• " + code + " was not in the live sheet any more");

    // 2) Microlecture tab (only the one Add class created, and only while it has no data)
    if (u.rec.micro && u.mt && !u.microData) {
      try { T.file.deleteSheet(u.mt); steps.push("✓ tab " + code + BACKUP_TAB_SUFFIX + " deleted"); }
      catch (e) { ok = false; steps.push("⚠️ tab " + code + BACKUP_TAB_SUFFIX + " not deleted: " + (e.message || e)); }
    } else if (u.rec.micro && u.mt) steps.push("⚠️ tab " + u.mt.getName() + " has data – left as it is");

    // 3) NodePath: delete the lecture / notes / DPP rows of this code, then the normal update (tests go back to the chapter's last lecture, renumber)
    try {
      const nss = SpreadsheetApp.openByUrl(CFG.FILES[u.node.lang]);
      const subj = subjectCfg_(null, u.node.key), nsh = resolveTab_(nss, subj), c = readPath_(nsh);
      const del = [];
      c.data.forEach((r, i) => { if (S_(r[c.col.chapter_code]).toUpperCase() === code && ADD_CLASS_NODE_TYPES.indexOf(S_(r[c.col.task_type])) >= 0) del.push(c.first + i); });
      del.reverse().forEach(rn => nsh.deleteRow(rn));
      SpreadsheetApp.flush();
      const r = runSubject(u.node.key, { apply: true, renumber: true });
      steps.push("✓ NodePath " + u.node.label + " (" + r.sheet + "): " + del.length + " rows deleted" + (r.lines.length ? " · " + r.lines.map(x => x.replace(/^•\s*/, "")).join(" · ") : ""));
    } catch (e) { ok = false; steps.push("⚠️ NodePath not changed: " + (e.message || e) + " – delete the rows of " + code + " by hand and run NodePath update."); }

    acSaveRecords_(acRecords_().map(r => r.code === code ? Object.assign(r, { undone: admNow_() }) : r));
    cacheDel_(["td_" + u.rec.key + "_" + u.rec.date, "np_" + u.node.key]);
    logAction_("ADD_CLASS_UNDO", code, ok ? "OK" : "PARTIAL", steps.join("\n"));
    return { ok: ok, code: code, date: u.rec.date, steps: steps };
  } catch (e) {
    if (steps.length) {
      logAction_("ADD_CLASS_UNDO", code, "FAIL", steps.concat("⚠️ " + (e.message || e)).join("\n"));
      throw new Error((e.message || e) + "\n\nDone before the error:\n" + steps.join("\n"));
    }
    throw e;
  } finally {
    lock.releaseLock();
  }
}

// ============================== CORE ==============================

function runSubject(key, opts) {
  opts = opts || {};
  const subj = subjectCfg_(null, key);
  const url = CFG.FILES[subj.lang];
  if (!url || url.indexOf('docs.google.com') === -1) throw new Error('CFG.FILES.' + subj.lang + ' is not set.');
  const ss = SpreadsheetApp.openByUrl(url);              // NodePath file for this language
  const sh = resolveTab_(ss, subj);

  const c = readPath_(sh);
  const ord = readOrder_(ss, subj, c);
  const col = c.col;
  const rows = c.data;
  const NO = lockedNoValue_(sh, col, rows);                 // 'NO' or 'no' (whatever this sheet uses)
  const YES = NO === NO.toLowerCase() ? 'yes' : 'YES';
  const DPPCAT = DPP_CATEGORY[subj.lang];
  const touched = {};
  const log = { fixed: 0, added: 0, converted: 0, pdf: 0, unlocked: 0, dpp: 0, ml: 0, click: 0, testMoved: 0 };
  const changes = [];

  function set(row, k, val, why) {
    if (col[k] === undefined) return false;
    if (S_(row[col[k]]) === S_(val)) return false;
    if (why && changes.length < 300) changes.push(S_(row[col.chapter_code]) + ' · ' + S_(row[col.task_type]) + ' · ' + why);
    row[col[k]] = val;
    touched[k] = true;
    return true;
  }

  // ---------- 1) Update the nodes of RECORDED lectures ----------
  rows.forEach(function (r) {
    const code = S_(r[col.chapter_code]);
    let type = S_(r[col.task_type]);
    const info = ord.byCode[code];

    if (info && info.done) {
      if (type === 'LIVE_LECTURE') {
        set(r, 'task_type', 'VIDEO_LECTURE', 'LIVE → VIDEO_LECTURE'); type = 'VIDEO_LECTURE'; log.converted++;
      }
      if (type === 'VIDEO_LECTURE' && !S_(r[col.microlecture_code])) {
        if (set(r, 'microlecture_code', code + CFG.ML_SUFFIX, 'microlecture_code')) log.ml++;
      }
      if (type === 'LIVE_CLASS_NOTES') {
        if (info.notes && set(r, 'pdf_url', info.notes, 'pdf_url from Chapters sheet')) log.pdf++;
        if (set(r, 'locked', NO, 'unlock')) log.unlocked++;
      }
      if (type === 'DAILY_PRACTICE_PROBLEMS') {
        let d = set(r, 'test_series_id', code + CFG.DPP_SUFFIX, 'test_series_id = ' + code + CFG.DPP_SUFFIX);
        if (!S_(r[col.test_category_id])) d = set(r, 'test_category_id', DPPCAT, 'test_category_id') || d;
        if (d) log.dpp++;
        if (set(r, 'locked', NO, 'unlock')) log.unlocked++;
      }
    }
    const ct = CFG.CLICK_TYPE[type];
    if (ct && col.node_click_type !== undefined && set(r, 'node_click_type', ct, 'node_click_type = ' + ct)) log.click++;
  });

  // ---------- 2) Chapter FINAL test -> moved to the chapter's last lecture ----------
  const isEnd = function (r) { return CFG.CHAPTER_END_TYPES.indexOf(S_(r[col.task_type])) !== -1; };
  const subOf = {};
  rows.forEach(function (r) {
    const code = S_(r[col.chapter_code]);
    if (!isEnd(r) && col.subtitle !== undefined && subOf[code] === undefined) subOf[code] = S_(r[col.subtitle]);
  });
  const tInfo = {};
  rows.forEach(function (r, i) {
    if (!isEnd(r)) return;
    const code = S_(r[col.chapter_code]);
    const info = ord.byCode[code];
    const subCk = ord.chapterOf[chapKey_(col.subtitle !== undefined ? r[col.subtitle] : '')];
    if (info && (subCk === undefined || subCk === info.chapterKey)) {
      tInfo[i] = { ck: info.chapterKey, pos: info.pos, anchor: code }; return;
    }
    let ck = subCk;
    if (ck === undefined) ck = ord.chapterOf[chapKey_(subOf[code])];
    for (let j = i - 1; j >= 0; j--) {
      const up = ord.byCode[S_(rows[j][col.chapter_code])];
      if (!up || isEnd(rows[j])) continue;
      if (ck === undefined) ck = up.chapterKey;
      if (up.chapterKey !== ck) continue;
      tInfo[i] = { ck: ck, pos: up.pos + 0.5, anchor: up.code, orphan: code };
      return;
    }
    if (ck !== undefined) tInfo[i] = { ck: ck, pos: -1, anchor: ord.lastOfChapter[ck], orphan: code };
  });
  const finalTestCode = {};
  const finalPos = {};
  Object.keys(tInfo).forEach(function (i) {
    const t = tInfo[i], g = S_(rows[i][col.chapter_code]);
    if (finalPos[t.ck] === undefined || finalPos[t.ck] < t.pos) { finalPos[t.ck] = t.pos; finalTestCode[t.ck] = g; }
  });
  Object.keys(tInfo).forEach(function (i) {
    const t = tInfo[i], r = rows[i], g = S_(r[col.chapter_code]);
    let target, why;
    if (finalTestCode[t.ck] === g) { target = ord.lastOfChapter[t.ck]; why = 'final test → last lecture of chapter: '; }
    else if (t.orphan) { target = t.anchor; why = 'mid-chapter test (code changed) → '; }
    else return;
    if (!target || target === g) return;
    if (set(r, 'chapter_code', target, why + target)) log.testMoved++;
  });
  const noTest = [];
  Object.keys(ord.lastOfChapter).forEach(function (ck) {
    if (finalTestCode[ck] || ord.lecCount[ck] < 2) return;
    const any = ord.list.filter(function (x) { return String(x.chapterKey) === ck; })[0];
    noTest.push(any.baseName || any.chapterNo);
  });

  // ---------- 3) In the Chapters sheet but not in the PATH -> new rows ----------
  const norm = function (x) { return S_(x).toUpperCase().replace(/\s+/g, ''); };   // ignore spaces / case
  const grp = function (t) { return (t === 'LIVE_LECTURE' || t === 'VIDEO_LECTURE') ? 'L' : t === 'LIVE_CLASS_NOTES' ? 'N' : t === 'DAILY_PRACTICE_PROBLEMS' ? 'D' : ''; };
  const have = {};
  rows.forEach(function (r) {
    const g = grp(S_(r[col.task_type]));
    if (g) have[norm(r[col.chapter_code]) + '|' + g] = true;
  });
  const style = subtitleStyle_(rows, col, ord);
  const newRows = [], newTpl = [];
  ord.list.forEach(function (info) {
    if (!info.active && !CFG.ADD_INACTIVE) return;
    const addingLecOrNotes = !have[norm(info.code) + '|L'] || !have[norm(info.code) + '|N'];
    const types = [info.done ? 'VIDEO_LECTURE' : 'LIVE_LECTURE', 'LIVE_CLASS_NOTES'];
    if (addingLecOrNotes) types.push('DAILY_PRACTICE_PROBLEMS');
    const sub = makeSubtitle_(info, ord, style);
    let made = 0;
    types.forEach(function (type) {
      if (have[norm(info.code) + '|' + grp(type)]) return;      // row already exists
      made++;
      const ti = pickTemplate_(rows, col, type, info.done);
      const row = ti >= 0 ? rows[ti].slice() : new Array(c.lastCol).fill('');
      const put = function (k, v) { if (col[k] !== undefined) row[col[k]] = v; };
      put('subject', subj.subject);
      put('task_type', type);
      put('chapter_code', info.code);
      put('node_click_type', CFG.CLICK_TYPE[type]);
      put('subtitle', sub.subtitle);
      put('microlecture_code', type === 'VIDEO_LECTURE' ? info.code + CFG.ML_SUFFIX : '');
      put('test_series_id', '');
      put('test_category_id', '');
      put('pdf_title', '');
      if (type === 'LIVE_CLASS_NOTES') {
        put('pdf_title', sub.pdfTitle);
        if (info.notes) put('pdf_url', info.notes);
        put('locked', info.done ? NO : YES);
      }
      if (type === 'DAILY_PRACTICE_PROBLEMS') {
        if (info.done) { put('test_series_id', info.code + CFG.DPP_SUFFIX); put('test_category_id', DPPCAT); }
        put('locked', info.done ? NO : YES);
      }
      newRows.push(row); newTpl.push(ti);
    });
    if (!made) return;
    if (made === 3) log.added++; else log.fixed++;
    if (changes.length < 300) changes.push(info.code + (made === 3 ? ' · NEW lecture (' + (info.done ? 'RECORDED' : 'UPCOMING') + ') – 3 rows' : ' · ' + made + ' missing row(s) add'));
  });

  // ---------- 4) Arrange keys ----------
  const all = rows.concat(newRows);
  let cutoff = -1;
  rows.forEach(function (r, i) {
    const info = ord.byCode[S_(r[col.chapter_code])];
    if (info && info.done) cutoff = i;
  });
  const keys = [];
  let anchor = 0;
  all.forEach(function (r, i) {
    const code = S_(r[col.chapter_code]);
    const info = ord.byCode[code];
    let rank = CFG.TYPE_RANK[S_(r[col.task_type])];
    if (rank === undefined) rank = 9;
    let k;
    if (info) { k = 1e9 + info.pos * 1e5 + rank * 1e4 + i; anchor = k; }
    else if (isDemo_(code)) { k = i; anchor = k; }
    else if (i < rows.length && i <= cutoff) k = anchor + 0.5 + i * 1e-5;
    else k = 2e9 + i;
    keys.push(k);
  });
  const perm = keys.map(function (k, i) { return i; }).sort(function (a, b) { return keys[a] - keys[b]; });
  let moved = 0;                                        // only count moves among existing rows (not the shift caused by new rows)
  perm.filter(function (orig) { return orig < rows.length; }).forEach(function (orig, i) { if (orig !== i) moved++; });

  // ---------- 5) Renumber (calculated for the preview) ----------
  const startId = Number(S_(rows.length ? rows[0][col.node_id] : '')) || subj.startId;
  let renum = 0;
  perm.forEach(function (orig, i) {
    const r = all[orig];
    if (Number(S_(r[col.node_id])) !== startId + i) renum++;
    else if (col.position !== undefined && Number(S_(r[col.position])) !== (i + 1) * CFG.POSITION_STEP) renum++;
  });

  // ---------- 5b) RECORDED rows that are not green yet (counted for the preview) ----------
  let colored = 0;
  if (!opts.apply) colored = countDoneNotGreen_(sh, c.first, rows, col, ord);

  // ---------- 6) APPLY ----------
  if (opts.apply) {
    Object.keys(touched).forEach(function (k) {
      sh.getRange(c.first, col[k] + 1, rows.length, 1).setValues(rows.map(function (r) { return [r[col[k]]]; }));
    });
    if (newRows.length) appendRows_(sh, c, newRows, newTpl);
    if (moved || newRows.length) sortByKeys_(sh, c, keys);
    if (opts.renumber !== false) renumber_(sh, c.first, all.length, col, startId);
    SpreadsheetApp.flush();
    colored = colorDoneRows_(sh, c.first, all.length, c.lastCol, col, ord);   // after sorting, on the final order
    SpreadsheetApp.flush();
  }

  // ---------- Summary ----------
  const lines = [];
  if (log.added) lines.push('• ' + log.added + ' new lectures (' + newRows.length + ' rows)');
  if (log.fixed) lines.push('• ' + log.fixed + ' lectures: missing rows (notes/DPP) added');
  if (log.converted) lines.push('• ' + log.converted + ' LIVE_LECTURE → VIDEO_LECTURE');
  if (log.ml) lines.push('• ' + log.ml + ' microlecture_code filled');
  if (log.pdf) lines.push('• ' + log.pdf + ' notes pdf_url from Chapters sheet');
  if (log.dpp) lines.push('• ' + log.dpp + ' DPP test_series/category');
  if (log.unlocked) lines.push('• ' + log.unlocked + ' rows unlocked');
  if (log.click) lines.push('• ' + log.click + ' node_click_type fix');
  if (log.testMoved) lines.push('• ' + log.testMoved + ' TEST rows moved to last lecture of chapter');
  if (colored) lines.push('• ' + colored + ' RECORDED rows will be coloured green');
  if (moved) lines.push('• ' + moved + ' rows will be reordered (Chapters sheet order)');
  if (renum && opts.renumber !== false) lines.push('• ' + renum + ' rows: node_id/position renumbered');

  const warnings = [];
  if (noTest.length) warnings.push('⚠️ These chapters have no TEST row (add manually): ' + noTest.join(', '));
  if (CFG.ORDER_BY !== 'POSITION' && ord.posDiff) warnings.push('Note: Chapters sheet position column differs from row order (' + ord.posDiff + ' lectures) – following the sheet row order');
  const gone = {};
  rows.forEach(function (r) {
    const code = S_(r[col.chapter_code]);
    if (code && !ord.byCode[code] && !isDemo_(code) && !isEnd(r)) gone[code] = true;
  });
  if (Object.keys(gone).length) warnings.push('⚠️ These lectures are in PATH but not in Chapters sheet (not deleted, please check): ' + Object.keys(gone).join(', '));

  const recorded = ord.list.filter(function (x) { return x.done; }).length;
  return {
    key: subj.key, label: subj.label, sheet: sh.getName(), applied: !!opts.apply,
    source: 'Chapters: ' + ord.source + '  →  PATH tab: ' + sh.getName(),
    lectures: ord.list.length, recorded: recorded, upcoming: ord.list.length - recorded,
    rows: all.length, totalChanges: lines.length, lines: lines, warnings: warnings,
    changes: changes.slice(0, 150),
    time: new Date().toLocaleString()
  };
}

// ============================== READ ==============================

function subjectCfg_(ss, key) {
  const s = CFG.SUBJECTS.filter(function (x) { return x.key === key; })[0];
  if (!s) throw new Error('Subject not found: ' + key);
  return { key: s.key, subject: s.subject, lang: s.lang, label: s.label, sheet: s.sheet, tabRe: s.tabRe,
           orderFile: s.orderFile, startId: 1001 };
}

function resolveTab_(ss, subj) {
  if (subj.sheet) {
    const t = ss.getSheetByName(subj.sheet);
    if (!t) throw new Error('Sheet not found: ' + subj.sheet);
    return t;
  }
  const cands = ss.getSheets().filter(function (t) {
    // name first (no read needed): backup copies and other subjects' tabs are never opened
    if (isBackupTab_(t.getName()) || !subj.tabRe.test(t.getName())) return false;
    if (t.getLastRow() < 2 || t.getLastColumn() < 1) return false;
    const h = t.getRange(1, 1, 1, t.getLastColumn()).getValues()[0].map(function (x) { return S_(x); });
    return h.indexOf('node_id') >= 0 && h.indexOf('task_type') >= 0 && h.indexOf('chapter_code') >= 0;
  });
  if (cands.length === 1) return cands[0];
  const all = ss.getSheets().map(function (t) { return t.getName(); }).join(', ');
  if (!cands.length) throw new Error(subj.label + ': PATH tab not found. File tabs: ' + all +
    '\nSet sheet: \'exact tab name\' for this subject in CFG.SUBJECTS.');
  throw new Error(subj.label + ': more than one tab found (' + cands.map(function (t) { return t.getName(); }).join(', ') +
    ').\nSet sheet: \'exact tab name\' in CFG.SUBJECTS.');
}

function readPath_(sh) {
  const lastCol = sh.getLastColumn();
  const hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const col = {};
  hdr.forEach(function (h, i) { const k = S_(h); if (k && col[k] === undefined) col[k] = i; });
  ['node_id', 'task_type', 'chapter_code'].forEach(function (k) {
    if (col[k] === undefined) throw new Error(sh.getName() + ': "' + k + '" column not found');
  });
  let data = [];
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    while (data.length) {
      const r = data[data.length - 1];
      if (S_(r[col.node_id]) || S_(r[col.task_type]) || S_(r[col.chapter_code])) break;
      data.pop();
    }
  }
  return { sh: sh, col: col, data: data, first: 2, lastCol: lastCol };
}

function readOrder_(ss, subj, c) {
  const files = [subj.orderFile];
  const have = {};
  c.data.forEach(function (r) { have[S_(r[c.col.chapter_code])] = true; });

  let best = null;
  const errs = [];
  files.forEach(function (fk) {
    try {
      const cand = readChaptersTab_(fk, have);
      if (!best || cand.score > best.score) best = cand;
    } catch (e) { errs.push(fk + ': ' + (e.message || e)); }
  });
  if (!best || best.score <= 0) {
    throw new Error(subj.label + ': Chapters data did not match the PATH sheet' + (errs.length ? '\n' + errs.join('\n') : ''));
  }

  const list = [], byCode = {};
  best.rows.forEach(function (info) {
    if (!info.code || byCode[info.code]) return;
    info.done = CFG.DONE_STATUS.indexOf(info.status) !== -1;
    list.push(info); byCode[info.code] = info;
  });
  const byPos = list.slice().sort(function (a, b) { return a.sortPos - b.sortPos || a.row - b.row; });
  if (CFG.ORDER_BY === 'POSITION') list.sort(function (a, b) { return a.sortPos - b.sortPos || a.row - b.row; });
  else list.sort(function (a, b) { return a.row - b.row; });
  let posDiff = 0;                                     // how far the position column differs from the row order
  list.forEach(function (x, i) { if (byPos[i] !== x) posDiff++; });

  const lastOfChapter = {}, chapterOf = {}, lecCount = {};
  let chap = 0;
  list.forEach(function (info, i) {
    info.pos = i;
    info.baseName = stripRoman_(info.title || info.chapterName) || stripRoman_(info.chapterName);
    const k = info.baseName ? chapKey_(info.baseName) : 'C|' + info.chapterNo;
    if (chapterOf[k] === undefined) chapterOf[k] = ++chap;
    info.chapterKey = chapterOf[k];
    lastOfChapter[info.chapterKey] = info.code;
    lecCount[info.chapterKey] = (lecCount[info.chapterKey] || 0) + 1;
  });
  return { list: list, byCode: byCode, lastOfChapter: lastOfChapter, lecCount: lecCount, chapterOf: chapterOf, posDiff: posDiff,
           source: best.fileName + ' / ' + best.tabName + ' (' + list.length + ' lectures read)' };
}

function readChaptersTab_(fileKey, have) {
  const f = BACKUP_FILES[fileKey];
  if (!f || !f.url) throw new Error('file is not set');
  const file = SpreadsheetApp.openByUrl(f.url);
  const tab = file.getSheets().filter(function (t) { return /^chapters?\s*_?\s*(hindi)?$/i.test(t.getName().trim()); })[0];
  if (!tab) throw new Error('Chapters / ChaptersHindi tab not found (' + f.name + ')');
  if (tab.getLastRow() < 2) throw new Error('Chapters tab is empty (' + f.name + ')');

  const v = tab.getRange(1, 1, tab.getLastRow(), tab.getLastColumn()).getValues();
  const hdr = v[0].map(function (h) { return S_(h).toLowerCase(); });
  const idx = {};
  Object.keys(CFG.COLS).forEach(function (k) {
    idx[k] = CFG.COLS[k].map(function (n) { return hdr.indexOf(n); }).filter(function (x) { return x >= 0; });
  });
  if (!idx.code.length) throw new Error('chapter_code column not found (' + tab.getName() + ')');
  if (!idx.status.length) throw new Error('chapter_status column not found (' + tab.getName() + ')');

  const first = function (r, k) {                       // pehla bhara hua alias
    for (let i = 0; i < idx[k].length; i++) { const x = S_(r[idx[k][i]]); if (x !== '') return x; }
    return '';
  };

  const rows = [];
  let score = 0;
  for (let i = 1; i < v.length; i++) {
    const r = v[i];
    const code = first(r, 'code');
    if (!code) continue;
    if (have[code]) score += 10;
    const posRaw = first(r, 'position');
    const p = Number(posRaw);
    const act = first(r, 'active').toUpperCase();
    rows.push({
      code: code,
      sortPos: posRaw === '' || isNaN(p) ? 1e6 + i : p,
      row: i,
      status: first(r, 'status').toUpperCase(),
      notes: first(r, 'notes'),
      title: first(r, 'title'),
      chapterName: first(r, 'name'),
      chapterNo: first(r, 'number'),
      active: !(act === '0' || act === 'FALSE' || act === 'NO')
    });
  }
  return { rows: rows, score: score, fileName: f.name, tabName: tab.getName() };
}

// ============================== WRITE ==============================

function appendRows_(sh, c, newRows, tpl) {
  const start = c.first + c.data.length;
  const need = start + newRows.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need);
  newRows.forEach(function (_, i) {
    if (tpl[i] < 0) return;
    const src = sh.getRange(c.first + tpl[i], 1, 1, c.lastCol);
    const dst = sh.getRange(start + i, 1, 1, c.lastCol);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    src.copyTo(dst, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  });
  sh.getRange(start, 1, newRows.length, c.lastCol).setValues(newRows);
}

function sortByKeys_(sh, c, keys) {
  const helper = c.lastCol + 1;
  let inserted = false;
  if (sh.getMaxColumns() < helper) { sh.insertColumnsAfter(sh.getMaxColumns(), 1); inserted = true; }
  sh.getRange(c.first, helper, keys.length, 1).setValues(keys.map(function (k) { return [k]; }));
  sh.getRange(c.first, 1, keys.length, helper).sort({ column: helper, ascending: true });
  if (inserted) sh.deleteColumn(helper);
  else sh.getRange(c.first, helper, keys.length, 1).clearContent();
}

function renumber_(sh, first, n, col, startId) {
  sh.getRange(first, col.node_id + 1, n, 1).setValues(
    Array.from({ length: n }, function (_, i) { return [String(startId + i)]; }));
  if (col.position !== undefined) {
    sh.getRange(first, col.position + 1, n, 1).setValues(
      Array.from({ length: n }, function (_, i) { return [(i + 1) * CFG.POSITION_STEP]; }));
  }
}

/**
 * Decides the colour of RECORDED rows (NodePath sheet).
 * Green = the most common colour of RECORDED rows (ignoring upcoming-row colours and white), per task_type.
 * Any RECORDED row not in that colour (white, cream, anything else) is a target.
 */
function planDoneColors_(bgs, keyCol, types, done, lastCol) {
  const lc = x => String(x || '').toLowerCase();
  const white = x => !x || lc(x) === '#ffffff';
  const mode = arr => { const m = {}; let best = null; arr.forEach(x => { m[x] = (m[x] || 0) + 1; if (best === null || m[x] > m[best]) best = x; }); return best; };

  const upMode = mode(bgs.filter((b, i) => !done[i] && !white(b[keyCol])).map(b => lc(b[keyCol])));
  const cand = [];
  bgs.forEach((b, i) => { if (done[i] && !white(b[keyCol]) && lc(b[keyCol]) !== upMode) cand.push(i); });

  const palOf = idx => {
    if (!idx.length) return null;
    const row = [];
    for (let j = 0; j < lastCol; j++) row.push(mode(idx.map(i => bgs[i][j])));
    return row;
  };
  const palAny = palOf(cand) || new Array(lastCol).fill(CFG.DONE_COLOR);
  const palType = {};
  cand.forEach(i => { const t = types[i]; (palType[t] = palType[t] || []).push(i); });
  Object.keys(palType).forEach(t => { palType[t] = palOf(palType[t]); });

  const targets = [];
  bgs.forEach((b, i) => {
    if (!done[i]) return;
    const pal = palType[types[i]] || palAny;
    if (lc(b[keyCol]) !== lc(pal[keyCol])) targets.push({ i: i, row: pal.slice() });
  });
  return targets;
}

function colorDoneRows_(sh, first, n, lastCol, col, ord) {
  if (!n) return 0;
  const rng = sh.getRange(first, 1, n, lastCol);
  const bgs = rng.getBackgrounds();
  const vals = sh.getRange(first, 1, n, lastCol).getValues();
  const types = vals.map(r => S_(r[col.task_type]));
  const done = vals.map(r => { const inf = ord.byCode[S_(r[col.chapter_code])]; return !!(inf && inf.done); });
  const targets = planDoneColors_(bgs, col.chapter_code, types, done, lastCol);
  if (!targets.length) return 0;
  targets.forEach(t => { bgs[t.i] = t.row; });
  rng.setBackgrounds(bgs);
  return targets.length;
}

function countDoneNotGreen_(sh, first, rows, col, ord) {
  if (!rows.length) return 0;
  const lastCol = rows[0].length;
  const bgs = sh.getRange(first, 1, rows.length, lastCol).getBackgrounds();
  const types = rows.map(r => S_(r[col.task_type]));
  const done = rows.map(r => { const inf = ord.byCode[S_(r[col.chapter_code])]; return !!(inf && inf.done); });
  return planDoneColors_(bgs, col.chapter_code, types, done, lastCol).length;
}

// ============================== HELPERS ==============================

function S_(x) { return x === null || x === undefined ? '' : String(x).trim(); }

function stripRoman_(s) { return S_(s).replace(/\s*-\s*[IVXLC]+\s*$/i, '').trim(); }

function chapKey_(s) {
  const n = S_(s).replace(/\s*Lecture\s*\d*\s*$/i, '').replace(/\s*-\s*[IVXLC]+\s*$/i, '')
    .replace(/\.pdf$/i, '').toLowerCase().replace(/\s+/g, ' ').trim();
  return n ? 'N|' + n : '';
}

function isDemo_(code) { return /DEM/i.test(code) && !/LIVE\d+$/i.test(code); }

function pickTemplate_(rows, col, type, done) {
  let any = -1, best = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (S_(rows[i][col.task_type]) !== type) continue;
    if (any < 0) any = i;
    const locked = S_(rows[i][col.locked]).toUpperCase();
    if ((done && locked !== 'YES') || (!done && (locked === 'YES' || type === 'LIVE_LECTURE'))) { best = i; break; }
  }
  if (best >= 0) return best;
  if (any >= 0) return any;
  for (let i = rows.length - 1; i >= 0; i--) if (CFG.TYPE_RANK[S_(rows[i][col.task_type])] !== undefined) return i;
  return rows.length - 1;
}

function subtitleStyle_(rows, col, ord) {
  let t = 0, l = 0;
  rows.forEach(function (r) {
    const info = ord.byCode[S_(r[col.chapter_code])];
    if (!info) return;
    const st = S_(r[col.subtitle]);
    if (st && st === info.title) t++;
    else if (/Lecture\s*\d+$/.test(st)) l++;
  });
  return t > l ? 'TITLE' : 'LECTURE_N';
}

function makeSubtitle_(info, ord, style) {
  const rm = info.title.match(/^(.*?)\s*-\s*([IVXLC]+)\s*$/i);
  let base, n;
  if (rm) { base = rm[1]; n = roman_(rm[2]); }
  else {
    base = (info.chapterName || info.title).replace(/\s*-\s*[IVXLC]+\s*$/i, '');
    n = ord.list.filter(function (x) { return x.chapterKey === info.chapterKey && x.pos <= info.pos; }).length;
  }
  return {
    subtitle: style === 'TITLE' && info.title ? info.title : base + ' Lecture ' + n,
    pdfTitle: base + ' Lecture ' + n + '.pdf'
  };
}

function roman_(s) {
  const m = { I: 1, V: 5, X: 10, L: 50, C: 100 };
  s = s.toUpperCase();
  let t = 0;
  for (let i = 0; i < s.length; i++) {
    const a = m[s[i]], b = m[s[i + 1]] || 0;
    t += a < b ? -a : a;
  }
  return t;
}