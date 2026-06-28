const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const SCORING = { direction:3, exact:5, qualify:6, r32:6, r16:8, qf:10, sf:12, third:14, final:14, champion:18, topScorer:12 };

const TEAM_MAP = {
  'Mexico':'מקסיקו','South Africa':'דרום אפריקה','South Korea':'קוריאה הדרומית',
  'Czech Republic':"צ'כיה",'Czechia':"צ'כיה",
  'Canada':'קנדה','Bosnia and Herzegovina':'בוסניה','Bosnia & Herzegovina':'בוסניה','Qatar':'קטר','Switzerland':'שוויץ',
  'Brazil':'ברזיל','Morocco':'מרוקו','Haiti':'האיטי','Scotland':'סקוטלנד',
  'United States':'ארהב','USA':'ארהב',
  'Paraguay':'פרגוואי','Australia':'אוסטרליה','Turkey':'טורקיה','Türkiye':'טורקיה','Turkiye':'טורקיה',
  'Germany':'גרמניה','Curaçao':'קוראסאו','Curacao':'קוראסאו',
  "Côte d'Ivoire":'חוף השנהב',"Cote d'Ivoire":'חוף השנהב','Ivory Coast':'חוף השנהב',
  'Ecuador':'אקוודור',
  'Netherlands':'הולנד','Japan':'יפן','Sweden':'שוודיה','Tunisia':'תוניסיה',
  'Belgium':'בלגיה','Egypt':'מצרים','Iran':'איראן','New Zealand':'ניו זילנד',
  'Spain':'ספרד','Cabo Verde':'קאבו ורדה','Cape Verde':'קאבו ורדה','Saudi Arabia':'סעודיה','Uruguay':'אורוגוואי',
  'France':'צרפת','Senegal':'סנגל','Iraq':'עיראק','Norway':'נורווגיה',
  'Argentina':'ארגנטינה','Algeria':"אלג'יריה",'Austria':'אוסטריה','Jordan':'ירדן',
  'Portugal':'פורטוגל','DR Congo':'קונגו','Congo DR':'קונגו','DRC':'קונגו',
  'Uzbekistan':'אוזבקיסטן','Colombia':'קולומביה',
  'England':'אנגליה','Croatia':'קרואטיה','Ghana':'גאנה','Panama':'פנמה',
};

const mapTeam = n => TEAM_MAP[n] || n;

