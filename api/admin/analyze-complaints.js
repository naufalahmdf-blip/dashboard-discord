import OpenAI from 'openai';
import { requireAdmin } from '../../lib/auth.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Context examples from curated positive/negative dataset
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
- "Bruh, suli bilang kalo bear dia akan kasih tau langsung membernya, tapi skrg dia cashout 50% aja diem diem"
- "Aku juga korban 150"
- "Duit member Di pake buat jajan lcc"
- "Jualan hope kepada orang miskin adalah bisnis yang mumpuni"
- "suli gapernah update jir kemana ya?"
- "call lah sul, sepi banget"
- "bnyak bre lulusan sini, udh buka clas juga, polanya kek ketua"

CONTOH POSITIF/NETRAL (JANGAN diklasifikasi sebagai keluhan):
- "Semangat sampai 2030"
- "Gw masih hold soalnya percaya fundamental"
- "hype strong"
- "Congrats yang sudah tetap setia ikut call suli, 3 calls winstreak"
- "salut ama ko jonathan, sisi positifnya konsisten"
- "tws banyak bantu gue juga buat refine cara baca market"
- "tq king sl pindah BEP"
- "Mantap king"
- "harus bersyukur masi ada yang mau ngajarin"
- Diskusi market biasa (BTC dump, pump, short, long)
- Analisis teknikal tanpa keluhan
`.trim();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const user = requireAdmin(req, res);
  if (!user) return;

  const { categories, messages } = req.body || {};
  if (!categories?.length || !messages?.length) {
    return res.status(400).json({ error: 'categories and messages required' });
  }

  try {
    const catList = categories.map((c, i) => `${i + 1}. ${c.theme}`).join('\n');
    const sample = messages.slice(0, 400);
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

    // Map index → category name
    const classMap = {};
    result.classifications.forEach(c => { classMap[c.index] = c.category; });

    // Group messages by category
    const grouped = {};
    categories.forEach(c => { grouped[c.theme] = []; });

    for (let i = 0; i < sample.length; i++) {
      const cat = classMap[i + 1];
      if (cat && grouped[cat] !== undefined) {
        const msg = sample[i];
        grouped[cat].push({
          date: msg.date || '',
          username: msg.username || '',
          content: msg.content || '',
          is_recent: false,
        });
      }
    }

    const categoriesResult = categories.map(c => ({
      theme: c.theme,
      messages: grouped[c.theme] || [],
    }));

    res.json({ ok: true, categories: categoriesResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
