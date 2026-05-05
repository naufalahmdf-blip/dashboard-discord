import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

const { data, error } = await sb
  .from('dashboard_users')
  .select('id, email, role, created_at')
  .order('id');

if (error) {
  console.error('ERROR:', error.message);
  process.exit(1);
}

if (!data || data.length === 0) {
  console.log('(tidak ada user di tabel dashboard_users)');
  process.exit(0);
}

console.log(`\nTotal: ${data.length} user\n`);
for (const u of data) {
  console.log(`#${u.id}  ${u.email.padEnd(40)} role=${u.role}  created=${u.created_at?.slice(0, 10) || '-'}`);
}
