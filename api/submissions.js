const { kv } = require('@vercel/kv');

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
      let list = await kv.get('submissions') || [];
      list = list.filter(s => s.name !== name);
      list.push(submission);
      await kv.set('submissions', list);
      return res.status(200).json({ ok: true });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === 'GET') {
    try {
      const list = await kv.get('submissions') || [];
      return res.status(200).json(list);
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