const TEAM_PAIR_TO_MATCH_ID = {
  // Exact openfootball names (matchday 1)
  'Mexico-South Africa':'A1',
  'South Korea-Czech Republic':'A2','South Korea-Czechia':'A2',
  'Mexico-South Korea':'A3',
  'Czech Republic-South Africa':'A4','Czechia-South Africa':'A4',
  'Czechia-Mexico':'A5','Czech Republic-Mexico':'A5',
  'South Africa-South Korea':'A6',
  'Canada-Bosnia & Herzegovina':'B1','Canada-Bosnia and Herzegovina':'B1',
  'Qatar-Switzerland':'B2',
  'Canada-Qatar':'B3',
  'Switzerland-Bosnia & Herzegovina':'B4','Switzerland-Bosnia and Herzegovina':'B4',
  'Switzerland-Canada':'B5',
  'Bosnia & Herzegovina-Qatar':'B6','Bosnia and Herzegovina-Qatar':'B6',
  'Brazil-Morocco':'C1',
  'Haiti-Scotland':'C2',
  'Brazil-Scotland':'C3',
  'Morocco-Haiti':'C4',
  'Morocco-Scotland':'C5',
  'Haiti-Brazil':'C6',
  'USA-Paraguay':'D1','United States-Paraguay':'D1',
  'Australia-Turkey':'D2','Australia-Türkiye':'D2',
  'USA-Australia':'D3','United States-Australia':'D3',
  'Paraguay-Turkey':'D4','Paraguay-Türkiye':'D4',
  'Turkey-USA':'D5','Türkiye-USA':'D5','Turkey-United States':'D5',
  'Australia-Paraguay':'D6',
  'Germany-Curaçao':'E1','Germany-Curacao':'E1',
  'Ivory Coast-Ecuador':'E2',"Côte d'Ivoire-Ecuador":'E2',"Cote d'Ivoire-Ecuador":'E2',
  "Germany-Ivory Coast":'E3',"Germany-Côte d'Ivoire":'E3',
  'Ecuador-Curaçao':'E4','Ecuador-Curacao':'E4',
  'Ecuador-Germany':'E5',
  "Curaçao-Ivory Coast":'E6',"Curacao-Ivory Coast":'E6',"Curaçao-Côte d'Ivoire":'E6',
  'Netherlands-Japan':'F1',
  'Sweden-Tunisia':'F2',
  'Netherlands-Sweden':'F3',
  'Japan-Tunisia':'F4',
  'Japan-Sweden':'F5',
  'Tunisia-Netherlands':'F6',
  'Belgium-Egypt':'G1',
  'Iran-New Zealand':'G2',
  'Belgium-Iran':'G3',
  'Egypt-New Zealand':'G4',
  'Egypt-Iran':'G5',
  'New Zealand-Belgium':'G6',
  'Spain-Cape Verde':'H1','Spain-Cabo Verde':'H1',
  'Saudi Arabia-Uruguay':'H2',
  'Spain-Saudi Arabia':'H3',
  'Uruguay-Cape Verde':'H4','Uruguay-Cabo Verde':'H4',
  'Uruguay-Spain':'H5',
  'Cape Verde-Saudi Arabia':'H6','Cabo Verde-Saudi Arabia':'H6',
  'France-Senegal':'I1',
  'Iraq-Norway':'I2',
  'France-Iraq':'I3',
  'Norway-Senegal':'I4',
  'Norway-France':'I5',
  'Senegal-Iraq':'I6',
  'Argentina-Algeria':'J1',
  'Austria-Jordan':'J2',
  'Argentina-Austria':'J3',
  'Jordan-Algeria':'J4',
  'Jordan-Argentina':'J5',
  'Algeria-Austria':'J6',
  'Portugal-DR Congo':'K1','Portugal-Congo DR':'K1',
  'Uzbekistan-Colombia':'K2',
  'Portugal-Uzbekistan':'K3',
  'Colombia-DR Congo':'K4','Colombia-Congo DR':'K4',
  'Colombia-Portugal':'K5',
  'DR Congo-Uzbekistan':'K6','Congo DR-Uzbekistan':'K6',
  'England-Croatia':'L1',
  'Ghana-Panama':'L2',
  'England-Ghana':'L3',
  'Panama-Croatia':'L4',
  'Panama-England':'L5',
  'Croatia-Ghana':'L6',
};

// --- Orientation fix ---------------------------------------------------------
// The prediction form (frontend MATCHES) defines a canonical home/away order per
// matchId. Predictions are stored {h,a} against that order. openfootball sometimes
// lists a match in the reverse order, which previously caused the match to be
// dropped (undercount) or its h/a to be compared swapped. We build an
// orientation-independent index and normalise every score back to the form's order.
// mapTeam() collapses name aliases (e.g. Czechia/Czech Republic) to one identity.
const PAIR_INDEX = {}; // "teamX|teamY" (sorted) -> matchId
const MATCH_HOME = {}; // matchId -> canonical home identity
(function buildPairIndex() {
  for (const [pair, id] of Object.entries(TEAM_PAIR_TO_MATCH_ID)) {
    const i = pair.indexOf('-'); // no team name contains '-'
    const homeId = mapTeam(pair.slice(0, i));
    const awayId = mapTeam(pair.slice(i + 1));
    PAIR_INDEX[[homeId, awayId].sort().join('|')] = id;
    MATCH_HOME[id] = homeId; // all aliases for an id share home-first orientation
  }
})();

