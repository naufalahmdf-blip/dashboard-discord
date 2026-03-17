import bcrypt from 'bcryptjs';
import { sb, requireAdmin } from '../../lib/auth.js';

export default async function handler(req, res) {
  const user = requireAdmin(req, res);
  if (!user) return;

  // GET — list all users
  if (req.method === 'GET') {
    const { data, error } = await sb.from('dashboard_users').select('id, email, role, created_at').order('id');
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  }

  // POST — create user
  if (req.method === 'POST') {
    try {
      const { email, password, role } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib diisi' });
      const hash = await bcrypt.hash(password, 10);
      const { error } = await sb.from('dashboard_users').insert({
        email: email.toLowerCase().trim(),
        password_hash: hash,
        role: role || 'user',
      });
      if (error) return res.status(400).json({ error: error.message.includes('duplicate') ? 'Email sudah terdaftar' : error.message });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // PUT — update user
  if (req.method === 'PUT') {
    try {
      const { id, email, role, password } = req.body;
      if (!id) return res.status(400).json({ error: 'ID wajib' });
      const updates = {};
      if (email) updates.email = email.toLowerCase().trim();
      if (role) updates.role = role;
      if (password) updates.password_hash = await bcrypt.hash(password, 10);
      if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'Tidak ada perubahan' });
      const { error } = await sb.from('dashboard_users').update(updates).eq('id', Number(id));
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // DELETE — remove user
  if (req.method === 'DELETE') {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'ID wajib' });
    if (Number(id) === user.userId) return res.status(400).json({ error: 'Tidak bisa hapus akun sendiri' });
    const { error } = await sb.from('dashboard_users').delete().eq('id', Number(id));
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  return res.status(405).end();
}
