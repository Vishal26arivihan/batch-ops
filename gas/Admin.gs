// =====================================================================
// Admin.gs – Admin panel (users, admins, activity log, token details)
// Separate file in the same Apps Script project. Code.gs uses the functions in this file.
// =====================================================================

const ADM = {
  USERS_KEY: "ADM_USERS",            // Script Properties: [{email, role, addedBy, addedAt}]
  PASS_KEY: "ADM_PASS_HASH",         // hash of the common admin password
  SALT_KEY: "ADM_PASS_SALT",
  TOKREG_KEY: "ADM_TOKEN_REG",       // {email: {tail, source, savedAt, status, checkedAt, revokedAt}}
  LOG_TAB: "Logs",                   // activity log tab in Batch OPS
  TOKLOG_TAB: "Token History",       // token change history tab in Batch OPS
  FIRST_ADMIN: "vishal26.arivihan@gmail.com",
  SESSION_MIN: 30,
  MAX_FAILS: 5, LOCK_MIN: 15
};

// ---------- basic helpers ----------
function admMe_() {
  let e = "";
  try { e = Session.getActiveUser().getEmail() || ""; } catch (x) {}
  return String(e).trim().toLowerCase();
}
function admNotAdmin_() {
  const me = admMe_();
  return new Error("You are not an admin (signed in as: " + (me || "unknown – Google did not share your email") + ").");
}
function admProps_() { return PropertiesService.getScriptProperties(); }
function admNow_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss"); }
function admTail_(tok) { tok = String(tok || "").trim(); return tok ? tok.slice(-4) : ""; }

let ADM_USERS_MEMO_ = null;                 // SPEED: read the list only once per request
function admUsers_() {
  if (ADM_USERS_MEMO_) return ADM_USERS_MEMO_;
  ADM_USERS_MEMO_ = admUsersRead_();
  return ADM_USERS_MEMO_;
}
function admUsersRead_() {
  const raw = admProps_().getProperty(ADM.USERS_KEY);
  if (raw) {
    try {
      const list = JSON.parse(raw);
      // OWNER LOCK: the owner (FIRST_ADMIN) is always in the list and always an admin
      const f = list.filter(u => u.email === ADM.FIRST_ADMIN)[0];
      if (!f || f.role !== "admin") {
        if (f) f.role = "admin";
        else list.unshift({ email: ADM.FIRST_ADMIN, role: "admin", addedBy: "auto-restore (owner)", addedAt: admNow_() });
        admProps_().setProperty(ADM.USERS_KEY, JSON.stringify(list));
      }
      return list;
    } catch (e) {}
  }
  // first run: build from the old ALLOWED_EMAILS list in Code.gs
  const seed = (typeof ALLOWED_EMAILS !== "undefined" ? ALLOWED_EMAILS : []).map(e => String(e).trim().toLowerCase()).filter(Boolean);
  if (seed.indexOf(ADM.FIRST_ADMIN) === -1) seed.unshift(ADM.FIRST_ADMIN);
  const list = seed.map(e => ({ email: e, role: e === ADM.FIRST_ADMIN ? "admin" : "user", addedBy: "initial list", addedAt: admNow_() }));
  admProps_().setProperty(ADM.USERS_KEY, JSON.stringify(list));
  return list;
}
function admSaveUsers_(list) { admProps_().setProperty(ADM.USERS_KEY, JSON.stringify(list)); ADM_USERS_MEMO_ = list; }

/** Used by Code.gs to check whether the user may use the dashboard. */
function isAllowedUser_(email) {
  email = String(email || "").trim().toLowerCase();
  return !!email && admUsers_().some(u => u.email === email);
}
/** May this user fall back to the shared token when they have no own token? (set in the admin panel) */
function canUseShared_(email) {
  email = String(email || "").trim().toLowerCase();
  const u = admUsers_().filter(x => x.email === email)[0];
  if (!u) return false;
  if (typeof u.sharedOk === "boolean") return u.sharedOk;
  return u.role === "admin";            // default: admin = yes, user = no
}

function adminSetSharedOk(email, allow) {
  admRequire_();
  email = String(email || "").trim().toLowerCase();
  assertNotOwner_(email, "changed");
  const list = admUsers_();
  const u = list.filter(x => x.email === email)[0];
  if (!u) throw new Error(email + " is not in the list.");
  u.sharedOk = !!allow;
  admSaveUsers_(list);
  logAction_(allow ? "SHARED_TOKEN_ALLOW" : "SHARED_TOKEN_BLOCK", email, "OK", "");
  return adminData();
}

// ---------- Feature access (set per user in the admin panel) ----------
const FEATURES = [
  { id: "today",      label: "Today tab" },
  { id: "lecture",    label: "Lecture Push (form, links, import from main sheet)" },
  { id: "push_dash",  label: "Update on Sheet and Internal Metrics", needs: "lecture" },
  { id: "push_nodes", label: "Push Nodes",                           needs: "lecture" },
  { id: "push_dpp",   label: "Push DPP",                             needs: "lecture" },
  { id: "pdf_update", label: "Update on main sheet (PDF)",           needs: "lecture" },
  { id: "nodepath",   label: "NodePath update (arrange subjects)" },
  { id: "upload",     label: "Upload to Internal Metrics" },
  { id: "dpp",        label: "DPP upload (select DPPs + upload to Internal Metrics)" },
  { id: "clear_cache", label: "Clear Internal Metrics cache" },
  { id: "sheets",     label: "Sheets tab (open / edit the working sheets)" },
  { id: "thumbnail",  label: "Video Image maker (create + save chapter thumbnails)" }
];
function featureLabel_(id) { const f = FEATURES.filter(x => x.id === id)[0]; return f ? f.label : id; }

