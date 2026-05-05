import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAdmin } from '../../lib/auth.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FALLBACK_PATH = path.resolve(__dirname, '../../prompts/sentiment-rate.md');
const BUCKET = 'app-data';
const OBJECT = 'sentiment-rate.md';
const MAX_BYTES = 1_000_000;

let bucketEnsured = false;
async function ensureBucket() {
  if (bucketEnsured) return;
  const { data, error } = await sb.storage.getBucket(BUCKET);
  if (error && (error.statusCode === '404' || error.statusCode === 404 || /not found/i.test(error.message || ''))) {
    const { error: createErr } = await sb.storage.createBucket(BUCKET, { public: false });
    if (createErr && !/already exists/i.test(createErr.message || '')) {
      throw new Error(`Gagal membuat bucket ${BUCKET}: ${createErr.message}`);
    }
  } else if (error) {
    throw new Error(`Gagal cek bucket ${BUCKET}: ${error.message}`);
  }
  bucketEnsured = true;
}

export default async function handler(req, res) {
  const u = requireAdmin(req, res);
  if (!u) return;

  if (req.method === 'GET') {
    try {
      await ensureBucket();
      const { data, error } = await sb.storage.from(BUCKET).download(OBJECT);
      if (data) {
        const content = await data.text();
        // Best-effort timestamp via list()
        let updatedAt = null;
        try {
          const { data: list } = await sb.storage.from(BUCKET).list('', { limit: 100 });
          const found = (list || []).find(f => f.name === OBJECT);
          updatedAt = found?.updated_at || found?.created_at || null;
        } catch { /* ignore */ }
        return res.json({ content, updatedAt, source: 'storage', length: content.length });
      }
      // Storage miss → fallback to bundled file
      if (error && !/not.*found|object.*not|404/i.test(error.message || '')) {
        return res.status(500).json({ error: error.message });
      }
      try {
        const content = fs.readFileSync(FALLBACK_PATH, 'utf8');
        return res.json({ content, updatedAt: null, source: 'file', length: content.length });
      } catch {
        return res.status(404).json({ error: 'Masterfile belum di-upload dan file bundled tidak ditemukan' });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === 'POST') {
    try {
      const { content } = req.body || {};
      if (typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ error: 'content harus string non-empty' });
      }
      if (Buffer.byteLength(content, 'utf8') > MAX_BYTES) {
        return res.status(413).json({ error: `Masterfile terlalu besar (max ${MAX_BYTES.toLocaleString()} bytes)` });
      }
      await ensureBucket();
      const { error } = await sb.storage.from(BUCKET).upload(OBJECT, Buffer.from(content, 'utf8'), {
        contentType: 'text/markdown; charset=utf-8',
        upsert: true,
      });
      if (error) return res.status(500).json({ error: error.message });
      return res.json({ ok: true, length: content.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
