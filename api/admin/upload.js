import { createClient } from '@supabase/supabase-js';
import { requireAdmin } from '../../lib/auth.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const user = requireAdmin(req, res);
  if (!user) return;

  const { rows, isFirst = true, isLast = true } = req.body || {};
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'rows array required [{username, msg_datetime, content}]' });
  }

  const log = [];
  const BATCH = 500;

  try {
    // Determine date range of this chunk
    let minDate = null, maxDate = null;
    rows.forEach(r => {
      const d = r.msg_datetime ? r.msg_datetime.slice(0, 10) : null;
      if (!d) return;
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    });

    if (!minDate || !maxDate) {
      return res.status(400).json({ error: 'No valid dates found in rows' });
    }

    log.push(`${rows.length} rows (${minDate} → ${maxDate})`);

    // Only delete existing data on first chunk to avoid wiping previously uploaded chunks
    if (isFirst) {
      const { error: delErr } = await sb
        .from('chat_messages')
        .delete()
        .gte('msg_datetime', minDate + 'T00:00:00+00:00')
        .lte('msg_datetime', maxDate + 'T23:59:59+00:00');
      if (delErr) {
        log.push(`Warning: delete failed: ${delErr.message}`);
      } else {
        log.push(`Cleared existing data in range`);
      }
    }

    // Insert in batches
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH).map(r => ({
        username: r.username,
        msg_datetime: r.msg_datetime,
        content: r.content || 'EMPTY',
      }));
      const { error } = await sb.from('chat_messages').insert(batch);
      if (error) return res.status(500).json({ error: `Insert failed at batch ${Math.floor(i / BATCH)}: ${error.message}`, log });
      inserted += batch.length;
    }
    log.push(`Inserted ${inserted} rows`);

    // Only refresh materialized views on last chunk
    if (isLast) {
      log.push('Refreshing materialized views...');
      const { error: refreshErr } = await sb.rpc('refresh_stats');
      if (refreshErr) {
        log.push(`⚠ refresh_stats failed: ${refreshErr.message}`);
      } else {
        log.push('✓ Views refreshed');
      }
    }

    res.json({ ok: true, log });
  } catch (err) {
    res.status(500).json({ error: err.message, log });
  }
}
