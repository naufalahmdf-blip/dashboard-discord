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

      // Fetch ALL messages for this batch from chat_messages (no limit)
      let msgs = [];
      let offset = 0;
      const PAGE = 5000;
      while (true) {
        const { data: page, error: pErr } = await sb
          .from('chat_messages')
          .select('msg_datetime, username, content')
          .gte('msg_datetime', batchFrom)
          .lte('msg_datetime', batchTo + 'T23:59:59')
          .neq('content', 'EMPTY')
          .neq('content', '')
          .range(offset, offset + PAGE - 1);
        if (pErr) { msgs = null; break; }
        if (!page || page.length === 0) break;
        msgs.push(...page);
        if (page.length < PAGE) break;
        offset += PAGE;
      }
      const mErr = msgs === null;

      if (mErr) {
        log.push(`⚠ ${batchFrom}→${batchTo}: fetch error`);
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

      // Build prompt with daily breakdown — representative sample per day
      const dateBreakdown = batch.map(d => {
        const dateMsgs = byDate[d] || [];
        // Sample: first 50 + last 50 + random 100 from middle for variety
        let sample;
        if (dateMsgs.length <= 200) {
          sample = dateMsgs;
        } else {
          const first = dateMsgs.slice(0, 50);
          const last = dateMsgs.slice(-50);
          const middle = dateMsgs.slice(50, -50);
          const shuffled = middle.sort(() => Math.random() - 0.5).slice(0, 100);
          sample = [...first, ...shuffled, ...last];
        }
        const lines = sample.map(m => `[${m.u}] ${m.c}`).join('\n');
        return `=== ${d} (${dateMsgs.length} messages, showing ${sample.length}) ===\n${lines || '(no messages)'}`;
      }).join('\n\n');

      const prompt = `Kamu adalah analis sentimen & topik komunitas Discord trading crypto Indonesia bernama TWS (The Wolf of Street).

TUGAS 1 - SENTIMEN: hitung PERSENTASE pesan yang POSITIF dan NEGATIF terhadap TWS/Suli (founder).
Hitung dari SEMUA pesan (total messages count tertulis di header), bukan hanya sample. Sample hanya untuk referensi konteks.

=== CONTOH KALIMAT POSITIF (support/apresiasi TWS/Suli) ===
- "Semangat sampai 2030"
- "Gw masih hold soalnya percaya fundamental"
- "Congrats yang sudah tetap setia ikut call suli, 3 calls winstreak"
- "tws banyak bantu gue juga buat refine cara baca market"
- "tq king sl pindah BEP"
- "Suli lagi menyala"
- "salut ama ko jonathan, sisi positifnya konsisten"
- "harus bersyukur masi ada yang mau ngajarin"
- "Udah ges gua udah puas klo sul minta maaf"
- "Gw udh brapa x kena SL Suli ampe jiper, tp ya thats life, gak tiap x Suli call i jg ikut, its our choice"
- "Mangats gez"
- "stay in cash teman-teman, lihat war dan krisis kali ini sebagai peluang"
- "nice setup bro, roi nya gacor"
- "Mantap king"

=== CONTOH KALIMAT NEGATIF (keluhan/kecewa ke TWS/Suli) ===
- "Waktu bull gembar gembor, live publik 2x seminggu, marketing kenceng, Sekarang ngilang. Parah banget"
- "king suli afk? tinggal ngitung waktu, semua fitur yg di janjiin gagal deliver satu per satu"
- "mending vote refund aja dibanding kalian sakit hati terus"
- "Jualan kelas jualan taik"
- "dari OTL udah invalid terus wkwkwk dari btc 100,90,80 skrng di undur lagi jadi 70 sampai 50"
- "Aku juga korban 150"
- "bayar mahal mahal malah members nya yg perform"
- "Suli ngilang pas bear market"
- "Bukannya evaluasi, malah ngatain member"
- "dngar dngar kelas marketing bree cara jualan kelas dengan hope"
- "Duit member Di pake buat jajan lcc"
- "Postingan2 kek gini tampil mulu Yg fomo langsung asal masuk padahal narasi nya masi bearish"
- "call lah sul, sepi banget"
- "suli gapernah update jir kemana ya?"
- "Katanya bukan bear tapi short sampe 50k, Lalu namanya apa ketua"
- "bnyak bre lulusan sini, udh buka clas juga, polanya kek ketua"
- "Niat hati masuk kelas mau profit malah banyak minusnya"
- "Gila yaa bayar mahal mahal malah members nya yg perform"

=== NETRAL (jangan dihitung sebagai pos/neg) ===
Diskusi market biasa, analisis teknikal, sharing chart, meme/basa-basi, obrolan non-TWS

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
      "note": "singkat 1 kalimat rangkuman hari ini",
      "pos_examples": [{"u": "username", "c": "kutipan pesan positif persis dari chat"}],
      "neg_examples": [{"u": "username", "c": "kutipan pesan negatif persis dari chat"}]
    }
  ]
}

PENTING:
- pos = % pesan POSITIF terhadap TWS/Suli dari TOTAL pesan hari itu (biasanya 0.0 - 5.0, bisa lebih tinggi kalau memang banyak)
- neg = % pesan NEGATIF terhadap TWS/Suli dari TOTAL pesan hari itu (biasanya 0.0 - 5.0, bisa lebih tinggi)
- HITUNG TELITI: pos dan neg HARUS berbeda setiap hari sesuai isi chat, JANGAN copy-paste angka yang sama
- topics = array of 3-5 topik dominan (format: "emoji Judul topik"), bahasa Indonesia
- pos_examples = max 5 contoh pesan positif (KUTIP PERSIS dari chat yang ditampilkan, sertakan username)
- neg_examples = max 5 contoh pesan negatif (KUTIP PERSIS dari chat yang ditampilkan, sertakan username)
- Jika tidak ada pesan, pos=0, neg=0, topics=[], pos_examples=[], neg_examples=[]
- Chat market biasa = NETRAL, tapi TETAP masuk topics
- Jawab HANYA dengan JSON, tidak ada teks lain`;

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