// Given two team names + score, return { id, h, a } oriented to the form's order,
// or null if the pair isn't a known group match.
function orientScore(homeName, awayName, h, a) {
  const homeId = mapTeam(homeName);
  const awayId = mapTeam(awayName);
  const id = PAIR_INDEX[[homeId, awayId].sort().join('|')];
  if (!id) return null;
  return homeId === MATCH_HOME[id] ? { id, h, a } : { id, h: a, a: h };
}

async function fetchResults() {
  // Try openfootball first
  try {
    const res = await fetch('https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json');
    if (!res.ok) throw new Error('openfootball error');
    const data = await res.json();
    return { source: 'openfootball', data };
  } catch(e) {
    console.error('openfootball failed:', e.message);
  }
  // Try worldcup26.ir as backup
  try {
    const res = await fetch('https://worldcup26.ir/get/games');
    if (!res.ok) throw new Error('worldcup26 error');
    const data = await res.json();
    return { source: 'worldcup26', data: data.games || data };
  } catch(e) {
    console.error('worldcup26 failed:', e.message);
  }
  return null;
}

function parseOpenfootball(data) {
  const groupScores = {};
  const koWinners = { r32:[],r16:[],qf:[],sf:[],third:null,champion:null };
  const qualifiers = new Set(); // actual teams that reached the R32 (bare Hebrew)
  if (!data || !data.matches) return { groupScores, koWinners, qualifiers };
  
  data.matches.forEach(m => {
    const round = (m.round || '').toLowerCase();
    if (round.includes('round of 32') || round.includes('r32')) {
      if (m.team1) qualifiers.add(mapTeam(m.team1));
      if (m.team2) qualifiers.add(mapTeam(m.team2));
    }
    if (!m.score || !m.score.ft) return;
    const h = m.score.ft[0], a = m.score.ft[1];
    if (h === null || h === undefined || a === null || a === undefined) return;
    
    const t1 = m.team1, t2 = m.team2;

    const oriented = orientScore(t1, t2, h, a);
    if (oriented) {
      groupScores[oriented.id] = { h: oriented.h, a: oriented.a };
    }

    const winner = h > a ? mapTeam(t1) : mapTeam(t2);
    if (round.includes('round of 32') || round.includes('r32')) koWinners.r32.push(winner);
    else if (round.includes('round of 16') || round.includes('r16')) koWinners.r16.push(winner);
    else if (round.includes('quarter')) koWinners.qf.push(winner);
    else if (round.includes('semi')) koWinners.sf.push(winner);
    else if (round.includes('third') || round.includes('3rd')) koWinners.third = winner;
    else if (round.includes('final') && !round.includes('semi') && !round.includes('third') && !round.includes('3rd')) koWinners.champion = winner;
  });
  
  return { groupScores, koWinners, qualifiers };
}

function parseWorldcup26(games) {
  const groupScores = {};
  const koWinners = { r32:[],r16:[],qf:[],sf:[],third:null,champion:null };
  const qualifiers = new Set();
  if (!games || !Array.isArray(games)) return { groupScores, koWinners, qualifiers };
  
  games.forEach(match => {
    const homeEn0 = match.home_team_name_en || '';
    const awayEn0 = match.away_team_name_en || '';
    if ((match.type || '').toLowerCase() === 'round_of_32') {
      if (homeEn0) qualifiers.add(mapTeam(homeEn0));
      if (awayEn0) qualifiers.add(mapTeam(awayEn0));
    }
    const finished = match.finished === 'TRUE' || match.finished === true || match.time_elapsed === 'finished';
    if (!finished) return;
    const h = parseInt(match.home_score), a = parseInt(match.away_score);
    if (isNaN(h) || isNaN(a)) return;
    
    const homeEn = match.home_team_name_en || '';
    const awayEn = match.away_team_name_en || '';
    const type = (match.type || '').toLowerCase();
    const homeTeam = mapTeam(homeEn), awayTeam = mapTeam(awayEn);
    const winner = h > a ? homeTeam : awayTeam;

    if (type === 'group') {
      const oriented = orientScore(homeEn, awayEn, h, a);
      if (oriented) groupScores[oriented.id] = { h: oriented.h, a: oriented.a };
    }
    if (type === 'round_of_32') koWinners.r32.push(winner);
    else if (type === 'round_of_16') koWinners.r16.push(winner);
    else if (type === 'quarter_final') koWinners.qf.push(winner);
    else if (type === 'semi_final') koWinners.sf.push(winner);
    else if (type === 'third_place') koWinners.third = winner;
    else if (type === 'final') koWinners.champion = winner;
  });
  
  return { groupScores, koWinners, qualifiers };
}