/** Features enabled for the user. Admin = all. Older users without a feature list = all. */
function userFeatures_(email) {
  email = String(email || "").trim().toLowerCase();
  const u = admUsers_().filter(x => x.email === email)[0];
  if (!u) return [];
  const all = FEATURES.map(f => f.id);
  if (u.role === "admin" || !Array.isArray(u.features)) return all;
  const on = u.features.filter(id => all.indexOf(id) >= 0);
  return on.filter(id => {
    const f = FEATURES.filter(x => x.id === id)[0];
    return !f.needs || on.indexOf(f.needs) >= 0;          // Lecture Push off = its push buttons are off too
  });
}
function hasFeature_(email, id) { return userFeatures_(email).indexOf(id) >= 0; }

function adminSetFeatures(email, list) {
  admRequire_();
  email = String(email || "").trim().toLowerCase();
  const all = FEATURES.map(f => f.id);
  const users = admUsers_();
  const u = users.filter(x => x.email === email)[0];
  if (!u) throw new Error(email + " is not in the list.");
  if (u.role === "admin") throw new Error("Admins always have access to every feature.");
  const before = userFeatures_(email);
  u.features = (Array.isArray(list) ? list : []).map(String).filter((id, i, a) => all.indexOf(id) >= 0 && a.indexOf(id) === i);
  admSaveUsers_(users);
  const after = userFeatures_(email);
  const added = after.filter(x => before.indexOf(x) < 0).map(featureLabel_);
  const removed = before.filter(x => after.indexOf(x) < 0).map(featureLabel_);
  logAction_("FEATURES_SET", email, "OK",
    (added.length ? "Allowed: " + added.join(", ") : "") + (added.length && removed.length ? " | " : "") +
    (removed.length ? "Blocked: " + removed.join(", ") : "") + (!added.length && !removed.length ? "No change" : ""));
  const report = admShareFiles_(email);             // file access follows the features
  logAction_("FILES_SYNCED", email, report.some(r => r.indexOf("⚠️") === 0) ? "PARTIAL" : "OK", report.join("\n"));
  const d = adminData();
  d.shareReport = report;
  return d;
}

/** The owner (FIRST_ADMIN) can never be removed, demoted or changed by another admin. */
function isOwnerEmail_(email) { return String(email || "").trim().toLowerCase() === ADM.FIRST_ADMIN; }
function assertNotOwner_(email, what) {
  if (isOwnerEmail_(email) && !isOwnerEmail_(admMe_())) {
    logAction_("OWNER_PROTECTED", email, "BLOCKED", what + " was blocked (owner account is locked)");
    throw new Error(email + " is the owner account – it cannot be " + what + " by another admin.");
  }
}

function isAdminUser_(email) {
  email = String(email || "").trim().toLowerCase();
  return !!email && admUsers_().some(u => u.email === email && u.role === "admin");
}

// ---------- Logs (tabs in Batch OPS) ----------
function admLogTab_(name, headers) {
  const ss = book_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setBackground("#d9d9d9");
    sh.setFrozenRows(1);
    try { sh.protect().setDescription("Activity log – written by script").setWarningOnly(true); } catch (e) {}
    try { sh.hideSheet(); } catch (e) {}
  }
  return sh;
}

/** Records every action. Never throws (the real work continues even if logging fails). */
function logAction_(action, target, result, details) {
  try {
    let tail = "", src = "";
    // Stage (test server) actions are written with a STAGE_ prefix, so Today / push checks only count production
    try { if (typeof isStage_ === "function" && isStage_() && /^(PUSH_|IM_UPLOAD|DPP_UPLOAD|CACHE_CLEAR|TOKEN_|RESTORE)/.test(String(action))) action = "STAGE_" + action; } catch (e) {}
    try {
      if (String(action).indexOf("STAGE_") === 0) {
        const st = (PropertiesService.getUserProperties().getProperty("AVTOKEN_STAGE") || "").trim();
        tail = st ? admTail_(st) : ""; src = "stage";
        throw 0;
      }
      const own = (PropertiesService.getUserProperties().getProperty("AVTOKEN") || "").trim();
      const usable = own && !admTokenRevoked_(admMe_());
      if (usable) { tail = admTail_(own); src = "own"; }
      else if (canUseShared_(admMe_())) { tail = admTail_(admProps_().getProperty("AVTOKEN")); src = "shared"; }
      else { src = "none (shared not allowed)"; }
    } catch (e) {}
    const sh = admLogTab_(ADM.LOG_TAB, ["Time", "Email", "Action", "Target", "Result", "Token (last 4)", "Token source", "Details", "Check"]);
    if (sh.getLastColumn() < 9 || !String(sh.getRange(1, 9).getValue())) sh.getRange(1, 9).setValue("Check").setFontWeight("bold").setBackground("#d9d9d9");
    const cells = [admNow_(), admMe_() || "(unknown)", String(action || ""), String(target || ""), String(result || ""),
                   tail ? "…" + tail : "", src, String(details || "").substring(0, 2000)];
    // SAFETY: hash of the row + hash of the previous row -> edits / deletions can be detected (Admin → Safety → Verify logs)
    let prev = "";
    try {
      const lr = sh.getLastRow();
      if (lr >= 2) { const m = String(sh.getRange(lr, 9).getDisplayValue()).match(/^([A-Za-z0-9_-]{16})\|/); prev = m ? m[1] : ""; }
    } catch (e) {}
    const own = logHash_(prev, cells);
    sh.appendRow(cells.map(asText_).concat([asText_(own + "|" + prev)]));
    try { admProps_().setProperty(SAFE.LOG_LAST_KEY, JSON.stringify({ h: own, at: cells[0] })); } catch (e) {}
  } catch (e) {}
  try { if (typeof cacheBustAfter_ === "function") cacheBustAfter_(action); } catch (e) {}     // drop cached data
}

