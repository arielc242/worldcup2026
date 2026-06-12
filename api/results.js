const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const SCORING = { direction:3, exact:5, r32:6, r16:8, qf:10, sf:12, third:14, final:14, champion:18, topScorer:12 };

const TEAM_MAP = {
  'Mexico':'מקסיקו','South Africa':'דרום אפריקה','South Korea':'קוריאה הדרומית','Czechia':"צ'כיה",
  'Canada':'קנדה','Bosnia and Herzegovina':'בוסניה','Qatar':'קטר','Switzerland':'שוויץ',
  'Brazil':'ברזיל','Morocco':'מרוקו','Haiti':'האיטי','Scotland':'סקוטלנד',
  'United States':'ארהב','USA':'ארהב','Paraguay':'פרגוואי','Australia':'אוסטרליה','Turkey':'טורקיה',
  'Germany':'גרמניה','Curacao':'קוראסאו','Curaçao':'קוראסאו',"Ivory Coast":'חוף השנהב',"Cote d'Ivoire":'חוף השנהב',"Côte d'Ivoire":'חוף השנהב','Ecuador':'אקוודור',
  'Netherlands':'הולנד','Japan':'יפן','Sweden':'שוודיה','Tunisia':'תוניסיה',
  'Belgium':'בלגיה','Egypt':'מצרים','Iran':'איראן','New Zealand':'ניו זילנד',
  'Spain':'ספרד','Cape Verde':'קאבו ורדה','Cabo Verde':'קאבו ורדה','Saudi Arabia':'סעודיה','Uruguay':'אורוגוואי',
  'France':'צרפת','Senegal':'סנגל','Iraq':'עיראק','Norway':'נורווגיה',
  'Argentina':'ארגנטינה','Algeria':"אלג'יריה",'Austria':'אוסטריה','Jordan':'ירדן',
  'Portugal':'פורטוגל','DR Congo':'קונגו','Congo DR':'קונגו','Uzbekistan':'אוזבקיסטן','Colombia':'קולומביה',
  'England':'אנגליה','Croatia':'קרואטיה','Ghana':'גאנה','Panama':'פנמה',
};

const mapTeam = n => TEAM_MAP[n] || n;

// Match number to ID — worldcup26.ir uses id field starting from 1
const MATCH_ID_MAP = {
  '1':'A1','2':'A2','3':'B1','4':'B2','5':'C1','6':'C2','7':'D1','8':'D2','9':'E1','10':'E2',
  '11':'F1','12':'F2','13':'G1','14':'G2','15':'H1','16':'H2','17':'I1','18':'I2','19':'J1','20':'J2',
  '21':'K1','22':'K2','23':'L1','24':'L2','25':'A3','26':'A4','27':'B3','28':'B4','29':'C3','30':'C4',
  '31':'D3','32':'D4','33':'E3','34':'E4','35':'F3','36':'F4','37':'G3','38':'G4','39':'H3','40':'H4',
  '41':'I3','42':'I4','43':'J3','44':'J4','45':'K3','46':'K4','47':'L3','48':'L4',
  '49':'A5','50':'A6','51':'B5','52':'B6','53':'C5','54':'C6','55':'D5','56':'D6',
  '57':'E5','58':'E6','59':'F5','60':'F6','61':'G5','62':'G6','63':'H5','64':'H6',
  '65':'I5','66':'I6','67':'J5','68':'J6','69':'K5','70':'K6','71':'L5','72':'L6'
};

async function fetchResults() {
  try {
    const res = await fetch('https://worldcup26.ir/get/games', {
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error('API error ' + res.status);
    const data = await res.json();
    return data.games || data;
  } catch(e) {
    console.error('fetchResults error:', e.message);
    return null;
  }
}

function parseResults(games) {
  const groupScores = {};
  const koWinners = { r32:[], r16:[], qf:[], sf:[], third:null, champion:null };

  if (!games || !Array.isArray(games)) return { groupScores, koWinners };

  games.forEach(match => {
    const finished = match.finished === 'TRUE' || match.finished === true || 
                     match.time_elapsed === 'finished' || match.status === 'finished';
    if (!finished) return;

    const h = parseInt(match.home_score);
    const a = parseInt(match.away_score);
    if (isNaN(h) || isNaN(a)) return;

    const matchId = MATCH_ID_MAP[String(match.id)];
    const type = (match.type || '').toLowerCase();
    const homeTeam = mapTeam(match.home_team_name_en || match.home_team);
    const awayTeam = mapTeam(match.away_team_name_en || match.away_team);
    const winner = h > a ? homeTeam : awayTeam;

    // Group stage
    if (type === 'group' && matchId) {
      groupScores[matchId] = { h, a };
    }

    // Knockout rounds
    if (type === 'round_of_32' || type === 'r32') koWinners.r32.push(winner);
    else if (type === 'round_of_16' || type === 'r16') koWinners.r16.push(winner);
    else if (type === 'quarter_final' || type === 'qf') koWinners.qf.push(winner);
    else if (type === 'semi_final' || type === 'sf') koWinners.sf.push(winner);
    else if (type === 'third_place' || type === 'third') koWinners.third = winner;
    else if (type === 'final') koWinners.champion = winner;
  });

  return { groupScores, koWinners };
}

function calcPoints(sub, groupScores, koWinners) {
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
  const rounds = [
    {key:'r32',pts:SCORING.r32},{key:'r16',pts:SCORING.r16},
    {key:'qf',pts:SCORING.qf},{key:'sf',pts:SCORING.sf}
  ];
  rounds.forEach(({key,pts:rPts}) => {
    const actual = koWinners[key] || [];
    Object.values(sub.ko || {}).forEach(m => {
      if (m?.winner && actual.includes(m.winner)) pts += rPts;
    });
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
      return res.status(200).json({ ok: true, count: list.length });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === 'GET') {
    try {
      const games = await fetchResults();
      const { groupScores, koWinners } = parseResults(games);
      let list = await redis.get('submissions') || [];
      const leaderboard = list.map(s => ({
        name: s.name,
        pts: calcPoints(s, groupScores, koWinners),
        topScorer: s.topScorer,
        champion: s.champion,
        at: s.at,
        scorerAwarded: s.scorerAwarded || false
      })).sort((a, b) => b.pts - a.pts);
      return res.status(200).json({
        leaderboard,
        lastUpdated: new Date().toISOString(),
        gamesProcessed: Object.keys(groupScores).length,
        apiStatus: games ? 'ok' : 'error'
      });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
