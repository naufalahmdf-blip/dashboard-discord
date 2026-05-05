// Diagnostik login — cek satu per satu kenapa login gagal.
// Pakai: node scripts/diag-login.js

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const TEST_EMAIL = 'discord@orovagroup.id';
const TEST_PASSWORD = 'discord123234';

console.log('\n=== DIAGNOSTIK LOGIN ===\n');

// 1. Cek env
const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_KEY;
const svc = process.env.SUPABASE_SERVICE_KEY;
const port = process.env.PORT;

console.log('[1] Cek .env:');
console.log('    SUPABASE_URL         =', url || '❌ KOSONG');
console.log('    SUPABASE_KEY         =', anon ? `${anon.slice(0, 20)}... (len ${anon.length})` : '❌ KOSONG');
console.log('    SUPABASE_SERVICE_KEY =', svc ? `${svc.slice(0, 20)}... (len ${svc.length})` : '❌ KOSONG');
console.log('    PORT                 =', port || '(default 3001)');

if (!url || !anon) {
  console.log('\n❌ FATAL: .env belum lengkap. Stop.');
  process.exit(1);
}

// 2. Cek koneksi Supabase
console.log('\n[2] Test koneksi Supabase...');
const sb = createClient(url, svc || anon);
try {
  const { data, error, count } = await sb.from('dashboard_users').select('*', { count: 'exact' });
  if (error) {
    console.log('    ❌ Query error:', error.message);
    console.log('    → URL/KEY mungkin salah, atau tabel dashboard_users belum ada');
    process.exit(1);
  }
  console.log(`    ✓ Konek. Tabel dashboard_users punya ${count} baris.`);
  if (data && data.length > 0) {
    console.log('    Isi tabel:');
    data.forEach(u => console.log(`      #${u.id} ${u.email} (${u.role}) hash_len=${u.password_hash?.length || 0}`));
  } else {
    console.log('    ⚠ Tabel kosong! Insert user dulu via SQL Editor.');
    process.exit(1);
  }
} catch (err) {
  console.log('    ❌ Network error:', err.message);
  console.log('    → URL salah atau project Supabase down');
  process.exit(1);
}

// 3. Cek user spesifik
console.log(`\n[3] Cari user "${TEST_EMAIL}"...`);
const { data: user, error: userErr } = await sb
  .from('dashboard_users')
  .select('*')
  .eq('email', TEST_EMAIL.toLowerCase().trim())
  .single();

if (userErr || !user) {
  console.log('    ❌ User tidak ditemukan:', userErr?.message || 'no rows');
  console.log('    → Run SQL insert dulu di Supabase SQL Editor.');
  process.exit(1);
}
console.log(`    ✓ Ketemu: id=${user.id}, role=${user.role}, hash_len=${user.password_hash?.length}`);

// 4. Test bcrypt compare
console.log(`\n[4] Test bcrypt password "${TEST_PASSWORD}"...`);
const valid = await bcrypt.compare(TEST_PASSWORD, user.password_hash);
if (valid) {
  console.log('    ✓ Password MATCH! Login harusnya bisa.');
  console.log('\n=== SEMUA OK — kalau di browser masih gagal, server belum restart. ===');
} else {
  console.log('    ❌ Password TIDAK MATCH.');
  console.log('    Hash di DB tidak cocok dengan password yang ditest.');
  console.log('    → Re-run SQL insert dengan password benar:');
  console.log(`       crypt('${TEST_PASSWORD}', gen_salt('bf', 10))`);
}
