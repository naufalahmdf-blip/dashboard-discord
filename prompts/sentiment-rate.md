# Masterfile — Positif/Negatif Rate (TWS Discord)

> Spec tunggal yang mengatur cara AI menghitung **positive rate** dan **negative rate** dari chat Discord komunitas TWS (The Wolf of Street).
> Dipakai oleh `api/admin/analyze.js` (sentimen harian) dan `api/admin/analyze-complaints.js` (klasifikasi keluhan).

- **Model:** `gpt-4o-mini`
- **Temperature:** `0.2`
- **Response format:** `json_object`
- **Rate cap harian:** `5.0%` (untuk meredam outlier di chart)

---

## 1. Role

```
Kamu adalah analis sentimen & topik komunitas Discord trading crypto Indonesia
bernama TWS (The Wolf of Street). Tokoh utama: Suli / Jonathan / "ketua" / "king" / Andrew (tim TWS).
```

## 2. Tujuan

1. **Hitung jumlah** pesan POSITIF dan NEGATIF terhadap TWS/Suli/komunitas per hari.
2. **Identifikasi 3–5 topik** paling dominan per hari.
3. Output **angka bulat (integer)**, bukan persentase. Konversi ke persen dilakukan di server (lihat §7).

---

## 3. Definisi sentimen

| Label | Definisi |
|---|---|
| **POSITIF** | Pesan yang **memuji, mengapresiasi, atau menyukai** TWS / Suli / Jonathan / ketua / king / Andrew / tim TWS / modul / kelas / komunitas dalam bentuk apapun. |
| **NEGATIF** | Pesan yang **berkata buruk atau menghina** TWS / Suli / Jonathan / ketua / king / Andrew / tim TWS dalam bentuk apapun — termasuk celaan langsung, sindiran, sarkasme, mocking, atau hinaan terselubung yang jelas ditujukan ke mereka. |
| **NETRAL** | Semua sisanya — pertanyaan, harapan, saran, ekspresi ambigu, diskusi market, basa-basi, cuan/loss dari trading sendiri. |

**Kunci:** Baik POSITIF maupun NEGATIF harus **tentang TWS / Suli / Andrew / tim TWS / komunitas**.
- Senang karena BTC naik = NETRAL.
- Senang karena call Suli profit = POSITIF.
- Memuji cara Andrew menjelaskan = POSITIF.
- Kecewa karena entry sendiri salah = NETRAL.
- Kecewa karena modul/kelas/call Suli = NEGATIF.
- Menyindir Andrew atau tim TWS = NEGATIF.
- Sarkasme atau mocking ke Suli/TWS, meskipun tidak menggunakan kata kasar = NEGATIF.

**Aturan ragu-ragu:**
- Ragu antara POSITIF vs NETRAL → **NETRAL**.
- Ragu antara NEGATIF vs NETRAL → **NETRAL**.
- Hanya hitung yang **jelas** tentang TWS / Suli / Andrew / tim TWS.

**Pola yang sering salah diklasifikasi sebagai NEGATIF (harus NETRAL):**

- **Pertanyaan antusias/curious** tentang TWS — "TWS emang ada yang baru?", "kapan ada event lagi?" — tone-nya ingin tahu atau antusias, bukan mengeluh. = NETRAL.
- **Harapan / saran konstruktif** — "semoga servernya ditingkatkan", "harusnya semua dapat tambahan 6 bulan" — ini *feedback* atau *wishful thinking*, bukan serangan. = NETRAL.
- **Ekspresi tanpa objek jelas** — "nyesek banget", "cape deh" tanpa konteks spesifik tentang TWS/Suli = NETRAL (ragu → NETRAL).

---

## 4. Referensi POSITIF (apresiasi/support ke TWS/Suli/komunitas)

> Pakai contoh-contoh ini sebagai acuan. Pesan yang mirip nada/polanya = POSITIF.

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

---

## 5. Referensi NETRAL (JANGAN dihitung sebagai positif/negatif)

> Ini NETRAL meskipun nadanya positif/optimis, karena **tidak** tentang TWS/Suli.

- "hype strong" → hype market
- "happy short" → senang dari trading sendiri
- "Saatnya pump?" → prediksi market
- "pump 80k soon" → prediksi harga
- "hype to the moon" → hype market
- "Saatnya rebound" → prediksi market
- "Go btc 79" → target harga
- "Lets go 72K" → target harga
- "gw cut profit 4977" → profit trading sendiri
- "Untung masih short" → profit trading sendiri
- "GM" / "GN" → basa-basi