function tokenHistory_(forEmail, action, oldTail, newTail, note) {
  try {
    const sh = admLogTab_(ADM.TOKLOG_TAB, ["Time", "Done by", "Token of", "Action", "Old (last 4)", "New (last 4)", "Note"]);
    sh.appendRow([admNow_(), admMe_() || "(unknown)", forEmail, action, oldTail ? "…" + oldTail : "", newTail ? "…" + newTail : "", note || ""]);
  } catch (e) {}
}

// ---------- Token registry (details shown to admins) ----------
function admTokReg_() {
  const raw = admProps_().getProperty(ADM.TOKREG_KEY);
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}
function admSaveTokReg_(reg) { admProps_().setProperty(ADM.TOKREG_KEY, JSON.stringify(reg)); }

/** Called from Code.gs on token save / clear / status check. */
function tokenRegistryUpdate_(email, patch) {
  try {
    const lock = LockService.getScriptLock();
    let locked = false;
    try { lock.waitLock(10000); locked = true; } catch (e) {}
    try {
      const reg = admTokReg_();
      reg[email] = Object.assign(reg[email] || {}, patch);
      admSaveTokReg_(reg);
    } finally { if (locked) lock.releaseLock(); }
  } catch (e) {}
}

/** True when an admin reset this user's token and the user has not saved a new one since */
function admTokenRevoked_(email) {
  const r = admTokReg_()[email];
  if (!r || !r.revokedAt) return false;
  const savedMs = Number(PropertiesService.getUserProperties().getProperty("AVTOKEN_AT_MS") || 0);
  return savedMs < Number(r.revokedAt);
}

// ---------- admin session + password ----------
function admHash_(pass, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + "|" + pass, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}
function admLoggedIn_() {
  return isAdminUser_(admMe_()) && CacheService.getUserCache().get("adm_session") === "1";
}
function admRequire_() {
  if (!isAdminUser_(admMe_())) throw admNotAdmin_();
  if (!admLoggedIn_()) throw new Error("ADMIN_LOGIN_REQUIRED: please log in to the admin panel again.");
  CacheService.getUserCache().put("adm_session", "1", ADM.SESSION_MIN * 60);   // extend the session on every action
}
function admCheckPassStrength_(p) {
  if (String(p || "").length < 6) throw new Error("Password must be at least 6 characters.");
}

function adminStatus() {
  const me = admMe_();
  return { email: me, isAdmin: isAdminUser_(me), hasPassword: !!admProps_().getProperty(ADM.PASS_KEY), loggedIn: admLoggedIn_() };
}

function adminSetupPassword(pass) {
  const me = admMe_();
  if (!isAdminUser_(me)) throw admNotAdmin_();
  if (admProps_().getProperty(ADM.PASS_KEY)) throw new Error("Admin password is already set. Please log in.");
  admCheckPassStrength_(pass);
  const salt = Utilities.getUuid();
  admProps_().setProperties({ [ADM.SALT_KEY]: salt, [ADM.PASS_KEY]: admHash_(pass, salt) });
  CacheService.getUserCache().put("adm_session", "1", ADM.SESSION_MIN * 60);
  logAction_("ADMIN_PASSWORD_SET", "", "OK", "First admin password created");
  return adminStatus();
}

function adminLogin(email, pass) {
  const me = admMe_();
  const cache = CacheService.getScriptCache();
  const fk = "adm_fail_" + me;
  const fails = Number(cache.get(fk) || 0);
  if (fails >= ADM.MAX_FAILS) throw new Error("Too many wrong attempts. Try again after " + ADM.LOCK_MIN + " minutes.");
  if (String(email || "").trim().toLowerCase() !== me) {
    logAction_("ADMIN_LOGIN_FAIL", email, "FAIL", "Entered email does not match signed-in Google account");
    throw new Error("Email must be the Google account you are signed in with (" + me + ").");
  }
  if (!isAdminUser_(me)) { logAction_("ADMIN_LOGIN_FAIL", me, "FAIL", "Not an admin"); throw admNotAdmin_(); }
  const salt = admProps_().getProperty(ADM.SALT_KEY), hash = admProps_().getProperty(ADM.PASS_KEY);
  if (!hash) throw new Error("Admin password is not set yet.");
  if (admHash_(String(pass || ""), salt) !== hash) {
    cache.put(fk, String(fails + 1), ADM.LOCK_MIN * 60);
    logAction_("ADMIN_LOGIN_FAIL", me, "FAIL", "Wrong password (" + (fails + 1) + "/" + ADM.MAX_FAILS + ")");
    throw new Error("Wrong password. " + (ADM.MAX_FAILS - fails - 1) + " attempts left.");
  }
  cache.remove(fk);
  CacheService.getUserCache().put("adm_session", "1", ADM.SESSION_MIN * 60);
  logAction_("ADMIN_LOGIN", me, "OK", "");
  return adminStatus();
}

function adminLogout() {
  CacheService.getUserCache().remove("adm_session");
  return adminStatus();
}

function adminChangePassword(oldPass, newPass) {
  admRequire_();
  const salt = admProps_().getProperty(ADM.SALT_KEY), hash = admProps_().getProperty(ADM.PASS_KEY);
  if (admHash_(String(oldPass || ""), salt) !== hash) throw new Error("Current password is wrong.");
  admCheckPassStrength_(newPass);
  const ns = Utilities.getUuid();
  admProps_().setProperties({ [ADM.SALT_KEY]: ns, [ADM.PASS_KEY]: admHash_(newPass, ns) });
  logAction_("ADMIN_PASSWORD_CHANGE", "", "OK", "");
  return true;
}

/** Forgot the password? Run this in the Apps Script editor – the next admin to open the Admin tab creates a new one. */
function adminResetPassword() {
  admProps_().deleteProperty(ADM.PASS_KEY);
  admProps_().deleteProperty(ADM.SALT_KEY);
  logAction_("ADMIN_PASSWORD_RESET", "", "OK", "Reset from Apps Script editor");
}

