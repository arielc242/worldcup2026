const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const SCORING = { direction:3, exact:5, r32:6, r16:8, qf:10, sf:12, third:14, final:14, champion:18, topScorer:12 };

const TEAM_MAP = {
  'Mexico':'מקסיקו','South Africa':'דרום אפריקה','South Korea':'קוריאה הדרומית',
  'Czech Republic':"צ'כיה",'Czechia':"צ'כיה",
  'Canada':'קנדה','Bosnia and Herzegovina':'בוסניה','Qatar':'קטר','Switzerland':'שוויץ',
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
  'Mexico-South Africa':'A1','South Korea-Czech Republic':'A2','South Korea-Czechia':'A2',
  'Mexico-South Korea':'A3','Czech Republic-South Africa':'A4','Czechia-South Africa':'A4',
  'Czechia-Mexico':'A5','Czech Republic-Mexico':'A5','South Africa-South Korea':'A6',
  'Canada-Bosnia and Herzegovina':'B1','Qatar-Switzerland':'B2','Canada-Qatar':'B3',
  'Switzerland-Bosnia and Herzegovina':'B4','Switzerland-Canada':'B5','Bosnia and Herzegovina-Qatar':'B6',
  'Brazil-Morocco':'C1','Haiti-Scotland':'C2','Brazil-Scotland':'C3','Morocco-Haiti':'C4',
  'Morocco-Scotland':'C5','Haiti-Brazil':'C6',
  'United States-Paraguay':'D1','USA-Paraguay':'D1','Australia-Turkey':'D2','Australia-Türkiye':'D2','Australia-Turkiye':'D2',
  'United States-Australia':'D3','USA-Australia':'D3','Paraguay-Turkey':'D4','Paraguay-Türkiye':'D4','Paraguay-Turkiye':'D4',
  'Turkey-United States':'D5','Türkiye-United States':'D5','Turkiye-United States':'D5',
  'Turkey-USA':'D5','Türkiye-USA':'D5','Australia-Paraguay':'D6',
  'Germany-Curaçao':'E1','Germany-Curacao':'E1',"Côte d'Ivoire-Ecuador":'E2',"Cote d'Ivoire-Ecuador":'E2','Ivory Coast-Ecuador':'E2',
  "Germany-Côte d'Ivoire":'E3',"Germany-Cote d'Ivoire":'E3','Germany-Ivory Coast':'E3',
  'Ecuador-Curaçao':'E4','Ecuador-Curacao':'E4','Ecuador-Germany':'E5',
  "Curaçao-Côte d'Ivoire":'E6',"Curacao-Cote d'Ivoire":'E6','Curaçao-Ivory Coast':'E6','Curacao-Ivory Coast':'E6',
  'Netherlands-Japan':'F1','Sweden-Tunisia':'F2','Netherlands-Sweden':'F3','Japan-Tunisia':'F4',
  'Japan-Sweden':'F5','Tunisia-Netherlands':'F6',
  'Belgium-Egypt':'G1','Iran-New Zealand':'G2','Belgium-Iran':'G3','Egypt-New Zealand':'G4',
  'Egypt-Iran':'G5','New Zealand-Belgium':'G6',
  'Spain-Cabo Verde':'H1','Spain-Cape Verde':'H1','Saudi Arabia-Uruguay':'H2','Spain-Saudi Arabia':'H3',
  'Uruguay-Cabo Verde':'H4','Uruguay-Cape Verde':'H4','Uruguay-Spain':'H5','Cabo Verde-Saudi Arabia':'H6','Cape Verde-Saudi Arabia':'H6',
  'France-Senegal':'I1','Iraq-Norway':'I2','France-Iraq':'I3','Norway-Senegal':'I4',
  'Norway-France':'I5','Senegal-Iraq':'I6',
  'Argentina-Algeria':'J1','Austria-Jordan':'J2','Argentina-Austria':'J3','Jordan-Algeria':'J4',
  'Jordan-Argentina':'J5','Algeria-Austria':'J6',
  'Portugal-DR Congo':'K1','Portugal-Congo DR':'K1','Uzbekistan-Colombia':'K2',
  'Portugal-Uzbekistan':'K3','Colombia-DR Congo':'K4','Colombia-Congo DR':'K4',
  'Colombia-Portugal':'K5','DR Congo-Uzbekistan':'K6','Congo DR-Uzbekistan':'K6',
  'England-Croatia':'L1','Ghana-Panama':'L2','England-Ghana':'L3','Panama-Croatia':'L4',
  'Panama-England':'L5','Croatia-Ghana':'L6',
};

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
  if (!data || !data.matches) return { groupScores, koWinners };
  
  data.matches.forEach(m => {
    if (!m.score || !m.score.ft) return;
    const h = m.score.ft[0], a = m.score.ft[1];
    if (h === null || h === undefined || a === null || a === undefined) return;
    
    const t1 = m.team1, t2 = m.team2;
    const pairKey = `${t1}-${t2}`;
    const matchId = TEAM_PAIR_TO_MATCH_ID[pairKey];
    const round = (m.round || '').toLowerCase();
    
    if (matchId) {
      groupScores[matchId] = { h, a };
    }
    
    const winner = h > a ? mapTeam(t1) : mapTeam(t2);
    if (round.includes('round of 32') || round.includes('r32')) koWinners.r32.push(winner);
    else if (round.includes('round of 16') || round.includes('r16')) koWinners.r16.push(winner);
    else if (round.includes('quarter')) koWinners.qf.push(winner);
    else if (round.includes('semi')) koWinners.sf.push(winner);
    else if (round.includes('third') || round.includes('3rd')) koWinners.third = winner;
    else if (round.includes('final') && !round.includes('semi') && !round.includes('third') && !round.includes('3rd')) koWinners.champion = winner;
  });
  
  return { groupScores, koWinners };
}

