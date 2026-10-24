'use strict';
// Add class: live sheet row below the chapter's last lecture, position shift, Microlecture tab, NodePath rows. Run: node test/addclass.js
const crypto = require('crypto');
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.GOOGLE_SA_JSON = JSON.stringify({ client_email: 'bot@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
process.env.ENC_KEY = crypto.randomBytes(32).toString('base64');
process.env.SESSION_SECRET = crypto.randomBytes(32).toString('hex');

const G = require('./mockgoogle');
G.install();
require('./fixtures').load(G);
const { runJob } = require('../lib/host');
const O = 'vishal26.arivihan@gmail.com';

// Physics Hindi live sheet: 2 chapters, position column, a Microlecture tab
const LIVE = '1rmiMk7f0LqUfGSTgFsoh1YNSe9SfWO_dOXSttb0rAh0';
const date = (d, m) => ({ raw: G.serial(2026, m, d), f: null, disp: String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0') + '/2026' });
const time = (h, mi) => ({ raw: (h * 60 + mi) / 1440, f: null, disp: String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0') + ':00' });
const C = n => '2027NEETPHYHINLIVE' + n;
G.addBook(LIVE, 'Physics Hindi live', {
  Chapters: [
    ['chapter_code', 'title', 'teacher_name', 'live_date', 'live_start_time', 'live_end_time', 'chapter_type', 'chapter_status', 'notes_url', 'chapter_name', 'position'],
    [C(1), 'Kinematics - I', 'Rahul Sir', date(20, 10), time(9, 30), time(11, 0), 'RECORDED_CHAPTER', 'RECORDED', 'https://x/1.pdf', 'Kinematics', 1],
    [C(2), 'Kinematics - II', 'Rahul Sir', date(21, 10), time(9, 30), time(11, 0), 'LIVE', 'LIVE', '', 'Kinematics', 2],
    [C(3), 'Laws of Motion - I', 'Amit Sir', date(22, 10), time(9, 30), time(11, 0), 'LIVE', 'LIVE', '', 'Laws of Motion', 3],
    [C(4), 'Laws of Motion - II', 'Amit Sir', date(23, 10), time(9, 30), time(11, 0), 'LIVE', 'LIVE', '', 'Laws of Motion', 4]
  ],
  [C(2) + 'Microlecture']: [['micro_lecture_code', 'video_end_position'], [C(2) + 'ML1', 500]]
});

// NodePath Hindi: PHY tab with the 3 rows of every lecture
const NP = '1SVn0hqNGDuESuSGZ_J7GAjGNOQ0dpTon5CM6DPxxTM0';
const npRows = [['node_id', 'subject', 'task_type', 'chapter_code', 'subtitle', 'microlecture_code', 'pdf_url', 'pdf_title', 'locked', 'test_series_id', 'test_category_id', 'node_click_type', 'position']];
let id = 1001;
[1, 2, 3, 4].forEach(n => {
  const done = n === 1, t = ['Kinematics - I', 'Kinematics - II', 'Laws of Motion - I', 'Laws of Motion - II'][n - 1];
  npRows.push([String(id++), 'PHYSICS', done ? 'VIDEO_LECTURE' : 'LIVE_LECTURE', C(n), t, done ? C(n) + 'ML1' : '', '', '', '', '', '', 'SINGLE', '']);
  npRows.push([String(id++), 'PHYSICS', 'LIVE_CLASS_NOTES', C(n), t, '', done ? 'https://x/1.pdf' : '', t + '.pdf', done ? 'NO' : 'YES', '', '', 'SINGLE', '']);
  npRows.push([String(id++), 'PHYSICS', 'DAILY_PRACTICE_PROBLEMS', C(n), t, '', '', '', done ? 'NO' : 'YES', done ? C(n) + 'DPP' : '', done ? '5' : '', 'LIST', '']);
});
// + a backup copy of the PATH tab (made by another tool): must never be picked, read or changed
const BK = '_bk_20261024T104330-b17f_PHY PATH';
G.addBook(NP, 'NodePath HIN', { 'PHY PATH': npRows, [BK]: npRows.map(r => r.slice()) });

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 500)); } };
const call = (fn, args) => runJob({ fn, args, user: O }).then(JSON.parse);
const grid = (book, tab) => G.BOOKS[book].sheets.find(s => s.title === tab).grid.map(r => r.map(c => (c && c.raw !== undefined ? c.raw : '')));

(async () => {
  const pv = await call('webPreview', ['PHYSICS_HIN', true]);
  ok('nodepath check: backup tab ignored', pv.sheet === 'PHY PATH', pv);

  // Google read quota (429) twice: the server waits and the check still finishes
  const realFetch = global.fetch;
  let busy = 2;
  global.fetch = (url, o) => (busy > 0 && /PHY%20PATH/.test(String(url)) && busy--)
    ? Promise.resolve(new Response('{"error":{"message":"Quota exceeded"}}', { status: 429, headers: { 'retry-after': '1' } }))
    : realFetch(url, o);
  const pq = await call('webPreview', ['PHYSICS_HIN', true]);
  global.fetch = realFetch;
  ok('nodepath check: waits out the read quota (429)', busy === 0 && pq.sheet === 'PHY PATH', pq);

  const info = await call('webAddClassInfo', ['PHYHIN']);
  const kin = info.chapters.find(c => c.name === 'Kinematics');
  ok('info: chapters in row order', info.chapters.map(c => c.name).join('|') === 'Kinematics|Laws of Motion', info.chapters);
  ok('info: next code + next title', info.nextCode === C(5) && kin.nextTitle === 'Kinematics - III' && kin.lastRow === 3, { code: info.nextCode, kin });
  ok('info: teachers / default status', info.teachers.indexOf('Rahul Sir') >= 0 && info.defStatus === 'LIVE', info);

  const form = { code: C(5), title: 'Kinematics - III', teacher: 'Rahul Sir', date: '2026-10-24', start: '09:30', end: '11:00',
                 type: 'LIVE', status: 'LIVE', chapter: kin.id, afterCode: kin.lastCode };
  let err = '';
  try { await call('webAddClassPlan', ['PHYHIN', Object.assign({}, form, { code: C(3) })]); } catch (e) { err = e.message; }
  ok('plan: existing code is blocked', /already exists/.test(err), err);
  const plan = await call('webAddClassPlan', ['PHYHIN', form]);
  ok('plan: row 4 below Kinematics - II', plan.newRow === 4 && /new row 4/.test(plan.lines[0]), plan.lines);

  const r = await call('webAddClass', ['PHYHIN', form]);
  ok('add: all steps OK', r.ok && r.row === 4, r.steps);
  const ch = grid(LIVE, 'Chapters');
  ok('chapters: new row at 4, chapter_name copied', ch[3][0] === C(5) && ch[3][1] === 'Kinematics - III' && ch[3][9] === 'Kinematics', ch[3]);
  ok('chapters: rows below moved down', ch[4][0] === C(3) && ch[5][0] === C(4), ch.map(x => x[0]));
  ok('chapters: position sequence 1..5', ch.slice(1, 6).map(x => Number(x[10])).join(',') === '1,2,3,4,5', ch.map(x => x[10]));
  ok('chapters: no formula in the new row', G.BOOKS[LIVE].sheets[0].grid[3].every(c => !c || !c.f));
  const mt = G.BOOKS[LIVE].sheets.find(s => s.title === C(5) + 'Microlecture');
  ok('microlecture tab created with the new code, old data cleared', !!mt && mt.grid[1][0].raw === C(5) + 'ML1' && !(mt.grid[1][1] && mt.grid[1][1].raw), mt && mt.grid);
  const np = grid(NP, 'PHY PATH');
  const codes = np.slice(1).map(x => x[3]);
  const at = codes.indexOf(C(5));
  ok('nodepath: 3 new rows right after Kinematics - II', at === 6 && codes.slice(6, 9).every(c => c === C(5)) && codes[9] === C(3), codes);
  ok('nodepath: node_id renumbered 1001..1015', np.slice(1).map(x => Number(x[0])).join(',') === Array.from({ length: 15 }, (_, i) => 1001 + i).join(','), np.map(x => x[0]));
  ok('log: ADD_CLASS written', G.LOG.some(l => /Logs/.test(l) && /append/.test(l)));

  err = '';
  try { await call('webAddClass', ['PHYHIN', form]); } catch (e) { err = e.message; }
  ok('second add with the same code is blocked', /already exists/.test(err), err);

  // ---------- Undo ----------
  const recent = await call('webAddClassRecent', []);
  ok('undo: class is in the recent list', recent[0] && recent[0].code === C(5) && recent[0].micro && recent[0].posStep === 1, recent);
  const up = await call('webAddClassUndoPlan', [C(5)]);
  ok('undo plan: allowed, 4 steps', !up.blocks.length && up.lines.length === 4, up);
  const u = await call('webAddClassUndo', [C(5)]);
  ok('undo: all steps OK', u.ok, u.steps);
  const ch2 = grid(LIVE, 'Chapters');
  ok('undo: chapters back to 4 lectures', ch2.slice(1).map(x => x[0]).join(',') === [1, 2, 3, 4].map(C).join(','), ch2.map(x => x[0]));
  ok('undo: position back to 1..4', ch2.slice(1, 5).map(x => Number(x[10])).join(',') === '1,2,3,4', ch2.map(x => x[10]));
  ok('undo: microlecture tab deleted, old one kept', !G.BOOKS[LIVE].sheets.some(s => s.title === C(5) + 'Microlecture') && G.BOOKS[LIVE].sheets.some(s => s.title === C(2) + 'Microlecture'));
  const np2 = grid(NP, 'PHY PATH').slice(1);
  ok('undo: nodepath rows gone, 12 rows renumbered', np2.length === 12 && !np2.some(x => x[3] === C(5)) && np2.map(x => Number(x[0])).join(',') === Array.from({ length: 12 }, (_, i) => 1001 + i).join(','), np2.map(x => x[0] + ' ' + x[3]));
  err = '';
  try { await call('webAddClassUndo', [C(5)]); } catch (e) { err = e.message; }
  ok('undo twice is blocked', /already undone/.test(err), err);

  // undo is blocked once the class was pushed
  const r2 = await call('webAddClass', ['PHYHIN', Object.assign({}, form, { code: C(6), afterCode: C(2) })]);
  ok('add again (LIVE6)', r2.ok, r2.steps);
  G.BOOKS['191KXHslzMCz22dBD3XW5cKEqP1pmGZsbmcPgGIf_fNY'].sheets.find(s => s.title === 'Logs').grid
    .push(['24/10/2026 10:00:00', O, 'PUSH_DASHBOARD', C(6) + 'ML1', 'OK'].map(v => ({ raw: v, f: null, disp: v })));
  const up2 = await call('webAddClassUndoPlan', [C(6)]);
  ok('undo blocked after a push', up2.blocks.length === 1 && /pushed/.test(up2.blocks[0]), up2.blocks);
  ok('backup tab never changed', JSON.stringify(grid(NP, BK)) === JSON.stringify(npRows), grid(NP, BK).map(x => x[0] + ' ' + x[3]));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
