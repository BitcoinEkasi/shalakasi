// services/bookStorage.js
// Where postgrad book PDFs live.
//   • Self-hosted mode (POSTGREST_URL set): a folder on this server
//     (BOOKS_DIR, default /opt/shalakasi/books). Students open a book through
//     a short-lived signed link, so the folder is never public.
//   • Otherwise: Supabase Storage bucket 'postgrad-books', as before.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const supabase = require('./supabase');

const BUCKET = 'postgrad-books';
const BOOKS_DIR = process.env.BOOKS_DIR || '/opt/shalakasi/books';
const SECRET = process.env.JWT_SECRET || 'shalakasi-dev-secret-change-me';
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function localMode() { return supabase.selfHosted; }

function sign(name, exp) {
  return crypto.createHmac('sha256', SECRET).update(`${name}.${exp}`).digest('hex');
}

function localPath(name) {
  if (!SAFE_NAME.test(name) || name.includes('..')) throw new Error('Bad file name');
  return path.join(BOOKS_DIR, name);
}

async function upload(name, buffer) {
  if (!localMode()) {
    const { error } = await supabase.storage.from(BUCKET).upload(name, buffer, { contentType: 'application/pdf' });
    return { error };
  }
  try {
    fs.mkdirSync(BOOKS_DIR, { recursive: true });
    fs.writeFileSync(localPath(name), buffer);
    return { error: null };
  } catch (e) {
    return { error: { message: e.message } };
  }
}

async function remove(name) {
  if (!name) return;
  if (!localMode()) { await supabase.storage.from(BUCKET).remove([name]); return; }
  try { fs.unlinkSync(localPath(name)); } catch (e) { /* already gone */ }
}

// Returns { url, error } — a link that works for ttlSeconds.
async function signedUrl(name, ttlSeconds) {
  if (!localMode()) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(name, ttlSeconds);
    return { url: data?.signedUrl || null, error };
  }
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { url: `/api/postgrad/file/${encodeURIComponent(name)}?e=${exp}&s=${sign(name, exp)}`, error: null };
}

// Express handler for the self-hosted signed link.
function serveSigned(req, res) {
  const name = req.params.name;
  const exp = parseInt(req.query.e, 10);
  const sig = String(req.query.s || '');
  if (!SAFE_NAME.test(name) || !exp || exp < Math.floor(Date.now() / 1000)) return res.status(403).json({ error: 'Link expired' });
  const good = sign(name, exp);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) {
    return res.status(403).json({ error: 'Bad link' });
  }
  const file = localPath(name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File not found' });
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', 'inline');
  res.sendFile(file);
}

module.exports = { upload, remove, signedUrl, serveSigned };
