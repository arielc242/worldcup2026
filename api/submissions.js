const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    try {
      const { name, scores, ko, topScorer, champion } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Name required' });
      const submission = {
        id: Date.now(), name, scores: scores||{}, ko: ko||{},
        topScorer: topScorer||'', champion: champion||'',
        at: new Date().toISOString(), pts: 0, scorerAwarded: false
      };
      let list = await redis.get('submissions') || [];
      list = list.filter(s => s.name !== name);
      list.push(submission);
      await redis.set('submissions', list);
      return res.status(200).json({ ok: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === 'GET') {
    try {
      const list = await redis.get('submissions') || [];
      return res.status(200).json(list);
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};


curl https://worldcup2026-navy-nu.vercel.app/api/submissions > ~/Desktop/submissions_backup.json
curl https://worldcup2026-navy-nu.vercel.app/api/submissions -o ~/Desktop/submissions_backup.json && cat ~/Desktop/submissions_backup.json
cd ~/Downloads/worldcup2026
cat > api/submissions.js << 'EOF'
const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    try {
      const { name, scores, ko, topScorer, champion } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Name required' });
      const submission = {
        id: Date.now(), name, scores: scores||{}, ko: ko||{},
        topScorer: topScorer||'', champion: champion||'',
        at: new Date().toISOString(), pts: 0, scorerAwarded: false
      };
      let list = await redis.get('submissions') || [];
      list = list.filter(s => s.name !== name);
      list.push(submission);
      await redis.set('submissions', list);
      return res.status(200).json({ ok: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === 'GET') {
    try {
      const list = await redis.get('submissions') || [];
      return res.status(200).json(list);
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === 'DELETE') {
    try {
      const { adminKey, name } = req.body || {};
      if (adminKey !== (process.env.ADMIN_KEY || 'wc2026admin')) return res.status(401).json({ error: 'Unauthorized' });
      if (!name) return res.status(400).json({ error: 'Name required' });
      let list = await redis.get('submissions') || [];
      list = list.filter(s => s.name !== name);
      await redis.set('submissions', list);
      return res.status(200).json({ ok: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
