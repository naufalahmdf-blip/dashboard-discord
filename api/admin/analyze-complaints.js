import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { requireAdmin } from '../../lib/auth.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CONTEXT_EXAMPLES = `
CONTOH NEGATIF (KELUHAN ke TWS/Suli — HARUS diklasifikasi):
- "Waktu bull gembar gembor, live publik 2x seminggu, marketing kenceng, Sekarang ngilang"
- "king suli afk? tinggal ngitung waktu, semua fitur yg di janjiin gagal deliver"
- "mending vote refund aja dibanding kalian sakit hati terus"
- "Bukannya evaluasi, malah ngatain member"
- "dari otl lu udah invalid terus wkwkwk"
- "Niat hati masuk kelas mau profit malah banyak minusnya"
- "Jualan kelas jualan taik"
- "Gila yaa bayar mahal mahal malah members nya yg perform"
- "Aku juga korban 150"
- "suli gapernah update jir kemana ya?"

CONTOH POSITIF/NETRAL (JANGAN diklasifikasi sebagai keluhan):
- "Semangat sampai 2030"
- "Gw masih hold soalnya percaya fundamental"
- "Congrats yang sudah tetap setia ikut call suli, 3 calls winstreak"
- "salut ama ko jonathan, sisi positifnya konsisten"
- Diskusi market biasa (BTC dump, pump, short, long)
`.trim();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const user = requireAdmin(req, res);
  if (!user) return;

  const { categories, keywords, messages: clientMessages } = req.body || {};
  if (!categories?.length) {
    return res.status(400).json({ error: 'categories required' });
  }

  try {
    let sample;

    if (clientMessages && clientMessages.length > 0) {
      // Messages passed from frontend (legacy)
      sample = clientMessages.slice(0, 400);
    } else if (keywords && keywords.length > 0) {
      // Server-side: fetch from chat_messages and filter by keywords
      const log = [];
      let allFiltered = [];

      // Use SQL ILIKE to filter server-side (much faster than fetching all)
      const orFilter = keywords.slice(0, 20).map(kw => `content.ilike.%${kw}%`).join(',');

      const { data: msgs, error } = await sb
        .from('chat_messages')
        .select('username, msg_datetime, content')
        .or(orFilter)
        .neq('content', 'EMPTY')
        .neq('content', '')
        .order('msg_datetime', { ascending: false })
        .limit(1000);

      if (error) {
        return res.status(500).json({ error: `Fetch error: ${error.message}` });
      }

      allFiltered = (msgs || []).map(m => ({
        date: m.msg_datetime ? m.msg_datetime.split('T')[0] : '',
        username: m.username || '',
        content: m.content || '',
      }));

      sample = allFiltered.slice(0, 400);
    } else {
      return res.status(400).json({ error: 'keywords or messages required' });
    }

    if (sample.length === 0) {
      return res.json({ ok: true, categories: categories.map(c => ({ theme: c.theme, messages: [] })), filtered: 0 });
    }

    const catList = categories.map((c, i) => `${i + 1}. ${c.theme}`).join('\n');
    const msgText = sample.map((m, i) =>
      `[${i + 1}] ${m.date} @${m.username}: ${m.content}`
    ).join('\n');

    const prompt = `Kamu adalah analis komunitas Discord trading crypto Indonesia bernama TWS (The Wolf of Street).

${CONTEXT_EXAMPLES}

Berikut ${sample.length} pesan yang MUNGKIN mengandung keluhan:

${msgText}

Kategori keluhan yang tersedia:
${catList}

TUGAS:
1. Tentukan apakah setiap pesan BENAR keluhan terhadap TWS/Suli (bukan diskusi market biasa)
2. Jika YA, klasifikasikan ke salah satu kategori di atas
3. Jika BUKAN keluhan (positif/netral/diskusi market), JANGAN masukkan

Output JSON:
{
  "classifications": [
    {"index": 1, "category": "nama kategori PERSIS"},
    {"index": 5, "category": "nama kategori PERSIS"}
  ]
}

PENTING:
- Hanya masukkan pesan yang BENAR-BENAR keluhan ke TWS/Suli
- Diskusi market, analisis teknikal, meme = BUKAN keluhan
- Index harus sesuai nomor pesan di atas
- Jawab HANYA dengan JSON`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });

    const result = JSON.parse(completion.choices[0].message.content);
    if (!result.classifications) return res.status(500).json({ error: 'AI response missing classifications' });

    const classMap = {};
    result.classifications.forEach(c => { classMap[c.index] = c.category; });

    const grouped = {};
    categories.forEach(c => { grouped[c.theme] = []; });

    for (let i = 0; i < sample.length; i++) {
      const cat = classMap[i + 1];
      if (cat && grouped[cat] !== undefined) {
        grouped[cat].push({
          date: sample[i].date || '',
          username: sample[i].username || '',
          content: sample[i].content || '',
        });
      }
    }

    const categoriesResult = categories.map(c => ({
      theme: c.theme,
      messages: grouped[c.theme] || [],
    }));

    res.json({ ok: true, categories: categoriesResult, filtered: sample.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