// ---------- admin data ----------
function admReadTab_(name, limit) {
  const sh = book_().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const n = Math.min(limit, sh.getLastRow() - 1);
  const start = sh.getLastRow() - n + 1;
  return sh.getRange(start, 1, n, sh.getLastColumn()).getDisplayValues().reverse();   // newest first
}

function adminData() {
  admRequire_();
  const users = admUsers_();
  const reg = admTokReg_();
  const sharedTok = admProps_().getProperty("AVTOKEN") || "";
  return {
    me: admMe_(),
    owner: ADM.FIRST_ADMIN,
    users: users.map(u => Object.assign({}, u, { sharedOk: canUseShared_(u.email), features: userFeatures_(u.email) })),
    featureList: FEATURES,
    tokens: users.map(u => Object.assign({ email: u.email }, reg[u.email] || {})),
    shared: { tail: admTail_(sharedTok), set: !!sharedTok },
    logs: admReadTab_(ADM.LOG_TAB, 300),
    tokenHistory: admReadTab_(ADM.TOKLOG_TAB, 200),
    safety: safetyData_(),
    restorePoints: admRestoreList_()
  };
}

function adminAddUser(email, role, pass, features) {
  admRequire_();
  email = String(email || "").trim().toLowerCase();
  role = role === "admin" ? "admin" : "user";
  if (role === "admin") admRecheck_(pass);                 // adding an admin is a protected action
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email.");
  const list = admUsers_();
  const ex = list.filter(u => u.email === email)[0];
  if (ex) {
    if (ex.role === role) throw new Error(email + " is already a " + role + ".");
    ex.role = role;
    logAction_("ROLE_CHANGE", email, "OK", "Role set to " + role);
  } else {
    const nu = { email: email, role: role, addedBy: admMe_(), addedAt: admNow_() };
    if (role === "user" && Array.isArray(features)) {          // features chosen in the Add form
      const all = FEATURES.map(f => f.id);
      nu.features = features.map(String).filter((id, i, a) => all.indexOf(id) >= 0 && a.indexOf(id) === i);
    }
    list.push(nu);
    logAction_(role === "admin" ? "ADMIN_ADD" : "USER_ADD", email, "OK", "");
  }
  admSaveUsers_(list);
  const report = admShareFiles_(email);          // only the files needed for their features
  logAction_("FILES_SYNCED", email, report.some(r => r.indexOf("⚠️") === 0) ? "PARTIAL" : "OK", report.join("\n"));
  const d = adminData();
  d.shareReport = report;
  return d;
}

function adminSetRole(email, role, pass) {
  admRequire_();
  email = String(email || "").trim().toLowerCase();
  if (isOwnerEmail_(email)) throw new Error(email + " is the owner account – it always stays admin.");
  admRecheck_(pass);
  role = role === "admin" ? "admin" : "user";
  const list = admUsers_();
  const u = list.filter(x => x.email === email)[0];
  if (!u) throw new Error(email + " is not in the list.");
  if (u.role === "admin" && role !== "admin" && list.filter(x => x.role === "admin").length <= 1) throw new Error("You cannot remove the last admin.");
  if (email === admMe_() && role !== "admin") throw new Error("You cannot remove your own admin role. Ask another admin.");
  u.role = role;
  admSaveUsers_(list);
  logAction_("ROLE_CHANGE", email, "OK", "Role set to " + role);
  const report = admShareFiles_(email);             // admin = every file, user = files for their features
  logAction_("FILES_SYNCED", email, report.some(r => r.indexOf("⚠️") === 0) ? "PARTIAL" : "OK", report.join("\n"));
  const d = adminData();
  d.shareReport = report;
  return d;
}

// ---------- File access (the web app runs as the user, so every file needs Editor access) ----------
function admFiles_(opts) {
  let bookId = BOOK_ID;
  try { bookId = book_().getId(); } catch (e) {}          // real ID straight from the sheet (works even if BOOK_ID has a typo)
  const out = [{ name: "Batch OPS (this sheet)", id: bookId, group: "book" }];
  const seen = {};
  seen[bookId] = 1;
  const add = (name, url, group) => {
    const m = String(url || "").match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m && !seen[m[1]]) { seen[m[1]] = 1; out.push({ name: name, id: m[1], group: group }); }
  };
  Object.keys(BACKUP_FILES).forEach(k => add(BACKUP_FILES[k].name + " (live sheet)", BACKUP_FILES[k].url, "live"));
  Object.keys(NODE_FILES).forEach(k => add("NodePath " + k, NODE_FILES[k], "node"));
  Object.keys(CFG.FILES).forEach(k => add("NodePath " + k, CFG.FILES[k], "node"));
  // DPP files (users need Editor access to select / upload DPPs). Not in the daily backup – they are large.
  if (!(opts && opts.noDpp) && typeof DPP_FILES !== "undefined") Object.keys(DPP_FILES).forEach(k => add("DPP " + k, DPP_FILES[k], "dpp"));
  return out;
}

// Which files each feature needs (the dashboard runs as the user, so it needs Editor access to these files).
// Batch OPS is always needed (Automation tab + activity log).
const FILE_GROUP_FEATURES = {
  live: ["today", "lecture", "push_dash", "push_nodes", "push_dpp", "pdf_update", "nodepath", "thumbnail"],
  node: ["nodepath", "upload", "push_nodes", "push_dpp"],
  dpp:  ["dpp"]
};
const FILE_GROUP_LABEL = { book: "always needed", live: "Today / Lecture Push / NodePath", node: "NodePath / Upload / Push Nodes / Push DPP", dpp: "DPP upload" };

/** Files this user needs, based on role + features. Admins need everything. */
function admNeededGroups_(email) {
  if (isAdminUser_(email)) return ["book", "live", "node", "dpp"];
  const f = userFeatures_(email);
  const g = ["book"];
  Object.keys(FILE_GROUP_FEATURES).forEach(k => { if (FILE_GROUP_FEATURES[k].some(x => f.indexOf(x) >= 0)) g.push(k); });
  return g;
}

