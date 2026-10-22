'use strict';
// Small test copies of the real sheets (structure only, made-up values).
function istToday() {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = t => +p.find(x => x.type === t).value;
  return { y: g('year'), m: g('month'), d: g('day') };
}
function load(G) {
  const T = istToday();
  const S = G.serial(T.y, T.m, T.d);
  const dd = String(T.d).padStart(2, '0') + '/' + String(T.m).padStart(2, '0') + '/' + T.y;
  const date = { raw: S, f: null, disp: dd };
  const time = (h, m) => ({ raw: (h * 60 + m) / 1440, f: null, disp: String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00' });

  const auto = Array.from({ length: 14 }, () => Array.from({ length: 20 }, () => ''));
  auto[3][2] = '2027NEETPHYENGLIVE31';            // C4
  auto[6][2] = '2027NEETPHYENGLIVE31ML1';         // C7
  auto[6][18] = 'https://cdn.example.com/notes/2027NEETPHYENGLIVE31ML1.pdf';   // S7
  G.addBook('191KXHslzMCz22dBD3XW5cKEqP1pmGZsbmcPgGIf_fNY', 'Batch OPS', { Automation: auto });

  const live = {
    PHYENG: ['1Qr8K0RNrtN2XvjchqwxwTyKpA3XenexC4n37xehS1zc', 'Physics English', 'PHYENG'],
    PHYHIN: ['1rmiMk7f0LqUfGSTgFsoh1YNSe9SfWO_dOXSttb0rAh0', 'Physics Hindi', 'PHYHIN'],
    CHEENG: ['1Fp9Oq2y7885WMDVqdysNiFQjEur57hmxm1vT8sOe5RM', 'Chemistry English', 'CHEENG'],
    CHEHIN: ['1f4_STBtJOYa-pPLZzzPBGxhT9omLhruqVsNO_KZaH0Y', 'Chemistry Hindi', 'CHEHIN'],
    BIOENG: ['13zmhMUyRgnBmgrxvvo35JWUYMCQwqJ1gqXd73-Eu36s', 'Biology English', 'BIOENG'],
    BIOHIN: ['1CfQfP0Q_NGvqdhihsjFFqTnzbzold9Q5x-QLsIXKH7o', 'Biology Hindi', 'BIOHIN']
  };
  Object.keys(live).forEach((k, i) => {
    const [id, name] = live[k];
    const code = '2027NEET' + k.slice(0, 3) + k.slice(3) + 'LIVE' + (30 + i);
    G.addBook(id, name + ' live', {
      Chapters: [
        ['chapter_code', 'title', 'teacher_name', 'live_date', 'live_start_time', 'live_end_time', 'chapter_type', 'chapter_status', 'notes_url'],
        [code, 'Test chapter ' + (i + 1), 'Teacher ' + (i + 1), date, time(9 + i, 30), time(11 + i, 0), 'LIVE', i === 0 ? 'RECORDED' : 'LIVE', i === 0 ? 'https://cdn.example.com/x.pdf' : ''],
        ['2027NEET' + k + 'LIVE99', 'Old chapter', 'Teacher', { raw: S - 20, f: null, disp: 'old' }, time(9, 0), time(10, 0), 'LIVE', 'RECORDED', '']
      ]
    });
  });

  G.addBook('1RtooDZMOtShNv0hEvbcnP7SMXasFD0A6DiD9aaNFLdc', '2027_NEET_PHYSICS_HIN_DPP', {
    InfoHindi: [
      ['id', 'name', 'position', 'live_date', 'live_start_time', 'live_end_time', 'update'],
      ['D1', 'Kinematics - I', 1, date, time(9, 30), time(11, 0), 'No'],
      ['D2', 'Kinematics - II', 2, date, time(12, 0), time(13, 30), 'Yes'],
      ['D3', 'Laws of Motion - I', 3, { raw: S + 3, f: null, disp: 'x' }, time(9, 30), time(11, 0), 'No']
    ],
    'Kinematics - I': [['question', 'a', 'b', 'answer'], ['Q1?', '1', '2', 'a']],
    'Kinematics - II': [['question', 'a', 'b', 'answer'], ['Q1 hindi?', '3', '4', 'b'], ['=1+1', 5, 6, 'a']],
    'Laws of Motion - I': [['question', 'a', 'b', 'answer'], ['Q?', '1', '2', 'a']]
  });
}
module.exports = { load, istToday };