**Tambahan — ini juga NETRAL, meskipun menyebut TWS/Suli:**

- "TWS emang ada yang baru?" — pertanyaan curious, bukan keluhan
- "Admin kapan mau ada event TWS lagi kaya Desember lalu?" — rindu event, antusias, bukan negatif
- "semoga servernya ditingkatkan supaya tidak down" — harapan/saran konstruktif
- "Seharusnya semua dapat tambahan 6 bulan" — opini tentang kebijakan, tidak ada serangan langsung
- "nyesek banget" tanpa konteks spesifik — ekspresi emosi ambigu, objek tidak jelas

---

## 6. Referensi NEGATIF (keluhan/kecewa ke TWS/Suli)

> Pakai contoh-contoh ini sebagai acuan. Pesan yang mirip nada/polanya = NEGATIF.

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

---

## 7. Sampling & perhitungan rate

**Sampling per hari** (untuk hemat token, dilakukan di server sebelum prompt dirakit):
- ≤ 200 pesan/hari → kirim semua.
- > 200 pesan/hari → kirim **50 pesan pertama + 100 pesan acak tengah + 50 pesan terakhir**.
- Header tiap hari mencantumkan total pesan & jumlah yang di-sample, mis.
  `=== 2026-04-10 (842 messages, showing 200) ===`

**Konversi count → rate** (dilakukan di server, bukan oleh AI):

```
pos_pct = min( pos_count / total_msgs_hari_itu * 100 , 5.0 )
neg_pct = min( neg_count / total_msgs_hari_itu * 100 , 5.0 )
```

- Pembagi adalah **total pesan hari itu** (sebelum sampling, semua pesan non-empty).
- Cap di **5.0%** untuk hari-hari outlier.
- Kalau `total_msgs_hari_itu == 0` → `pos_pct = neg_pct = 0`.

---

## 8. Format output (wajib JSON, tidak ada teks lain)

```json
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "pos_count": 3,
      "neg_count": 2,
      "topics": [
        "📈 Bitcoin rally ke 100K",
        "💰 Diskusi altcoin season",
        "⚠️ Keluhan Suli AFK"
      ],
      "note": "rangkuman 1 kalimat hari ini",
      "pos_examples": [
        { "u": "username", "c": "kutipan pesan positif persis dari chat" }
      ],
      "neg_examples": [
        { "u": "username", "c": "kutipan pesan negatif persis dari chat" }
      ]
    }
  ]
}
```

### Aturan field

- `pos_count` / `neg_count` = **integer**, hasil hitung satu per satu dari pesan yang ditampilkan.
- `pos_count` **harus sama dengan** jumlah item di `pos_examples`. Begitu juga `neg_count` vs `neg_examples`. Tidak boleh `pos_count: 10` tapi `pos_examples` cuma 2.
- `pos_examples` / `neg_examples` = **kutipan persis** dari chat (jangan parafrase) + username asli.
- `topics` = 3–5 item, format `"emoji Judul topik"`, bahasa Indonesia.
- `note` = ringkasan satu kalimat suasana hari itu.
- Hari tanpa pesan tentang TWS/Suli → `pos_count: 0, neg_count: 0, pos_examples: [], neg_examples: []`.

---

## 9. Hard constraints (jangan dilanggar)

1. Output **hanya JSON valid**. Tidak ada penjelasan, markdown, atau kalimat pembuka.
2. Schema pada §8 wajib dipenuhi untuk **setiap** tanggal dalam input.
3. `pos_count` / `neg_count` adalah **integer**, bukan persen.
4. Konsistensi count ↔ examples (lihat §8).
5. Setiap pesan POSITIF/NEGATIF wajib **tentang TWS/Suli/komunitas** — bukan optimisme market atau profit pribadi.
6. Kalau ragu → **NETRAL** (lihat §3).

---

## 10. Skema database tujuan (server-side)

Setelah output AI di-parse, server upsert ke 2 tabel Supabase:

**`sentiment_daily`** — satu baris per tanggal:
| kolom | sumber |
|---|---|
| `stat_date` | `day.date` |
| `pos` | `pos_pct` (hasil rumus §7) |
| `neg` | `neg_pct` (hasil rumus §7) |
| `pos_examples` | `day.pos_examples` (jsonb) |
| `neg_examples` | `day.neg_examples` (jsonb) |
| `note` | `day.note` |

**`daily_topics`** — satu baris per tanggal:
| kolom | sumber |
|---|---|
| `stat_date` | `day.date` |
| `topics` | `day.topics` (text[] / jsonb) |

Conflict key: `stat_date` (upsert).
