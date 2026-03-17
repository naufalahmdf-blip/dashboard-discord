import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { requireAdmin } from '../../lib/auth.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const user = requireAdmin(req, res);
  if (!user) return;

  const { dateFrom, dateTo, batchSize = 7 } = req.body || {};
  if (!dateFrom || !dateTo) {
    return res.status(400).json({ error: 'dateFrom and dateTo required (YYYY-MM-DD)' });
  }

  try {
    // Generate all dates in range
    const days = [];
    {
      let cur = new Date(dateFrom + 'T00:00:00Z');
      const end = new Date(dateTo + 'T00:00:00Z');
      while (cur <= end) {
        days.push(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }
    if (days.length === 0) return res.json({ ok: true, analyzed: 0, log: ['No days in range'] });

    const log = [];
    let analyzed = 0;

    // Process in batches
    for (let i = 0; i < days.length; i += batchSize) {
      const batch = days.slice(i, i + batchSize);
      const batchFrom = batch[0];
      const batchTo = batch[batch.length - 1];

      // Fetch messages for this batch from chat_messages
      const { data: msgs, error: mErr } = await sb
        .from('chat_messages')
        .select('msg_datetime, username, content')
        .gte('msg_datetime', batchFrom)
        .lte('msg_datetime', batchTo + 'T23:59:59')
        .neq('content', 'EMPTY')
        .neq('content', '')
        .limit(2000);

      if (mErr) {
        log.push(`⚠ ${batchFrom}→${batchTo}: fetch error: ${mErr.message}`);
        continue;
      }
      if (!msgs || msgs.length === 0) {
        log.push(`⏭ ${batchFrom}→${batchTo}: no messages`);
        for (const d of batch) {
          await sb.from('sentiment_daily').upsert({ stat_date: d, pos: 0, neg: 0 }, { onConflict: 'stat_date' });
          await sb.from('daily_topics').upsert({ stat_date: d, topics: [] }, { onConflict: 'stat_date' });
        }
        continue;
      }

      // Group messages by date (with username)
      const byDate = {};
      msgs.forEach(m => {
        const date = m.msg_datetime.split('T')[0];
        if (!byDate[date]) byDate[date] = [];
        byDate[date].push({ u: m.username, c: m.content });
      });

      // Build prompt with daily breakdown (include usernames)
      const dateBreakdown = batch.map(d => {
        const dateMsgs = byDate[d] || [];
        const sample = dateMsgs.slice(0, 100).map(m => `[${m.u}] ${m.c}`).join('\n');
        return `=== ${d} (${dateMsgs.length} messages) ===\n${sample || '(no messages)'}`;
      }).join('\n\n');

      const prompt = `Kamu adalah analis sentimen & topik komunitas Discord trading crypto Indonesia bernama TWS (The Wolf of Street).

TUGAS 1 - SENTIMEN: hitung PERSENTASE pesan yang POSITIF dan NEGATIF terhadap TWS/Suli (founder).

CONTOH POSITIF (support/apresiasi TWS/Suli):
- "Semangat sampai 2030", "Congrats ikut call suli winstreak", "salut ko jonathan konsisten"
- "tws banyak bantu gue", "tq king sl pindah BEP", "Suli lagi menyala"

CONTOH NEGATIF (keluhan/kecewa ke TWS/Suli):
- "Suli ngilang pas bear", "mending vote refund", "Jualan kelas jualan taik"
- "dari OTL udah invalid terus", "korban 150 juta", "bayar mahal malah members yg perform"

NETRAL (jangan dihitung): diskusi market biasa, analisis teknikal, meme/basa-basi

TUGAS 2 - TOPIK: identifikasi 3-5 topik paling dominan per hari.

Berikut pesan-pesan per hari:

${dateBreakdown}

Analisis SETIAP hari dan output JSON:
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "pos": 0.5,
      "neg": 1.2,
      "topics": ["📈 Bitcoin rally ke 100K", "💰 Diskusi altcoin season", "⚠️ Keluhan Suli AFK"],
      "note": "singkat 1 kalimat",
      "pos_examples": [{"u": "username", "c": "isi pesan positif"}],
      "neg_examples": [{"u": "username", "c": "isi pesan negatif"}]
    }
  ]
}

Ketentuan:
- pos = % pesan POSITIF terhadap TWS/Suli (biasanya 0.0 - 5.0)
- neg = % pesan NEGATIF terhadap TWS/Suli (biasanya 0.0 - 5.0)
- topics = array of 3-5 topik dominan (format: "emoji Judul topik"), bahasa Indonesia
- pos_examples = max 5 contoh pesan positif (kutip persis dari chat, sertakan username)
- neg_examples = max 5 contoh pesan negatif (kutip persis dari chat, sertakan username)
- Jika tidak ada pesan, pos=0, neg=0, topics=[], pos_examples=[], neg_examples=[]
- Chat market biasa = NETRAL sentimen, tapi TETAP masuk topics
- Jawab HANYA dengan JSON`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      });

      const result = JSON.parse(completion.choices[0].message.content);
      if (!result.days || !Array.isArray(result.days)) {
        log.push(`⚠ ${batchFrom}→${batchTo}: invalid AI response`);
        continue;
      }

      // Update sentiment_daily and daily_topics for each day
      for (const day of result.days) {
        const pos = parseFloat(day.pos) || 0;
        const neg = parseFloat(day.neg) || 0;
        const topics = Array.isArray(day.topics) ? day.topics : [];
        const pos_examples = Array.isArray(day.pos_examples) ? day.pos_examples.slice(0, 5) : [];
        const neg_examples = Array.isArray(day.neg_examples) ? day.neg_examples.slice(0, 5) : [];
        const note = day.note || '';

        const { error: e1 } = await sb
          .from('sentiment_daily')
          .upsert({ stat_date: day.date, pos, neg, pos_examples, neg_examples, note }, { onConflict: 'stat_date' });
        if (e1) {
          log.push(`⚠ ${day.date}: sentiment update failed: ${e1.message}`);
        }

        const { error: e2 } = await sb
          .from('daily_topics')
          .upsert({ stat_date: day.date, topics }, { onConflict: 'stat_date' });
        if (e2) {
          log.push(`⚠ ${day.date}: topics update failed: ${e2.message}`);
        } else {
          analyzed++;
        }
      }

      const summary = result.days.map(d => `${d.date}: +${d.pos}% -${d.neg}% [${(d.topics || []).length} topics]`).join(', ');
      log.push(`✓ ${batchFrom}→${batchTo}: ${result.days.length} days [${summary}]`);
    }

    log.push(`Done! ${analyzed}/${days.length} days analyzed.`);
    res.json({ ok: true, analyzed, total: days.length, log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
