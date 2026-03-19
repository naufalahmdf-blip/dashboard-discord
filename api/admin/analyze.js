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

TUGAS 1 - SENTIMEN: hitung PERSENTASE pesan yang POSITIF dan NEGATIF terhadap TWS/Suli/komunitas.
Hitung dari SEMUA pesan (total messages count tertulis di header), bukan hanya sample. Sample hanya untuk referensi konteks.

DEFINISI PENTING:
- POSITIF = pesan yang SECARA SPESIFIK apresiasi/support/terima kasih ke TWS/Suli/Jonathan/ketua/king/modul/kelas/komunitas. HARUS ada kaitan dengan TWS/Suli/komunitas.
- NEGATIF = pesan yang SECARA SPESIFIK mengeluh/kecewa/menyerang TWS/Suli/Jonathan/ketua/komunitas. HARUS ada kaitan dengan TWS/Suli/komunitas.
- NETRAL = SEMUA sisanya. Diskusi market, analisis TA, optimisme BTC, hype coin, cuan/loss dari trading sendiri, "GM", "GN", basa-basi. Ini BUKAN positif meskipun nadanya senang.

KUNCI: Baik POSITIF maupun NEGATIF harus TENTANG TWS/Suli/komunitas. Senang karena BTC naik = NETRAL. Senang karena call Suli profit = POSITIF.

=== REFERENSI KALIMAT POSITIF (apresiasi/support ke TWS/Suli/komunitas) ===
Gunakan contoh-contoh ini sebagai ACUAN. POSITIF = pesan yang memuji/berterima kasih/support TWS/Suli/Jonathan/komunitas:
- "Udah ges gua udah puas klo sul minta maaf"
- "harus bersyukur masi ada yang mau ngajarin"
- "Suli lagi menyala"
- "Congrats yang sudah tetap setia ikut call suli, 3 calls winstreak"
- "Gw udh brapa x kena SL Suli ampe jiper, tp ya thats life, gak tiap x Suli call i jg ikut, its our choice. Kl mau ikut ya siap rugi."
- "itu tinggal masalah mm bang, klo down 45% tapi masuknya 5 persen, sama naik 7% tapi masuknya 50% duid, masih ada untung bersih 35%"
- "gw yakin si sebenernya banyak yang jago member disini, cuma ketutup roasting aja wkwk"
- "tq king sl pindah BEP"
- "Banyak banget analis di sini"
- "Thats alliright brother, u did a great job"
- "....tapi msh sering nntn ulang modulnya"
- "Jujur, tws banyak bantu gue juga buat refine cara baca market. Jadi ini bukan cuma gue kasih outlook, tapi semacam bentuk terima kasih juga buat tws"
- "Mangats gez"
- "Mantap king"
- "salut ama ko jonathan, sisi positifnya konsisten"
- "Iya kita appreciate you and others yg share your hearts here. God bless all bros and sis"
- "Gas LONG BTC kalau udah otl dari legend, tinggal tunggu waktu capai target"
- "mantap emang king gw ini"
- "nice setup bro, roi nya gacor. ku setuju TP di area itu karena psikologi number"

=== CONTOH NETRAL (JANGAN hitung sebagai positif/negatif) ===
Ini NETRAL meskipun nadanya positif/optimis, karena TIDAK tentang TWS/Suli:
- "hype strong" → NETRAL (hype market, bukan tentang TWS)
- "happy short" → NETRAL (senang dari trading sendiri)
- "Saatnya pump?" → NETRAL (prediksi market)
- "pump 80k soon" → NETRAL (prediksi harga)
- "hype to the moon" → NETRAL (hype market)
- "Saatnya rebound" → NETRAL (prediksi market)
- "Go btc 79" → NETRAL (target harga)
- "Lets go 72K" → NETRAL (target harga)
- "gw cut profit 4977" → NETRAL (profit trading sendiri, bukan dari call TWS)
- "Untung masih short" → NETRAL (profit trading sendiri)
- "GM", "GN" → NETRAL (basa-basi)

