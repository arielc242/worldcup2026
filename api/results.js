const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const SCORING = { direction:3, exact:5, r32:6, r16:8, qf:10, sf:12, third:14, final:14, champion:18, topScorer:12 };
const FALLBACK_URL = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

async function fetchResults() {
  try {
    const res = await fetch(FALLBACK_URL);
    if (!res.ok) throw new Error('API error');
    return await res.json();
  } catch(e) { return null; }
}

function parseResults(data) {
  if (!data || !data.rounds) return { groupScores:{}, koWinners:{r32:[],r16:[],qf:[],sf:[],third:null,champion:null} };
  const groupScores = {};
  const koWinners = { r32:[],r16:[],qf:[],sf:[],third:null,champion:null };
  const teamMap = {'Mexico':'מקסיקו','South Africa':'דרום אפריקה','South Korea':'קוריאה הדרומית','Czechia':"צ'כיה",'Canada':'קנדה','Bosnia and Herzegovina':'בוסניה','Qatar':'קטר','Switzerland':'שוויץ','Brazil':'ברזיל','Morocco':'מרוקו','Haiti':'האיטי','Scotland':'סקוטלנד','USA':'ארהב','Paraguay':'פרגוואי','Australia':'אוסטרליה','Turkey':'טורקיה','Germany':'גרמניה','Curaçao':'קוראסאו',"Côte d'Ivoire":'חוף השנהב','Ecuador':'אקוודור','Netherlands':'הולנד','Japan':'יפן','Sweden':'שוודיה','Tunisia':'תוניסיה','Belgium':'בלגיה','Egypt':'מצרים','Iran':'איראן','New Zealand':'ניו זילנד','Spain':'ספרד','Cabo Verde':'קאבו ורדה','Saudi Arabia':'סעודיה','Uruguay':'אורוגוואי','France':'צרפת','Senegal':'סנגל','Iraq':'עיראק','Norway':'נורווגיה','Argentina':'ארגנטינה','Algeria':"אלג'יריה",'Austria':'אוסטריה','Jordan':'ירדן','Portugal':'פורטוגל','DR Congo':'קונגו','Uzbekistan':'אוזבקיסטן','Colombia':'קולומביה','England':'אנגליה','Croatia':'קרואטיה','Ghana':'גאנה','Panama':'פנמה'};
  const mapTeam = n => teamMap[n]||n;
  const matchNums = {1:'A1',2:'A2',3:'B1',4:'B2',5:'C1',6:'C2',7:'D1',8:'D2',9:'E1',10:'E2',11:'F1',12:'F2',13:'G1',14:'G2',15:'H1',16:'H2',17:'I1',18:'I2',19:'J1',20:'J2',21:'K1',22:'K2',23:'L1',24:'L2',25:'A3',26:'A4',27:'B3',28:'B4',29:'C3',30:'C4',31:'D3',32:'D4',33:'E3',34:'E4',35:'F3',36:'F4',37:'G3',38:'G4',39:'H3',40:'H4',41:'I3',42:'I4',43:'J3',44:'J4',45:'K3',46:'K4',47:'L3',48:'L4',49:'A5',50:'A6',51:'B5',52:'B6',53:'C5',54:'C6',55:'D5',56:'D6',57:'E5',58:'E6',59:'F5',60:'F6',61:'G5',62:'G6',63:'H5',64:'H6',65:'I5',66:'I6',67:'J5',68:'J6',69:'K5',70:'K6',71:'L5',72:'L6'};
  data.rounds.forEach(round => {
    round.matches && round.matches.forEach(m => {
      if (!m.score) return;
      const h=m.score.ft?.[0]??null, a=m.score.ft?.[1]??null;
      if (h===null||a===null) return;
      const matchId=matchNums[m.num];
      if (matchId) groupScores[matchId]={h,a};
      const rn=(round.name||'').toLowerCase();
      const winner=h>a?mapTeam(m.team1?.name):mapTeam(m.team2?.name);
      if(rn.includes('round of 32'))koWinners.r32.push(winner);
      else if(rn.includes('round of 16'))koWinners.r16.push(winner);
      else if(rn.includes('quarter'))koWinners.qf.push(winner);
      else if(rn.includes('semi'))koWinners.sf.push(winner);
      else if(rn.includes('third'))koWinners.third=winner;
      else if(rn.includes('final')&&!rn.includes('third')&&!rn.includes('semi'))koWinners.champion=winner;
    });
  });
  return { groupScores, koWinners };
}

function calcPoints(sub, groupScores, koWinners) {
  let pts = 0;
  Object.keys(groupScores).forEach(id => {
    const actual=groupScores[id], pred=sub.scores?.[id];
    if (!pred) return;
    if (pred.h===actual.h&&pred.a===actual.a) pts+=SCORING.exact;
    else {
      const ad=actual.h>actual.a?1:actual.h<actual.a?-1:0;
      const pd=pred.h>pred.a?1:pred.h<pred.a?-1:0;
      if (ad===pd) pts+=SCORING.direction;
    }
  });
  const rounds=[{key:'r32',pts:SCORING.r32},{key:'r16',pts:SCORING.r16},{key:'qf',pts:SCORING.qf},{key:'sf',pts:SCORING.sf}];
  rounds.forEach(({key,pts:rPts}) => {
    const actual=koWinners[key]||[];
    Object.values(sub.ko||{}).forEach(m=>{if(m?.winner&&actual.includes(m.winner))pts+=rPts;});
  });
  if(koWinners.third&&sub.ko?.['m103']?.winner===koWinners.third)pts+=SCORING.third;
  if(koWinners.champion&&sub.ko?.['m104']?.winner===koWinners.champion)pts+=SCORING.final;
  if(sub.scorerAwarded)pts+=SCORING.topScorer;
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
      if (adminKey !== (process.env.ADMIN_KEY||'wc2026admin')) return res.status(401).json({ error: 'Unauthorized' });
      let list = await redis.get('submissions') || [];
      if (action==='awardScorer'&&scorerName) {
        const norm=scorerName.toLowerCase().trim();
        list=list.map(s=>{
          const guess=(s.topScorer||'').toLowerCase().trim();
          if(guess&&(guess.includes(norm)||norm.includes(guess))&&!s.scorerAwarded){s.pts=(s.pts||0)+SCORING.topScorer;s.scorerAwarded=true;}
          return s;
        });
      }
      await redis.set('submissions', list);
      return res.status(200).json({ ok:true, count:list.length });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === 'GET') {
    try {
      const rawData = await fetchResults();
      const { groupScores, koWinners } = parseResults(rawData);
      let list = await redis.get('submissions') || [];
      const leaderboard = list.map(s => ({
        name:s.name, pts:calcPoints(s,groupScores,koWinners),
        topScorer:s.topScorer, champion:s.champion, at:s.at,
        scorerAwarded:s.scorerAwarded||false
      })).sort((a,b)=>b.pts-a.pts);
      return res.status(200).json({ leaderboard, lastUpdated:new Date().toISOString(), gamesProcessed:Object.keys(groupScores).length });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
