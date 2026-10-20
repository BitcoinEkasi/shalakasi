// services/supabase.js
// Single shared database client. Always uses the service_role key — this
// backend is the only thing that ever talks to the database directly;
// students never hold database credentials. RLS on every table is
// defense-in-depth, not the primary access control.
//
// Two modes, chosen by one environment variable:
//   • Supabase (default):  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   • Self-hosted:         POSTGREST_URL + SUPABASE_SERVICE_ROLE_KEY
//     (PostgREST running on the same server in front of our own Postgres;
//      see deploy/README.md). Same client, same queries — only the address
//      changes. Remove POSTGREST_URL to go straight back to Supabase.

const { createClient } = require('@supabase/supabase-js');

const selfHosted = !!process.env.POSTGREST_URL;
const url = selfHosted ? process.env.POSTGREST_URL : process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.warn(
    '[stack-and-study] SUPABASE_URL (or POSTGREST_URL) / SUPABASE_SERVICE_ROLE_KEY not set — set them in .env before starting the server.'
  );
}

const options = { auth: { persistSession: false } };

if (selfHosted) {
  // supabase-js talks to <url>/rest/v1/...; a bare PostgREST serves at <url>/...
  options.global = {
    fetch: (input, init) => {
      const target = typeof input === 'string' ? input : input.url;
      return fetch(target.replace('/rest/v1/', '/'), init);
    },
  };
}

const supabase = createClient(url, serviceKey, options);
supabase.selfHosted = selfHosted;

module.exports = supabase;