/**
 * Sync file access with the user's features: Editor access to the files they need,
 * access removed from the files they do not need. The owner account is never touched.
 */
function admShareFiles_(email) {
  email = String(email || "").trim().toLowerCase();
  if (isOwnerEmail_(email)) return ["✅ Owner account – has access to every file (not changed)"];
  const need = admNeededGroups_(email);
  return admFiles_().map(f => {
    const wanted = need.indexOf(f.group) >= 0;
    try {
      const ss = SpreadsheetApp.openById(f.id);
      const isEd = ss.getEditors().some(u => String(u.getEmail()).toLowerCase() === email);
      const isVw = ss.getViewers().some(u => String(u.getEmail()).toLowerCase() === email);
      if (wanted) {
        if (!isEd) ss.addEditor(email);
        return "✅ " + f.name + (isEd ? " (already editor)" : " – editor added");
      }
      if (isEd) ss.removeEditor(email);
      if (isVw) ss.removeViewer(email);
      return "➖ " + f.name + (isEd || isVw ? " – access removed (not needed for their features)" : " – no access (not needed)");
    } catch (e) {
      return "⚠️ " + f.name + ": " + (e.message || e) + " – " + (wanted ? "share" : "remove access from") + " this file manually";
    }
  });
}

function adminShareFiles(email) {
  admRequire_();
  email = String(email || "").trim().toLowerCase();
  if (!isAllowedUser_(email)) throw new Error(email + " is not in the user list.");
  const report = admShareFiles_(email);
  logAction_("FILES_SYNCED", email, report.some(r => r.indexOf("⚠️") === 0) ? "PARTIAL" : "OK", report.join("\n"));
  const d = adminData();
  d.shareReport = report;
  return d;
}

function adminRemoveUser(email, pass) {
  admRequire_();
  email = String(email || "").trim().toLowerCase();
  if (isOwnerEmail_(email)) { assertNotOwner_(email, "removed"); throw new Error("The owner account cannot be removed."); }
  admRecheck_(pass);
  const list = admUsers_();
  const u = list.filter(x => x.email === email)[0];
  if (!u) throw new Error(email + " is not in the list.");
  if (u.role === "admin" && list.filter(x => x.role === "admin").length <= 1) throw new Error("You cannot remove the last admin.");
  if (email === admMe_()) throw new Error("You cannot remove yourself. Ask another admin.");
  admSaveUsers_(list.filter(x => x.email !== email));
  logAction_(u.role === "admin" ? "ADMIN_REMOVE" : "USER_REMOVE", email, "OK", "");
  const report = admUnshareFiles_(email);         // remove access to all files
  logAction_("FILES_UNSHARED", email, report.some(r => r.indexOf("⚠️") === 0) ? "PARTIAL" : "OK", report.join("\n"));
  const d = adminData();
  d.shareReport = report;
  return d;
}

/** Remove the user's Editor / Viewer access from all working files (Google refuses for the file owner – reported with ⚠️). */
function admUnshareFiles_(email) {
  return admFiles_().map(f => {
    try {
      const ss = SpreadsheetApp.openById(f.id);
      const isEd = ss.getEditors().some(x => String(x.getEmail()).toLowerCase() === email);
      const isVw = ss.getViewers().some(x => String(x.getEmail()).toLowerCase() === email);
      if (isEd) ss.removeEditor(email);
      if (isVw) ss.removeViewer(email);
      return "✅ " + f.name + (isEd || isVw ? " – access removed" : " (had no access)");
    } catch (e) {
      return "⚠️ " + f.name + ": " + (e.message || e) + " – remove access manually";
    }
  });
}

/** Reset a user's token: their own token is not used until they save a new one. */
function adminResetUserToken(email) {
  admRequire_();
  email = String(email || "").trim().toLowerCase();
  assertNotOwner_(email, "token-reset");
  const old = (admTokReg_()[email] || {}).tail || "";
  tokenRegistryUpdate_(email, { revokedAt: Date.now(), status: "reset by admin" });
  tokenHistory_(email, "RESET_BY_ADMIN", old, "", "User must enter a new token");
  logAction_("TOKEN_RESET", email, "OK", "Old …" + old);
  return adminData();
}