// --- R32 qualifier scoring -------------------------------------------------
// Award SCORING.qualify per team a player correctly predicted to reach the R32.
// Predicted qualifiers are recomputed from each player's group-score predictions
// using the SAME standings logic as the frontend (pts -> goal diff -> goals for,
// top 2 per group + 8 best thirds assigned to slots by allowed groups).
// Actual qualifiers come from the real bracket (openfootball R32 fixtures).
const GROUP_DEF = {"A":["מקסיקו","דרום אפריקה","קוריאה הדרומית","צ'כיה"],"B":["קנדה","בוסניה","קטר","שוויץ"],"C":["ברזיל","מרוקו","האיטי","סקוטלנד"],"D":["ארהב","פרגוואי","אוסטרליה","טורקיה"],"E":["גרמניה","קוראסאו","חוף השנהב","אקוודור"],"F":["הולנד","יפן","שוודיה","תוניסיה"],"G":["בלגיה","מצרים","איראן","ניו זילנד"],"H":["ספרד","קאבו ורדה","סעודיה","אורוגוואי"],"I":["צרפת","סנגל","עיראק","נורווגיה"],"J":["ארגנטינה","אלג'יריה","אוסטריה","ירדן"],"K":["פורטוגל","קונגו","אוזבקיסטן","קולומביה"],"L":["אנגליה","קרואטיה","גאנה","פנמה"]};
const MATCH_LIST = [{"id":"A1","h":"מקסיקו","a":"דרום אפריקה","g":"A"},{"id":"A2","h":"קוריאה הדרומית","a":"צ'כיה","g":"A"},{"id":"A3","h":"מקסיקו","a":"קוריאה הדרומית","g":"A"},{"id":"A4","h":"צ'כיה","a":"דרום אפריקה","g":"A"},{"id":"A5","h":"צ'כיה","a":"מקסיקו","g":"A"},{"id":"A6","h":"דרום אפריקה","a":"קוריאה הדרומית","g":"A"},{"id":"B1","h":"קנדה","a":"בוסניה","g":"B"},{"id":"B2","h":"קטר","a":"שוויץ","g":"B"},{"id":"B3","h":"קנדה","a":"קטר","g":"B"},{"id":"B4","h":"שוויץ","a":"בוסניה","g":"B"},{"id":"B5","h":"שוויץ","a":"קנדה","g":"B"},{"id":"B6","h":"בוסניה","a":"קטר","g":"B"},{"id":"C1","h":"ברזיל","a":"מרוקו","g":"C"},{"id":"C2","h":"האיטי","a":"סקוטלנד","g":"C"},{"id":"C3","h":"ברזיל","a":"סקוטלנד","g":"C"},{"id":"C4","h":"מרוקו","a":"האיטי","g":"C"},{"id":"C5","h":"מרוקו","a":"סקוטלנד","g":"C"},{"id":"C6","h":"האיטי","a":"ברזיל","g":"C"},{"id":"D1","h":"ארהב","a":"פרגוואי","g":"D"},{"id":"D2","h":"אוסטרליה","a":"טורקיה","g":"D"},{"id":"D3","h":"ארהב","a":"אוסטרליה","g":"D"},{"id":"D4","h":"פרגוואי","a":"טורקיה","g":"D"},{"id":"D5","h":"טורקיה","a":"ארהב","g":"D"},{"id":"D6","h":"אוסטרליה","a":"פרגוואי","g":"D"},{"id":"E1","h":"גרמניה","a":"קוראסאו","g":"E"},{"id":"E2","h":"חוף השנהב","a":"אקוודור","g":"E"},{"id":"E3","h":"גרמניה","a":"חוף השנהב","g":"E"},{"id":"E4","h":"אקוודור","a":"קוראסאו","g":"E"},{"id":"E5","h":"אקוודור","a":"גרמניה","g":"E"},{"id":"E6","h":"קוראסאו","a":"חוף השנהב","g":"E"},{"id":"F1","h":"הולנד","a":"יפן","g":"F"},{"id":"F2","h":"שוודיה","a":"תוניסיה","g":"F"},{"id":"F3","h":"הולנד","a":"שוודיה","g":"F"},{"id":"F4","h":"יפן","a":"תוניסיה","g":"F"},{"id":"F5","h":"יפן","a":"שוודיה","g":"F"},{"id":"F6","h":"תוניסיה","a":"הולנד","g":"F"},{"id":"G1","h":"בלגיה","a":"מצרים","g":"G"},{"id":"G2","h":"איראן","a":"ניו זילנד","g":"G"},{"id":"G3","h":"בלגיה","a":"איראן","g":"G"},{"id":"G4","h":"מצרים","a":"ניו זילנד","g":"G"},{"id":"G5","h":"מצרים","a":"איראן","g":"G"},{"id":"G6","h":"ניו זילנד","a":"בלגיה","g":"G"},{"id":"H1","h":"ספרד","a":"קאבו ורדה","g":"H"},{"id":"H2","h":"סעודיה","a":"אורוגוואי","g":"H"},{"id":"H3","h":"ספרד","a":"סעודיה","g":"H"},{"id":"H4","h":"אורוגוואי","a":"קאבו ורדה","g":"H"},{"id":"H5","h":"אורוגוואי","a":"ספרד","g":"H"},{"id":"H6","h":"קאבו ורדה","a":"סעודיה","g":"H"},{"id":"I1","h":"צרפת","a":"סנגל","g":"I"},{"id":"I2","h":"עיראק","a":"נורווגיה","g":"I"},{"id":"I3","h":"צרפת","a":"עיראק","g":"I"},{"id":"I4","h":"נורווגיה","a":"סנגל","g":"I"},{"id":"I5","h":"נורווגיה","a":"צרפת","g":"I"},{"id":"I6","h":"סנגל","a":"עיראק","g":"I"},{"id":"J1","h":"ארגנטינה","a":"אלג'יריה","g":"J"},{"id":"J2","h":"אוסטריה","a":"ירדן","g":"J"},{"id":"J3","h":"ארגנטינה","a":"אוסטריה","g":"J"},{"id":"J4","h":"ירדן","a":"אלג'יריה","g":"J"},{"id":"J5","h":"ירדן","a":"ארגנטינה","g":"J"},{"id":"J6","h":"אלג'יריה","a":"אוסטריה","g":"J"},{"id":"K1","h":"פורטוגל","a":"קונגו","g":"K"},{"id":"K2","h":"אוזבקיסטן","a":"קולומביה","g":"K"},{"id":"K3","h":"פורטוגל","a":"אוזבקיסטן","g":"K"},{"id":"K4","h":"קולומביה","a":"קונגו","g":"K"},{"id":"K5","h":"קולומביה","a":"פורטוגל","g":"K"},{"id":"K6","h":"קונגו","a":"אוזבקיסטן","g":"K"},{"id":"L1","h":"אנגליה","a":"קרואטיה","g":"L"},{"id":"L2","h":"גאנה","a":"פנמה","g":"L"},{"id":"L3","h":"אנגליה","a":"גאנה","g":"L"},{"id":"L4","h":"פנמה","a":"קרואטיה","g":"L"},{"id":"L5","h":"פנמה","a":"אנגליה","g":"L"},{"id":"L6","h":"קרואטיה","a":"גאנה","g":"L"}];
const THIRD_SLOTS = [{"gs":["A","B","C","D","F"]},{"gs":["C","D","F","G","H"]},{"gs":["C","E","F","H","I"]},{"gs":["E","H","I","J","K"]},{"gs":["B","E","F","I","J"]},{"gs":["A","E","H","I","J"]},{"gs":["E","F","G","I","J"]},{"gs":["D","E","I","J","L"]}];
const GROUP_LETTERS = Object.keys(GROUP_DEF);
const TEAM_GROUP = {};
for (const g of GROUP_LETTERS) for (const t of GROUP_DEF[g]) TEAM_GROUP[t] = g;

