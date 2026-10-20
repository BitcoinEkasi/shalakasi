// Stack & Study — step 3: copy book PDFs from Supabase Storage to this server's disk.
// Run on the server, from the app folder, as root:
//   cd /opt/shalakasi/app && /opt/node22/bin/node deploy/03-copy-books.js
// Uses the Supabase keys still in .env (read-only on Supabase), writes to BOOKS_DIR.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const dir = process.env.BOOKS_DIR || '/opt/shalakasi/books';
const url = process.env.OLD_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.OLD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (process.env.POSTGREST_URL && !process.env.OLD_SUPABASE_URL) { console.error('Already switched to self-hosted; the old Supabase keys are in .env as OLD_*'); process.exit(1); }
(async () => {
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: books, error } = await sb.from('postgrad_books').select('title, storage_path').not('storage_path', 'is', null);
  if (error) throw error;
  fs.mkdirSync(dir, { recursive: true });
  let ok = 0, bad = 0;
  for (const b of books) {
    const { data, error: e } = await sb.storage.from('postgrad-books').download(b.storage_path);
    if (e || !data) { console.log('FAILED  ', b.title, '-', e?.message); bad++; continue; }
    const buf = Buffer.from(await data.arrayBuffer());
    fs.writeFileSync(path.join(dir, b.storage_path), buf);
    console.log('copied  ', b.title, `(${buf.length} bytes)`); ok++;
  }
  console.log(`Done: ${ok} copied, ${bad} failed, ${books.length} books with a PDF.`);
  if (bad) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