function adminSetSharedToken(tok, pass) {
  admRequire_();
  admRecheck_(pass);
  tok = String(tok || "").trim().replace(/^avtoken\s*:\s*/i, "").replace(/^["']|["']$/g, "");
  if (!tok) throw new Error("Token is empty");
  const code = tokenTest_(tok);
  if (code === 401) throw new Error("This token is not valid (401).");
  if (code !== 200) throw new Error("Could not verify the token (HTTP " + code + "). Nothing was saved.");
  const old = admTail_(admProps_().getProperty("AVTOKEN"));
  admProps_().setProperty("AVTOKEN", tok);
  tokenHistory_("(shared)", "SHARED_SET", old, admTail_(tok), "");
  logAction_("SHARED_TOKEN_SET", "(shared)", "OK", "…" + old + " → …" + admTail_(tok));
  return adminData();
}


// =====================================================================
// SAFETY: emergency stop, push limit, password re-check, log check,
//         restore points, daily backup, standalone migration helpers
// =====================================================================
const SAFE = {
  FREEZE_KEY: "ADM_FREEZE",                // {on, by, at, reason}
  RATE_KEY: "ADM_RATE",                    // {perHour}  (0 = band)
  RATE_USER_PREFIX: "ADM_RATE_U_",         // push timestamps per user
  LOG_SECRET_KEY: "ADM_LOG_SECRET",        // secret for the log hashes
  LOG_LAST_KEY: "ADM_LOG_LAST",            // hash of the latest log row
  RESTORE_TAB: "Restore Points",
  BACKUP_LAST_KEY: "ADM_BACKUP_LAST",
  BACKUP_FOLDER: "Batch OPS Backups",
  BACKUP_KEEP_DAYS: 7,
  BACKUP_HOUR: 2                            // raat 2 baje (script time zone)
};

// ---------- Password re-check (protected actions) ----------
function admRecheck_(pass) {
  const me = admMe_();
  const cache = CacheService.getScriptCache();
  const fk = "adm_fail_" + me;
  const fails = Number(cache.get(fk) || 0);
  if (fails >= ADM.MAX_FAILS) throw new Error("Too many wrong attempts. Try again after " + ADM.LOCK_MIN + " minutes.");
  const salt = admProps_().getProperty(ADM.SALT_KEY), hash = admProps_().getProperty(ADM.PASS_KEY);
  if (!hash || admHash_(String(pass || ""), salt) !== hash) {
    cache.put(fk, String(fails + 1), ADM.LOCK_MIN * 60);
    logAction_("ADMIN_RECHECK_FAIL", me, "FAIL", "Wrong password for a protected action (" + (fails + 1) + "/" + ADM.MAX_FAILS + ")");
    throw new Error("Wrong admin password. " + (ADM.MAX_FAILS - fails - 1) + " attempts left. Nothing was changed.");
  }
  cache.remove(fk);
}

// ---------- 🚨 emergency stop ----------
function freezeInfo_() {
  try { const f = JSON.parse(admProps_().getProperty(SAFE.FREEZE_KEY) || "null"); return f && f.on ? f : null; } catch (e) { return null; }
}
function freezeMsg_(f) {
  return "EMERGENCY STOP is ON – all pushes and sheet updates are blocked." +
    (f ? "\nTurned on by " + f.by + " at " + f.at + (f.reason ? "\nReason: " + f.reason : "") : "") +
    "\nAsk an admin to turn it off in Admin → Safety.";
}
function assertNotFrozen_() { const f = freezeInfo_(); if (f) throw new Error(freezeMsg_(f)); }

function adminSetFreeze(on, reason, pass) {
  admRequire_();
  admRecheck_(pass);
  if (on) {
    reason = String(reason || "").trim().substring(0, 300);
    admProps_().setProperty(SAFE.FREEZE_KEY, JSON.stringify({ on: true, by: admMe_(), at: admNow_(), reason: reason }));
    logAction_("EMERGENCY_STOP_ON", "(all pushes)", "OK", reason);
  } else {
    admProps_().deleteProperty(SAFE.FREEZE_KEY);
    logAction_("EMERGENCY_STOP_OFF", "(all pushes)", "OK", "");
  }
  return adminData();
}

// ---------- push limit (per user, per hour) ----------
function rateCfg_() {
  try { const r = JSON.parse(admProps_().getProperty(SAFE.RATE_KEY) || "null"); if (r && r.perHour >= 0) return r; } catch (e) {}
  return { perHour: 30 };
}
function adminSetRate(perHour) {
  admRequire_();
  const n = Math.max(0, Math.min(1000, Math.floor(Number(perHour) || 0)));
  admProps_().setProperty(SAFE.RATE_KEY, JSON.stringify({ perHour: n }));
  logAction_("PUSH_LIMIT_SET", "(users)", "OK", n ? n + " pushes per hour per user" : "Limit turned off");
  return adminData();
}
/** Counts every real push (after confirmation). No limit for admins. Throws when over the limit. */
function rateTake_(kind) {
  const me = admMe_();
  if (isAdminUser_(me)) return;
  const lim = rateCfg_().perHour;
  if (!lim) return;
  const key = SAFE.RATE_USER_PREFIX + me;
  const now = Date.now();
  let list = [];
  try { list = JSON.parse(admProps_().getProperty(key) || "[]"); } catch (e) {}
  list = list.filter(t => now - t < 3600000);
  if (list.length >= lim) {
    logAction_("PUSH_LIMIT_HIT", kind, "BLOCKED", list.length + " pushes in the last hour (limit " + lim + ")");
    const wait = Math.ceil((3600000 - (now - list[0])) / 60000);
    throw new Error("BLOCKED – push limit reached: " + lim + " pushes per hour. Try again in about " + wait + " min, or ask an admin to raise the limit (Admin → Safety).");
  }
  list.push(now);
  admProps_().setProperty(key, JSON.stringify(list));
}

// ---------- Logs: per-row hash (tamper detection) ----------
function logSecret_() {
  let s = admProps_().getProperty(SAFE.LOG_SECRET_KEY);
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); admProps_().setProperty(SAFE.LOG_SECRET_KEY, s); }
  return s;
}
function logHash_(prev, cells) {
  const sig = Utilities.computeHmacSha256Signature(prev + "␞" + cells.join("␟"), logSecret_(), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(sig).substring(0, 16);
}
/** Keep text as text (even if it starts with =, +, - or looks like a date). */
function asText_(v) { v = String(v == null ? "" : v); return v === "" ? "" : "'" + v; }

/** Admin → Verify logs */
function adminVerifyLogs() {
  admRequire_();
  const sh = book_().getSheetByName(ADM.LOG_TAB);
  if (!sh || sh.getLastRow() < 2) return { ok: true, total: 0, checked: 0, old: 0, problems: [] };
  const v = sh.getRange(2, 1, sh.getLastRow() - 1, 9).getDisplayValues();
  const seen = {}, used = {}, problems = [];
  let checked = 0, old = 0, firstHashed = -1;
  v.forEach((r, i) => {
    const rowNo = i + 2, chk = String(r[8] || "");
    const m = chk.match(/^([A-Za-z0-9_-]{16})\|([A-Za-z0-9_-]*)$/);
    if (!m) {
      if (firstHashed < 0) { old++; return; }
      problems.push("Row " + rowNo + ": check code is missing or changed (row added or edited by hand)");
      return;
    }
    if (firstHashed < 0) firstHashed = i;
    checked++;
    const own = m[1], prev = m[2];
    if (logHash_(prev, r.slice(0, 8)) !== own) problems.push("Row " + rowNo + ": content was EDITED after it was written (" + r[2] + " · " + r[1] + " · " + r[0] + ")");
    if (prev && !seen[prev]) problems.push("Row " + rowNo + ": the row written just before it is MISSING (deleted?)");
    if (prev) used[prev] = 1;
    seen[own] = rowNo;
  });
  let last = null;
  try { last = JSON.parse(admProps_().getProperty(SAFE.LOG_LAST_KEY) || "null"); } catch (e) {}
  if (last && last.h && !seen[last.h]) problems.push("The latest log row (" + (last.at || "") + ") is MISSING – rows at the end were deleted.");
  logAction_("LOGS_VERIFIED", "(Logs)", problems.length ? "FAIL" : "OK", problems.length ? problems.slice(0, 20).join("\n") : checked + " rows OK");
  return { ok: !problems.length, total: v.length, checked: checked, old: old, problems: problems.slice(0, 50) };
}

// ---------- Restore points (values before a push) ----------
function restoreTab_() {
  return admLogTab_(SAFE.RESTORE_TAB, ["Time", "Email", "Kind", "Target", "Id", "Data", "Check"]);
}
/** items: [{label, url, body}] – the old values from before the push */
function restorePointSave_(kind, target, items) {
  try {
    const id = Utilities.getUuid().substring(0, 8);
    const data = JSON.stringify(items);
    const cells = [admNow_(), admMe_() || "(unknown)", kind, String(target || ""), id, data];
    const chk = logHash_("restore", cells);
    restoreTab_().appendRow(cells.map(asText_).concat([asText_(chk)]));
    return id;
  } catch (e) { return ""; }
}
function admRestoreRows_(limit) {
  const sh = book_().getSheetByName(SAFE.RESTORE_TAB);
  if (!sh || sh.getLastRow() < 2) return [];
  const n = Math.min(limit, sh.getLastRow() - 1), start = sh.getLastRow() - n + 1;
  return sh.getRange(start, 1, n, 7).getDisplayValues().map((r, i) => ({ row: start + i, r: r })).reverse();
}
function admRestoreList_() {
  return admRestoreRows_(100).map(x => {
    const r = x.r;
    let items = [];
    try { items = JSON.parse(r[5]); } catch (e) {}
    return { time: r[0], email: r[1], kind: r[2], target: r[3], id: r[4], labels: items.map(it => it.label),
             intact: logHash_("restore", r.slice(0, 6)) === r[6] };
  });
}
function adminRestore(id, pass) {
  admRequire_();
  admRecheck_(pass);
  const hit = admRestoreRows_(1000).filter(x => x.r[4] === id)[0];
  if (!hit) throw new Error("Restore point " + id + " not found.");
  const r = hit.r;
  if (logHash_("restore", r.slice(0, 6)) !== r[6]) {
    logAction_("RESTORE", r[3], "BLOCKED", "Restore point " + id + " was edited by hand – not used");
    throw new Error("This restore point was changed by hand after it was saved, so it is NOT safe to use. Nothing was changed.");
  }
  const items = JSON.parse(r[5]);
  if (!items.length || items.some(it => String(it.url || "").indexOf(API) !== 0)) {
    const other = items.some(it => String(it.url || "").indexOf(IM_ENVS[isStage_() ? "PROD" : "STAGE"].host) === 0);
    throw new Error(other ? "Restore point " + id + " belongs to " + (isStage_() ? "PRODUCTION" : "STAGE") + ". Switch the dashboard to " + (isStage_() ? "Production" : "Stage") + " first, then restore it."
                          : "Restore point " + id + " has an unexpected address – not used.");
  }
  const res = UrlFetchApp.fetchAll(items.map(it => patchReq_(it.url, it.body)));
  const lines = items.map((it, k) => {
    const c = res[k].getResponseCode();
    return it.label + ": " + (c === 200 ? "restored ✅" : "FAILED " + c + " " + res[k].getContentText().substring(0, 200));
  });
  const ok = lines.every(l => /restored/.test(l));
  logAction_("RESTORE", r[3], ok ? "OK" : "FAIL", "Restore point " + id + " (" + r[2] + ", saved " + r[0] + " by " + r[1] + ")\n" + lines.join("\n"));
  const d = adminData();
  d.restoreReport = lines.concat(["", "Only Internal Metrics was restored. Sheet changes (backup tab, RECORDED, NodePath sheet) are not undone – use the sheet's Version history for those."]);
  return d;
}

// ---------- Daily backup (copies in a Drive folder) ----------
function backupFolder_() {
  const it = DriveApp.getFoldersByName(SAFE.BACKUP_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(SAFE.BACKUP_FOLDER);
}
/** Run daily by the trigger. Can also be run from the editor. */
function dailyBackup() {
  const tz = Session.getScriptTimeZone() || "Asia/Kolkata";
  const day = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  const root = backupFolder_();
  const name = day + " " + Utilities.formatDate(new Date(), tz, "HHmm");
  const folder = root.createFolder(name);
  const lines = [];
  admFiles_({ noDpp: true }).forEach(f => {
    try {
      const file = DriveApp.getFileById(f.id);
      file.makeCopy(name + " – " + file.getName(), folder);
      lines.push("✅ " + f.name);
    } catch (e) { lines.push("⚠️ " + f.name + ": " + (e.message || e)); }
  });
  // remove old backups
  const cutoff = Utilities.formatDate(new Date(Date.now() - SAFE.BACKUP_KEEP_DAYS * 86400000), tz, "yyyy-MM-dd");
  let removed = 0;
  const subs = root.getFolders();
  while (subs.hasNext()) {
    const s = subs.next();
    const d = (s.getName().match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];
    if (d && d < cutoff) { try { s.setTrashed(true); removed++; } catch (e) {} }
  }
  const ok = !lines.some(l => l.indexOf("⚠️") === 0);
  const info = { at: admNow_(), by: admMe_(), ok: ok, folder: folder.getUrl(), root: root.getUrl(), lines: lines, removed: removed };
  admProps_().setProperty(SAFE.BACKUP_LAST_KEY, JSON.stringify(info));
  logAction_("BACKUP", name, ok ? "OK" : "PARTIAL", lines.join("\n") + (removed ? "\nOld backups removed: " + removed : ""));
  return info;
}
function backupStatus_() {
  let last = null;
  try { last = JSON.parse(admProps_().getProperty(SAFE.BACKUP_LAST_KEY) || "null"); } catch (e) {}
  let scheduled = false;
  try { scheduled = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === "dailyBackup"); } catch (e) {}
  return { last: last, scheduled: scheduled, keepDays: SAFE.BACKUP_KEEP_DAYS, hour: SAFE.BACKUP_HOUR };
}
function adminBackupNow() {
  admRequire_();
  const info = dailyBackup();
  const d = adminData();
  d.backupReport = info;
  return d;
}
function adminBackupSchedule(on) {
  admRequire_();
  // only triggers created by this admin are visible; another admin's trigger keeps running
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "dailyBackup").forEach(t => ScriptApp.deleteTrigger(t));
  if (on) ScriptApp.newTrigger("dailyBackup").timeBased().everyDays(1).atHour(SAFE.BACKUP_HOUR).create();
  logAction_(on ? "BACKUP_SCHEDULE_ON" : "BACKUP_SCHEDULE_OFF", "(daily)", "OK", on ? "Every day around " + SAFE.BACKUP_HOUR + ":00, copies kept " + SAFE.BACKUP_KEEP_DAYS + " days, in " + admMe_() + "'s Drive" : "");
  return adminData();
}