function parseWorldcup26(games) {
  const groupScores = {};
  const koWinners = { r32:[],r16:[],qf:[],sf:[],third:null,champion:null };
  if (!games || !Array.isArray(games)) return { groupScores, koWinners };
  
  games.forEach(match => {
    const finished = match.finished === 'TRUE' || match.finished === true || match.time_elapsed === 'finished';
    if (!finished) return;
    const h = parseInt(match.home_score), a = parseInt(match.away_score);
    if (isNaN(h) || isNaN(a)) return;
    
    const homeEn = match.home_team_name_en || '';
    const awayEn = match.away_team_name_en || '';
    const pairKey = `${homeEn}-${awayEn}`;
    const matchId = TEAM_PAIR_TO_MATCH_ID[pairKey];
    const type = (match.type || '').toLowerCase();
    const homeTeam = mapTeam(homeEn), awayTeam = mapTeam(awayEn);
    const winner = h > a ? homeTeam : awayTeam;
    
    if (type === 'group' && matchId) groupScores[matchId] = { h, a };
    if (type === 'round_of_32') koWinners.r32.push(winner);
    else if (type === 'round_of_16') koWinners.r16.push(winner);
    else if (type === 'quarter_final') koWinners.qf.push(winner);
    else if (type === 'semi_final') koWinners.sf.push(winner);
    else if (type === 'third_place') koWinners.third = winner;
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
      return res.status(200).json({ ok: true, count: list.length });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === 'GET') {
    try {
      const result = await fetchResults();
      let groupScores = {}, koWinners = { r32:[],r16:[],qf:[],sf:[],third:null,champion:null };
      let apiSource = 'none';
      
      if (result) {
        apiSource = result.source;
        if (result.source === 'openfootball') {
          ({ groupScores, koWinners } = parseOpenfootball(result.data));
        } else {
          ({ groupScores, koWinners } = parseWorldcup26(result.data));
        }
      }
      
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
        apiSource
      });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
