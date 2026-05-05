// Bikin admin baru di tabel dashboard_users.
// Pakai SUPABASE_SERVICE_KEY → bypass RLS.
//
// Cara pakai:
//   node scripts/create-admin.js <email> <password> [role]
//
// Contoh:
//   node scripts/create-admin.js naufalahmdf@orovagroup.id passwordkuat123 admin

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const [, , emailArg, passwordArg, roleArg] = process.argv;

if (!emailArg || !passwordArg) {
  console.error('USAGE: node scripts/create-admin.js <email> <password> [role]');
  console.error('       role default = admin');
  process.exit(1);
}

const email = emailArg.toLowerCase().trim();
const password = passwordArg;
const role = (roleArg || 'admin').toLowerCase();

if (password.length < 6) {
  console.error('Password minimal 6 karakter.');
  process.exit(1);
}
if (!['admin', 'user'].includes(role)) {
  console.error(`Role harus 'admin' atau 'user' (input: ${role}).`);
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY tidak ada di env. Cek .env kamu.');
  process.exit(1);
}

const sb = createClient(url, key);
const password_hash = await bcrypt.hash(password, 10);

// Upsert: kalau email sudah ada → update password & role. Kalau belum → insert baru.
const { data: existing } = await sb
  .from('dashboard_users')
  .select('id, email, role')
  .eq('email', email)
  .maybeSingle();

if (existing) {
  const { error } = await sb
    .from('dashboard_users')
    .update({ password_hash, role })
    .eq('id', existing.id);
  if (error) {
    console.error('UPDATE error:', error.message);
    process.exit(1);
  }
  console.log(`✓ Password & role di-reset untuk user lama: ${email} (role=${role})`);
} else {
  const { error } = await sb
    .from('dashboard_users')
    .insert({ email, password_hash, role });
  if (error) {
    console.error('INSERT error:', error.message);
    process.exit(1);
  }
  console.log(`✓ Admin baru dibuat: ${email} (role=${role})`);
}

console.log('\nLogin di dashboard:');
console.log(`  Email   : ${email}`);
console.log(`  Password: ${password}`);
