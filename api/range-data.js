import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const user = requireAuth(req, res);
  if (!user) return;

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });

  try {
    const [
      { data: sentDaily },
      { data: topicsDaily },
    ] = await Promise.all([
      sb.from('sentiment_daily').select('*').gte('stat_date', from).lte('stat_date', to),
      sb.from('daily_topics').select('*').gte('stat_date', from).lte('stat_date', to).order('stat_date'),
    ]);
    const sdMap = {};
    (sentDaily || []).forEach(s => { sdMap[typeof s.stat_date === 'string' ? s.stat_date.slice(0, 10) : s.stat_date] = s; });

    const [
      { data: rawDaily, error: e1 },
      { data: rawSuli, error: e2 },
      { data: rawJon, error: e3 },
      { data: rawUsers, error: e4 },
    ] = await Promise.all([
      sb.rpc('get_daily_stats_range', { from_date: from, to_date: to }),
      sb.rpc('get_suli_daily_range', { from_date: from, to_date: to }),
      sb.rpc('get_jon_daily_range', { from_date: from, to_date: to }),
      sb.rpc('get_user_stats', { from_date: from, to_date: to }),
    ]);

    const errors = [e1, e2, e3, e4].filter(Boolean);
    if (errors.length > 0) {
      console.error('Range query errors:', errors);
      return res.status(500).json({ error: 'Range query failed', details: errors });
    }

    const dailyStats = (rawDaily || []).map(r => {
      const dateStr = typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date;
      const sent = sdMap[dateStr] || {};
      return {
        stat_date: dateStr,
        messages: Number(r.messages),
        users: Number(r.users),
        pos: Number(sent.pos) || 0,
        neg: Number(sent.neg) || 0,
      };
    });

    res.json({
      dailyStats,
      suliDaily: (rawSuli || []).map(r => ({ stat_date: typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date, msgs: Number(r.msgs) })),
      jonDaily: (rawJon || []).map(r => ({ stat_date: typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date, msgs: Number(r.msgs) })),
      topChatters: (rawUsers || []).map(r => ({ username: r.username, msgs: Number(r.msgs) })),
      dailyTopics: (topicsDaily || []).map(r => ({ stat_date: typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date, topics: r.topics })),
    });
  } catch (err) {
    console.error('Range data error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
