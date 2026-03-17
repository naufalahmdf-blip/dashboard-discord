import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import adminUpload from './api/admin/upload.js';
import adminAnalyze from './api/admin/analyze.js';
import adminManual from './api/admin/manual.js';
import adminAnalyzeComplaints from './api/admin/analyze-complaints.js';
import adminChatData from './api/admin/chat-data.js';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

// ---- Supabase (server-side only) ----
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Shadow accounts loaded from DB (shadow_accounts table)

// ---- Body parser ----
app.use(express.json({ limit: '50mb' }));

// ---- Serve Vite build in production ----
app.use(express.static(path.join(__dirname, 'dist')));

// ---- Auth: login + verify ----
app.post('/api/auth', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib diisi' });
    const { data: user, error } = await sb.from('dashboard_users').select('*').eq('email', email.toLowerCase().trim()).single();
    if (error || !user) return res.status(401).json({ error: 'Email atau password salah' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Email atau password salah' });
    const token = jwt.sign({ email: user.email, role: user.role, userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, email: user.email, role: user.role });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login gagal' });
  }
});

app.get('/api/auth', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ valid: false });
  try {
    const decoded = jwt.verify(auth.slice(7), JWT_SECRET);
    res.json({ valid: true, email: decoded.email, role: decoded.role });
  } catch {
    res.status(401).json({ valid: false });
  }
});

