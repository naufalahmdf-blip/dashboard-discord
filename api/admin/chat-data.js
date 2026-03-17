import { createClient } from '@supabase/supabase-js';
import { requireAuth, requireAdmin } from '../../lib/auth.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { action } = req.query;

  // date-range: only needs auth
  if (action === 'date-range') {
    const user = requireAuth(req, res);
    if (!user) return;
    try {
      const { data, error } = await sb.rpc('get_chat_date_range');
      if (error) return res.status(500).json({ error: error.message });
      if (!data || data.length === 0) return res.status(404).json({ error: 'No data in chat_messages' });
      const row = data[0];
      return res.json({ minDate: row.min_date, maxDate: row.max_date, totalMsgs: Number(row.total_msgs) });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // fetch-messages: needs admin
  if (action === 'fetch-messages') {
    const user = requireAdmin(req, res);
    if (!user) return;
    try {
      let allData = [], page = 0, pageSize = 1000;
      while (true) {
        const { data, error } = await sb
          .from('chat_messages')
          .select('username, msg_datetime, content')
          .neq('content', 'EMPTY')
          .neq('content', '')
          .order('msg_datetime', { ascending: false })
          .range(page * pageSize, (page + 1) * pageSize - 1);
        if (error) return res.status(500).json({ error: error.message });
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        if (data.length < pageSize) break;
        page++;
      }
      const messages = allData.map(r => ({
        date: r.msg_datetime ? r.msg_datetime.split('T')[0] : '',
        username: r.username || '',
        content: r.content || '',
      }));
      return res.json({ ok: true, messages, total: messages.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(400).json({ error: 'action required: date-range or fetch-messages' });
}