// ---------- safety data (admin panel) ----------
function safetyData_() {
  let standalone = false;
  try { standalone = !SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { standalone = true; }
  return {
    freeze: freezeInfo_(),
    rate: rateCfg_(),
    backup: backupStatus_(),
    standalone: standalone,
    logSecretSet: !!admProps_().getProperty(SAFE.LOG_SECRET_KEY)
  };
}

// ---------- Standalone migration helpers (run from the Apps Script editor) ----------
const MIGRATE_KEYS_RE = /^(AVTOKEN|ADM_)/;
/** Run in the OLD (sheet-bound) project: prints the settings JSON to the Execution log. */
function exportSettingsForMigration() {
  const p = admProps_().getProperties(), out = {};
  Object.keys(p).filter(k => MIGRATE_KEYS_RE.test(k)).forEach(k => out[k] = p[k]);
  Logger.log("Copy everything between the lines (keep it secret – it contains the shared token and password hash):\n-----\n" + JSON.stringify(out) + "\n-----");
  return Object.keys(out).length + " settings exported";
}
/** In the NEW (standalone) project: add a Script Property named IMPORT containing that JSON, then run this. */
function importSettingsFromMigration() {
  const raw = admProps_().getProperty("IMPORT");
  if (!raw) throw new Error('Add a Script Property named IMPORT with the exported JSON first.');
  const obj = JSON.parse(raw);
  const clean = {};
  Object.keys(obj).filter(k => MIGRATE_KEYS_RE.test(k)).forEach(k => clean[k] = String(obj[k]));
  admProps_().setProperties(clean);
  admProps_().deleteProperty("IMPORT");
  Logger.log("Imported " + Object.keys(clean).length + " settings: " + Object.keys(clean).join(", "));
  return Object.keys(clean).length;
}
/** In the NEW project: fetch the link as soon as a code is typed in the Automation tab (like the old onEdit trigger). */
function installStandaloneTriggers() { removeEditTrigger(); }

/** Removes the old onEdit link trigger (links now come from "Click here for links"). */
function removeEditTrigger() {
  let n = 0;
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "onEditInstallable").forEach(t => { ScriptApp.deleteTrigger(t); n++; });
  Logger.log(n ? n + " onEdit trigger(s) removed" : "No onEdit trigger found – nothing to remove");
}