function computeStandings(scores) {
  const standings = {};
  for (const g of GROUP_LETTERS) {
    const teams = GROUP_DEF[g];
    const pts = {}, gd = {}, gf = {};
    teams.forEach(t => { pts[t] = 0; gd[t] = 0; gf[t] = 0; });
    MATCH_LIST.filter(m => m.g === g).forEach(m => {
      const s = scores && scores[m.id];
      if (!s || s.h == null || s.a == null) return;
      const h = s.h, a = s.a;
      if (h > a) pts[m.h] += 3; else if (h < a) pts[m.a] += 3; else { pts[m.h]++; pts[m.a]++; }
      gd[m.h] += (h - a); gd[m.a] += (a - h); gf[m.h] += h; gf[m.a] += a;
    });
    const sorted = [...teams].sort((x, y) => (pts[y]-pts[x]) || (gd[y]-gd[x]) || (gf[y]-gf[x]));
    standings[g] = {};
    sorted.forEach((t, i) => { standings[g][i+1] = t; standings[g][t] = { pts: pts[t], gd: gd[t], gf: gf[t] }; });
  }
  return standings;
}

function bestThirds(standings) {
  const thirds = [];
  for (const g of GROUP_LETTERS) {
    const t = standings[g][3];
    if (t) thirds.push({ team: t, pts: standings[g][t].pts, gd: standings[g][t].gd, gf: standings[g][t].gf });
  }
  thirds.sort((a, b) => (b.pts-a.pts) || (b.gd-a.gd) || (b.gf-a.gf));
  return thirds;
}