// ---- Auth middleware ----
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token expired' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ---- User management (admin only) ----
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await sb.from('dashboard_users').select('id, email, role, created_at').order('id');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email dan password wajib diisi' });
    const hash = await bcrypt.hash(password, 10);
    const { error } = await sb.from('dashboard_users').insert({ email: email.toLowerCase().trim(), password_hash: hash, role: role || 'user' });
    if (error) return res.status(400).json({ error: error.message.includes('duplicate') ? 'Email sudah terdaftar' : error.message });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
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
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'ID wajib' });
  if (Number(id) === req.user.userId) return res.status(400).json({ error: 'Tidak bisa hapus akun sendiri' });
  const { error } = await sb.from('dashboard_users').delete().eq('id', Number(id));
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---- Change own password (any logged-in user) ----
app.put('/api/account/password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Password lama dan baru wajib diisi' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
    const { data: user, error } = await sb.from('dashboard_users').select('*').eq('id', req.user.userId).single();
    if (error || !user) return res.status(404).json({ error: 'User tidak ditemukan' });
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Password lama salah' });
    const hash = await bcrypt.hash(newPassword, 10);
    await sb.from('dashboard_users').update({ password_hash: hash }).eq('id', req.user.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- API: single endpoint (all data computed from chat_messages) ----
app.get('/api/data', requireAuth, async (req, res) => {
  try {
    const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

    const [
      { data: rawMonthly, error: e1 },
      { data: rawDaily, error: e2 },
      { data: suliDaily, error: e3 },
      { data: jonDaily, error: e4 },
      { data: rawAllTime, error: e5 },
      { data: sentDaily, error: e6 },
      { data: complaintCats, error: e7 },
      { data: complaintMsgs, error: e8 },
      { data: dailyTopicsRaw, error: e9 },
      { data: storyArc, error: e10 },
      { data: rootCauses, error: e11 },
      { data: shadowAccounts, error: e12 },
    ] = await Promise.all([
      sb.from('mv_monthly_stats').select('*').order('month_key'),
      sb.from('mv_daily_stats').select('*').order('stat_date'),
      sb.from('mv_suli_daily').select('*').order('stat_date'),
      sb.from('mv_jon_daily').select('*').order('stat_date'),
      sb.from('mv_all_time_users').select('*').order('msgs', { ascending: false }),
      sb.from('sentiment_daily').select('*').order('stat_date'),
      sb.from('complaint_categories').select('*').order('sort_order'),
      sb.from('complaint_messages').select('*').order('msg_date', { ascending: false }),
      sb.from('daily_topics').select('*').order('stat_date'),
      sb.from('story_arc').select('*').order('sort_order'),
      sb.from('root_causes').select('*').order('sort_order'),
      sb.from('shadow_accounts').select('*').order('sort_order'),
    ]);

    const errors = [e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11, e12].filter(Boolean);
    if (errors.length > 0) {
      console.error('Supabase errors:', errors);
      return res.status(500).json({ error: 'Database query failed', details: errors });
    }

    // Build sentiment lookup map (daily only)
    const sdMap = {};
    (sentDaily || []).forEach(s => { sdMap[typeof s.stat_date === 'string' ? s.stat_date.slice(0, 10) : s.stat_date] = s; });

    // Monthly stats (for legacy/fallback)
    const monthlyStats = (rawMonthly || []).map(r => {
      const [y, m] = r.month_key.split('-');
      return {
        month_key: r.month_key,
        month: `${MN[parseInt(m, 10) - 1]} ${y.slice(2)}`,
        messages: Number(r.messages),
        users: Number(r.users),
      };
    });

    // Merge daily stats with sentiment
    const dailyStats = (rawDaily || []).map(r => {
      const dateStr = typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date;
      const sent = sdMap[dateStr] || {};
      return {
        stat_date: dateStr,
        messages: Number(r.messages),
        users: Number(r.users),
        pos: Number(sent.pos) || 0,
        neg: Number(sent.neg) || 0,
      };
    });

    // Format all-time users with period/active
    const allMonths = (rawAllTime || []).length > 0
      ? [...new Set((rawMonthly || []).map(r => r.month_key))].sort()
      : [];
    const recentMonths = new Set(allMonths.slice(-3));
    const allTimeUsers = (rawAllTime || []).map(r => {
      const fd = r.first_date, ld = r.last_date;
      const fmtD = (d) => {
        if (!d) return '';
        const s = typeof d === 'string' ? d : d.toISOString().slice(0, 10);
        const [y, m] = s.split('-');
        return `${MN[parseInt(m, 10) - 1]} ${y.slice(2)}`;
      };
      const lastMk = ld ? (typeof ld === 'string' ? ld.slice(0, 7) : ld.toISOString().slice(0, 7)) : '';
      return {
        username: r.username,
        msgs: Number(r.msgs),
        period: fd === ld ? fmtD(fd) : `${fmtD(fd)} – ${fmtD(ld)}`,
        months: Number(r.months),
        active: recentMonths.has(lastMk),
      };
    });

    res.json({
      monthlyStats,
      dailyStats,
      suliDaily: (suliDaily || []).map(r => ({ stat_date: typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date, msgs: Number(r.msgs) })),
      jonDaily: (jonDaily || []).map(r => ({ stat_date: typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date, msgs: Number(r.msgs) })),
      allTimeUsers,
      complaintCats: complaintCats || [],
      complaintMsgs: complaintMsgs || [],
      dailyTopics: (dailyTopicsRaw || []).map(r => ({ stat_date: typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date, topics: r.topics })),
      storyArc: storyArc || [],
      rootCauses: rootCauses || [],
      shadowAccounts: shadowAccounts || [],
    });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- API: custom date range (from chat_messages via RPC) ----
app.get('/api/custom-range', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  try {
    const { data, error } = await sb.rpc('get_user_stats', { from_date: from, to_date: to });
    if (error) return res.status(500).json({ error: error.message });
    res.json((data || []).map(r => ({ username: r.username, msgs: Number(r.msgs) })));
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- API: range data (direct from chat_messages, always fresh) ----
app.get('/api/range-data', requireAuth, async (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from and to required' });
  try {
    // Fetch sentiment + topics for the range
    const [
      { data: sentDaily },
      { data: topicsDaily },
    ] = await Promise.all([
      sb.from('sentiment_daily').select('*').gte('stat_date', from).lte('stat_date', to),
      sb.from('daily_topics').select('*').gte('stat_date', from).lte('stat_date', to).order('stat_date'),
    ]);
    const sdMap = {};
    (sentDaily || []).forEach(s => { sdMap[typeof s.stat_date === 'string' ? s.stat_date.slice(0, 10) : s.stat_date] = s; });

    const [
      { data: rawDaily, error: e1 },
      { data: rawSuli, error: e2 },
      { data: rawJon, error: e3 },
      { data: rawUsers, error: e4 },
    ] = await Promise.all([
      sb.rpc('get_daily_stats_range', { from_date: from, to_date: to }),
      sb.rpc('get_suli_daily_range', { from_date: from, to_date: to }),
      sb.rpc('get_jon_daily_range', { from_date: from, to_date: to }),
      sb.rpc('get_user_stats', { from_date: from, to_date: to }),
    ]);

    const errors = [e1, e2, e3, e4].filter(Boolean);
    if (errors.length > 0) {
      console.error('Range query errors:', errors);
      return res.status(500).json({ error: 'Range query failed', details: errors });
    }

    const dailyStats = (rawDaily || []).map(r => {
      const dateStr = typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date;
      const sent = sdMap[dateStr] || {};
      return {
        stat_date: dateStr,
        messages: Number(r.messages),
        users: Number(r.users),
        pos: Number(sent.pos) || 0,
        neg: Number(sent.neg) || 0,
      };
    });

    res.json({
      dailyStats,
      suliDaily: (rawSuli || []).map(r => ({ stat_date: typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date, msgs: Number(r.msgs) })),
      jonDaily: (rawJon || []).map(r => ({ stat_date: typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date, msgs: Number(r.msgs) })),
      topChatters: (rawUsers || []).map(r => ({ username: r.username, msgs: Number(r.msgs) })),
      dailyTopics: (topicsDaily || []).map(r => ({ stat_date: typeof r.stat_date === 'string' ? r.stat_date.slice(0, 10) : r.stat_date, topics: r.topics })),
    });
  } catch (err) {
    console.error('Range data error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---- Admin routes ----
app.post('/api/admin/upload', requireAuth, requireAdmin, adminUpload);
app.post('/api/admin/analyze', requireAuth, requireAdmin, adminAnalyze);
app.get('/api/admin/manual', requireAuth, requireAdmin, adminManual);
app.post('/api/admin/manual', requireAuth, requireAdmin, adminManual);
app.post('/api/admin/analyze-complaints', requireAuth, requireAdmin, adminAnalyzeComplaints);
app.get('/api/admin/chat-data', requireAuth, adminChatData);

// ---- SPA fallback ----
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ---- Listen only in local dev (not on Vercel) ----
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`API server running at http://localhost:${PORT}`);
  });
}

export default app;
