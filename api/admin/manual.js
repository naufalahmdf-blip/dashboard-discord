import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../lib/auth.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  const u = requireAdmin(req, res);
  if (!u) return;
  if (req.method === 'GET') {
    try {
      const [
        { data: rootCauses, error: e1 },
        { data: storyArc, error: e2 },
        { data: complaintCats, error: e3 },
        { data: complaintMsgs, error: e4 },
        { data: shadowAccounts, error: e5 },
      ] = await Promise.all([
        sb.from('root_causes').select('*').order('sort_order'),
        sb.from('story_arc').select('*').order('sort_order'),
        sb.from('complaint_categories').select('*').order('sort_order'),
        sb.from('complaint_messages').select('*').order('msg_date', { ascending: false }),
        sb.from('shadow_accounts').select('*').order('sort_order'),
      ]);
      const err = [e1, e2, e3, e4, e5].find(Boolean);
      if (err) return res.status(500).json({ error: err.message });
      return res.json({ rootCauses: rootCauses || [], storyArc: storyArc || [], complaintCats: complaintCats || [], complaintMsgs: complaintMsgs || [], shadowAccounts: shadowAccounts || [] });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { type, rows } = req.body || {};
  if (!type || !Array.isArray(rows)) return res.status(400).json({ error: 'type and rows required' });

  try {
    if (type === 'root_causes') {
      await sb.from('root_causes').delete().neq('id', 0);
      const toInsert = rows.map((r, i) => ({
        sort_order: i + 1,
        cause: r.cause || '',
        percentage: parseFloat(r.percentage) || 0,
        description: r.description || '',
      }));
      const { error } = await sb.from('root_causes').insert(toInsert);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true, saved: toInsert.length });
    }

    if (type === 'story_arc') {
      await sb.from('story_arc').delete().neq('id', 0);
      const toInsert = rows.map((r, i) => ({
        sort_order: i + 1,
        phase: r.phase || '',
        description: r.description || '',
        color: r.color || '#6366f1',
      }));
      const { error } = await sb.from('story_arc').insert(toInsert);
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true, saved: toInsert.length });
    }

    if (type === 'complaint_categories') {
      // rows = [{ id, theme, color, sort_order, all_time_count, recent_count, messages: [{msg_date,username,content,is_recent}] }]
      await sb.from('complaint_messages').delete().neq('id', 0);
      await sb.from('complaint_categories').delete().neq('id', 0);

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const catId = i + 1;

        const { error: e1 } = await sb.from('complaint_categories').insert({
          id: catId,
          sort_order: i + 1,
          theme: r.theme || '',
          color: r.color || '#6366f1',
        });
        if (e1) return res.status(500).json({ error: `categories: ${e1.message}` });

        if (r.messages && r.messages.length > 0) {
          const msgRows = r.messages.map(m => ({
            category_id: catId,
            msg_date: m.msg_date || '',
            username: m.username || '',
            content: m.content || '',
            is_recent: !!m.is_recent,
          }));
          const { error: e3 } = await sb.from('complaint_messages').insert(msgRows);
          if (e3) return res.status(500).json({ error: `messages: ${e3.message}` });
        }
      }
      return res.json({ ok: true, saved: rows.length });
    }

    if (type === 'shadow_accounts') {
      // Only delete Adrian's accounts, preserve non-Adrian
      const pic = (rows[0]?.pic || 'Adrian').toLowerCase();
      await sb.from('shadow_accounts').delete().ilike('pic', pic);

      if (rows.length > 0) {
        // Get max sort_order of remaining rows to continue numbering
        const { data: remaining } = await sb.from('shadow_accounts').select('sort_order').order('sort_order', { ascending: false }).limit(1);
        const startOrder = (remaining?.[0]?.sort_order || 0) + 1;

        const toInsert = rows.map((r, i) => ({
          sort_order: startOrder + i,
          username: r.username || '',
          display_name: r.display_name || '',
          pic: r.pic || 'Adrian',
          character_desc: r.character_desc || '',
          role: r.role || 'support',
          msgs: parseInt(r.msgs) || 0,
        }));
        const { error } = await sb.from('shadow_accounts').insert(toInsert);
        if (error) return res.status(500).json({ error: error.message });
      }
      return res.json({ ok: true, saved: rows.length });
    }

    return res.status(400).json({ error: `Unknown type: ${type}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
