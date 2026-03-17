import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../lib/auth.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const user = requireAuth(req, res);
  if (!user) return;
  try {
    const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const [
      { data: rawDaily, error: e1 },
      { data: suliDaily, error: e2 },
      { data: jonDaily, error: e3 },
      { data: rawAllTime, error: e4 },
      { data: sentDaily, error: e5 },
      { data: complaintCats, error: e6 },
      { data: complaintMsgs, error: e7 },
      { data: dailyTopicsRaw, error: e8 },
      { data: storyArc, error: e9 },
      { data: rootCauses, error: e10 },
      { data: shadowAccounts, error: e11 },
    ] = await Promise.all([
      sb.from('mv_daily_stats').select('*').order('stat_date'),
      sb.from('mv_suli_daily').select('*').order('stat_date'),
      sb.from('mv_jon_daily').select('*').order('stat_date'),
      sb.from('mv_all_time_users').select('*').order('msgs', { ascending: false }),
      sb.from('sentiment_daily').select('*'),
      sb.from('complaint_categories').select('*').order('sort_order'),
      sb.from('complaint_messages').select('*').order('msg_date', { ascending: false }),
      sb.from('daily_topics').select('*').order('stat_date'),
      sb.from('story_arc').select('*').order('sort_order'),
      sb.from('root_causes').select('*').order('sort_order'),
      sb.from('shadow_accounts').select('*').order('sort_order'),
    ]);

    const errors = [e1,e2,e3,e4,e5,e6,e7,e8,e9,e10,e11].filter(Boolean);
    if (errors.length > 0) return res.status(500).json({ error: 'Database query failed', details: errors });

    const sdMap = {};
    (sentDaily || []).forEach(s => { sdMap[typeof s.stat_date === 'string' ? s.stat_date.slice(0, 10) : s.stat_date] = s; });

    const dailyStats = (rawDaily || []).map(r => {
      const dateStr = typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date;
      const sent = sdMap[dateStr] || {};
      return {
        stat_date: dateStr,
        messages: Number(r.messages),
        users: Number(r.users),
        pos: Number(sent.pos) || 0,
        neg: Number(sent.neg) || 0,
        pos_examples: sent.pos_examples || [],
        neg_examples: sent.neg_examples || [],
        note: sent.note || '',
      };
    });

    const allMonths = (rawDaily || []).length > 0
      ? [...new Set((rawDaily || []).map(r => (typeof r.stat_date === 'string' ? r.stat_date : '').slice(0, 7)))].sort()
      : [];
    const recentMonths = new Set(allMonths.slice(-3));
    const allTimeUsers = (rawAllTime || []).map(r => {
      const fd = r.first_date, ld = r.last_date;
      const fmtD = (d) => {
        if (!d) return '';
        const s = typeof d === 'string' ? d : d.toISOString().slice(0, 10);
        const [y, m] = s.split('-');
        return `${MN[parseInt(m, 10) - 1]} ${y.slice(2)}`;
      };
      const lastMk = ld ? (typeof ld === 'string' ? ld.slice(0, 7) : ld.toISOString().slice(0, 7)) : '';
      return {
        username: r.username,
        msgs: Number(r.msgs),
        period: fd === ld ? fmtD(fd) : `${fmtD(fd)} – ${fmtD(ld)}`,
        months: Number(r.months),
        active: recentMonths.has(lastMk),
      };
    });

    res.json({
      dailyStats,
      suliDaily: (suliDaily || []).map(r => ({ stat_date: typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date, msgs: Number(r.msgs) })),
      jonDaily: (jonDaily || []).map(r => ({ stat_date: typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date, msgs: Number(r.msgs) })),
      allTimeUsers,
      complaintCats: complaintCats || [],
      complaintMsgs: complaintMsgs || [],
      dailyTopics: (dailyTopicsRaw || []).map(r => ({ stat_date: typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date, topics: r.topics })),
      storyArc: storyArc || [],
      rootCauses: rootCauses || [],
      shadowAccounts: shadowAccounts || [],
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