=== REFERENSI KALIMAT NEGATIF (keluhan/kecewa ke TWS/Suli) ===
Gunakan contoh-contoh ini sebagai ACUAN untuk mengenali sentimen negatif. Kalimat yang MIRIP nada/polanya = NEGATIF:
- "Waktu bull gembar gembor, live publik 2x seminggu, marketing kenceng, Sekarang ngilang. Parah banget aku rasa TWS disaat seperti ini."
- "king suli afk? tinggal ngitung waktu, semua fitur yg di janjiin gagal deliver satu per satu"
- "Awas bang penyepongnya banyak, mw salah pun dibela"
- "mending vote refund aja dibanding kalian sakit hati terus"
- "Lu punya komunitas, punya banyak sekali member yg ngikutin lu. Seharusnya lebih bijak dalam berucap dan bergerak. Evaluasi lagi bro, banyak yg dijanjikan tidak terpenuhi."
- "Bukannya evaluasi, malah ngatain member"
- "disaat sinyal kuu joss distu aku akan yapping, disaat sinyalku invalid distu aku akan diam"
- "Intinya BTC dump ke 40K babe"
- "wkwkwkk lucu banget ketua yapping kembali"
- "kemakan omongan bocah"
- "mana ni extended cycle?"
- "bikin jualan dia ga laku, mungkin dia akan mau ngobrol disini"
- "ExTenDeD CyCLe"
- "dari awal lu emang udah salah tapi gak mau ngaku"
- "dari otl lu udah invalid terus wkwkwk dari btc 100,90,80 skrng di undur lagi jadi 70 sampai 50"
- "Long diwaktu yg salah, short pas lagi sange sangenya"
- "Kalau gak brani buka copy trade, Ya sdh kalau salah OTL ngaku salah"
- "Katanya bukan bear tapi short sampe 50k, Lalu namanya apa ketua"
- "Jadi intinya gua beli modulnya seharga 15 Juta ok thanks"
- "bnyak bre lulusan sini, udh buka clas juga, polanya kek ketua"
- "Niat hati masuk kelas mau profit malah banyak minusnya"
- "knp ga dari awal ya di share porto pribadi seperti apa? ngomongnya selalu bullish tapi ternyata 50% cash"
- "I agree with this as well. smalam gw jujur sangat dissapointed"
- "dngar dngar kelas marketing bree cara jualan kelas dengan hope yang kira kira masuk di indonesia"
- "Jualan kelas jualan taik"
- "Duit member Di pake buat jajan lcc"
- "Lu mamam tuh 100K"
- "Postingan2 kek gini tampil mulu Yg fomo langsung asal masuk padahal narasi nya masi bearish"
- "call lah sul, sepi banget"
- "Lagi sibuk urus laporan polisi bro, jangan tambah beban pikiran"
- "suli gapernah update jir kemana ya?"
- "Suli lagi bullish pasti haha"
- "Orang pada ketahan di 126k ga ada yg nyuruh cash out"
- "hilang cuci duit di ntt"
- "si suli tu kayak pemerintah konoha gak bakalan dengerin rakyat susah"
- "Udah lah spill real porto udah dari jaman kapan, cma mitos itu mah"
- "Jualan hope kepada orang miskin adalah bisnis yang mumpuni"
- "Engga lah bro, ga mungkin ketua salah. Itu editan AI paling. Ketua wining rate 80% dan smua member untung bersama TWS. Bismillah dpt Reffund double"
- "Aku juga korban 150"
- "di band bungkam tp minimal kasih OTL apapun. ini udah ancuran porto"
- "Bang udah bang, kita member pura pura bego aja lah"
- "disini bias bro, semua news yang di ambil cherrypicked juga"
- "kalopun ada indikator yang bearish gabakal di share"
- "waktu itu suli bilang kalo bear dia akan kasih tau langsung membernya, tapi skrg dia cashout 50% aja diem diem"
- "i dont expect anything here from them tbh"
- "Gila yaa bayar mahal mahal malah members nya yg perform"
- "Coba kalau suli call $PUNCH/SOL, Klo bear 4 tahun floating minus BTC, bisa pakai jurus terupdate"

=== REFERENSI KALIMAT NEGATIF sudah di atas ===

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

PENTING — BACA BAIK-BAIK:
- pos = % pesan yang APRESIASI/SUPPORT TWS/Suli/Jonathan/komunitas dari TOTAL pesan hari itu. HARUS tentang TWS/Suli.
- neg = % pesan yang KELUHAN/KECEWA ke TWS/Suli/Jonathan/komunitas dari TOTAL pesan hari itu. HARUS tentang TWS/Suli.
- Diskusi market biasa (hype, pump, TA, profit trading sendiri) = NETRAL, bukan positif.
- POSITIF biasanya LEBIH BESAR dari NEGATIF karena member yang support lebih banyak dari yang complain.
- HARD LIMIT: pos MAKSIMAL 5.0%, neg MAKSIMAL 5.0%. Tidak boleh melebihi 5%. Biasanya pos 0.5-3%, neg 0-1.5%. Hari tanpa drama: pos 0.5-2%, neg 0-0.3%.
- HITUNG TELITI: pos dan neg HARUS berbeda setiap hari sesuai isi chat, JANGAN copy-paste angka yang sama
- POSITIF = apresiasi/support/terima kasih SPESIFIK ke TWS/Suli/Jonathan/ketua/king/modul/kelas/komunitas
- NEGATIF = keluhan/kecewa/serang SPESIFIK ke TWS/Suli/Jonathan/ketua/king/modul/kelas/komunitas
- Optimisme market, hype coin, profit dari trading sendiri = NETRAL, BUKAN positif
- topics = array of 3-5 topik dominan (format: "emoji Judul topik"), bahasa Indonesia
- pos_examples = max 5 contoh pesan positif (KUTIP PERSIS dari chat, sertakan username). HARUS tentang TWS/Suli/komunitas.
- neg_examples = max 5 contoh pesan negatif (KUTIP PERSIS dari chat, sertakan username). HARUS tentang TWS/Suli/komunitas.
- JANGAN masukkan pesan yang sama ke examples di hari berbeda. Setiap hari HARUS contoh UNIK dari chat hari itu saja.
- Jika hari itu tidak ada pesan tentang TWS/Suli → pos=0, neg=0, pos_examples=[], neg_examples=[]
- Jika ragu positif atau netral → NETRAL (hanya count yang JELAS tentang TWS/Suli)
- Jika ragu negatif atau netral → NETRAL (hanya count yang JELAS tentang TWS/Suli)
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
        const pos = Math.min(parseFloat(day.pos) || 0, 5.0);
        const neg = Math.min(parseFloat(day.neg) || 0, 5.0);
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