/** Sheets tab: the working files this user may open (same rules as the file sharing). */
function webFiles() {
  const me = admMe_();
  if (!isAllowedUser_(me)) throw new Error("You do not have permission.");
  if (!hasFeature_(me, "sheets")) throw new Error('You do not have access to "Sheets tab". Ask an admin to allow it in Admin → Access.');
  const need = admNeededGroups_(me);
  const label = { book: "Batch OPS", live: "Live sheets", node: "NodePath", dpp: "DPP sheets" };
  return admFiles_().filter(f => need.indexOf(f.group) >= 0).map(f => ({
    group: f.group, groupLabel: label[f.group] || f.group,
    name: f.name.replace(/ \((this sheet|live sheet)\)$/, "")
      .replace(/^DPP (\w+)$/, (m, k) => "DPP – " + ((BACKUP_FILES[k] || {}).name || k))
      .replace(/^NodePath (ENG|HIN)$/, (m, k) => "NodePath – " + (k === "HIN" ? "Hindi" : "English")),
    url: "https://docs.google.com/spreadsheets/d/" + f.id + "/edit"
  }));
}

/** Admin.html (UI of the Admin tab) – loaded by the WebApp page. */
function adminUiHtml() {
  if (!isAdminUser_(admMe_())) throw admNotAdmin_();
  const names = ["Admin", "admin", "ADMIN", "AdminPanel"];
  for (let i = 0; i < names.length; i++) {
    try { return HtmlService.createHtmlOutputFromFile(names[i]).getContent(); } catch (e) {}
  }
  throw new Error('Admin.html file not found. In Apps Script use + → HTML to create a file named "Admin".');
}
