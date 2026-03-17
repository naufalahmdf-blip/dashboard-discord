import bcrypt from 'bcryptjs';
import { sb, signToken, verifyToken } from '../lib/auth.js';

export default async function handler(req, res) {
  // GET /api/auth = verify token
  if (req.method === 'GET') {
    const decoded = verifyToken(req);
    if (!decoded) return res.status(401).json({ valid: false });
    return res.json({ valid: true, email: decoded.email, role: decoded.role });
  }

  // POST /api/auth = login
  if (req.method === 'POST') {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib diisi' });

      const { data: user, error } = await sb
        .from('dashboard_users')
        .select('*')
        .eq('email', email.toLowerCase().trim())
        .single();

      if (error || !user) return res.status(401).json({ error: 'Email atau password salah' });

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Email atau password salah' });

      const token = signToken({ email: user.email, role: user.role, userId: user.id });
      return res.json({ token, email: user.email, role: user.role });
    } catch (err) {
      console.error('Login error:', err);
      return res.status(500).json({ error: 'Login gagal' });
    }
  }

  return res.status(405).end();
}
