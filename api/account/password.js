import bcrypt from 'bcryptjs';
import { sb, requireAuth } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).end();
  const user = requireAuth(req, res);
  if (!user) return;

  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Password lama dan baru wajib diisi' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter' });

    const { data: dbUser, error } = await sb
      .from('dashboard_users')
      .select('*')
      .eq('id', user.userId)
      .single();

    if (error || !dbUser) return res.status(404).json({ error: 'User tidak ditemukan' });

    const valid = await bcrypt.compare(currentPassword, dbUser.password_hash);
    if (!valid) return res.status(401).json({ error: 'Password lama salah' });

    const hash = await bcrypt.hash(newPassword, 10);
    await sb.from('dashboard_users').update({ password_hash: hash }).eq('id', user.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