// Set of teams (bare Hebrew) predicted to reach the R32, from a player's scores.
function predictedQualifiers(scores) {
  const standings = computeStandings(scores);
  const q = new Set();
  for (const g of GROUP_LETTERS) {
    if (standings[g][1]) q.add(standings[g][1]);
    if (standings[g][2]) q.add(standings[g][2]);
  }
  const thirds = bestThirds(standings);
  const used = new Set();
  THIRD_SLOTS.forEach(slot => {
    const best = thirds.find(t => slot.gs.includes(TEAM_GROUP[t.team]) && !used.has(t.team));
    if (best) { used.add(best.team); q.add(best.team); }
  });
  return q;
}

function calcPoints(sub, groupScores, koWinners, qualifiers) {
  let pts = 0;
  Object.keys(groupScores).forEach(id => {
    const actual = groupScores[id], pred = sub.scores?.[id];
    if (!pred) return;
    if (pred.h === actual.h && pred.a === actual.a) pts += SCORING.exact;
    else {
      const ad = actual.h > actual.a ? 1 : actual.h < actual.a ? -1 : 0;
      const pd = pred.h > pred.a ? 1 : pred.h < pred.a ? -1 : 0;
      if (ad === pd) pts += SCORING.direction;
    }
  });
  // R32 qualifiers: 6 points per team correctly predicted to reach the R32
  if (qualifiers && qualifiers.size) {
    const predicted = predictedQualifiers(sub.scores);
    predicted.forEach(team => { if (qualifiers.has(team)) pts += SCORING.qualify; });
  }
  [{key:'r32',pts:SCORING.r32},{key:'r16',pts:SCORING.r16},{key:'qf',pts:SCORING.qf},{key:'sf',pts:SCORING.sf}]
    .forEach(({key,pts:rPts}) => {
      const actual = koWinners[key] || [];
      Object.values(sub.ko || {}).forEach(m => { if (m?.winner && actual.includes(m.winner)) pts += rPts; });
    });
  if (koWinners.third && sub.ko?.['m103']?.winner === koWinners.third) pts += SCORING.third;
  if (koWinners.champion && sub.ko?.['m104']?.winner === koWinners.champion) pts += SCORING.final;
  if (sub.scorerAwarded) pts += SCORING.topScorer;
  return pts;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    try {
      const { adminKey, scorerName, action } = req.body || {};
      if (adminKey !== (process.env.ADMIN_KEY || 'wc2026admin')) return res.status(401).json({ error: 'Unauthorized' });
      let list = await redis.get('submissions') || [];
      if (action === 'awardScorer' && scorerName) {
        const norm = scorerName.toLowerCase().trim();
        list = list.map(s => {
          const guess = (s.topScorer || '').toLowerCase().trim();
          if (guess && (guess.includes(norm) || norm.includes(guess)) && !s.scorerAwarded) {
            s.pts = (s.pts || 0) + SCORING.topScorer;
            s.scorerAwarded = true;
          }
          return s;
        });
        await redis.set('submissions', list);
      }

      // Manual score overrides: { matchId: 'A5', h: 0, a: 3 }
      if (action === 'setScore') {
        const { matchId, h, a } = req.body || {};
        if (!matchId || h == null || a == null) return res.status(400).json({ error: 'matchId, h, a required' });
        const overrides = (await redis.get('overrides')) || {};
        overrides[matchId] = { h: Number(h), a: Number(a) };
        await redis.set('overrides', overrides);
        return res.status(200).json({ ok: true, overrides });
      }
      if (action === 'clearScore') {
        const { matchId } = req.body || {};
        const overrides = (await redis.get('overrides')) || {};
        if (matchId) delete overrides[matchId]; else { await redis.del('overrides'); return res.status(200).json({ ok: true, overrides: {} }); }
        await redis.set('overrides', overrides);
        return res.status(200).json({ ok: true, overrides });
      }
      return res.status(200).json({ ok: true, count: list.length });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === 'GET') {
    try {
      const result = await fetchResults();
      let groupScores = {}, koWinners = { r32:[],r16:[],qf:[],sf:[],third:null,champion:null };
      let qualifiers = new Set();
      let apiSource = 'none';
      
      if (result) {
        apiSource = result.source;
        if (result.source === 'openfootball') {
          ({ groupScores, koWinners, qualifiers } = parseOpenfootball(result.data));
        } else {
          ({ groupScores, koWinners, qualifiers } = parseWorldcup26(result.data));
        }
      }
      
      let list = await redis.get('submissions') || [];
      const overrides = (await redis.get('overrides')) || {};
      // Manual admin overrides win over API data (wrong/missing openfootball games)
      Object.assign(groupScores, overrides);

      const leaderboard = list.map(s => ({
        name: s.name,
        pts: calcPoints(s, groupScores, koWinners, qualifiers),
        topScorer: s.topScorer,
        champion: s.champion,
        at: s.at,
        scorerAwarded: s.scorerAwarded || false
      })).sort((a, b) => b.pts - a.pts);
      
      return res.status(200).json({
        leaderboard,
        lastUpdated: new Date().toISOString(),
        gamesProcessed: Object.keys(groupScores).length,
        overrideCount: Object.keys(overrides).length,
        qualifiersKnown: qualifiers.size,
        apiSource
      });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
