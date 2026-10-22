// services/trackerRewards.js — hands Stack & Study rewards to the Attendance Tracker, which approves and pays them
// together with the attendance sats, and asks it back whether each one has been paid.
// Does nothing unless TRACKER_URL and TRACKER_KEY are set. Every call is safe to repeat: the tracker ignores a reward it already has.
const supabase = require('./supabase');

function conf() {
  const url = process.env.TRACKER_URL, key = process.env.TRACKER_KEY;
  return url && key ? { url, key } : null;
}

async function call(method, path, body) {
  const c = conf();
  if (!c) return null;
  const res = await fetch(`${c.url}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Integration-Key': c.key },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`tracker answered ${res.status}`);
  return res.json();
}

// Send every reward of this student that the tracker has not got yet. Rewards the tracker cannot match to a student stay here.
async function syncUnsent(studentId) {
  if (!conf()) return;
  const { data } = await supabase
    .from('payouts')
    .select('id, kind, label, amount_sats, students(full_name)')
    .eq('student_id', studentId).eq('status', 'pending').eq('sent_to_tracker', false);
  for (const p of data || []) {
    try {
      const r = await call('POST', '/integrations/stack-reward', {
        ref: p.id, name: p.students?.full_name, kind: p.kind, label: p.label, amount_sats: p.amount_sats,
      });
      if (r?.matched) await supabase.from('payouts').update({ sent_to_tracker: true }).eq('id', p.id);
    } catch (e) { console.log('[rewards] could not send to tracker:', e.message); }
  }
}

// Copy "paid" / "rejected" back from the tracker onto this student's rewards that are still waiting here.
async function refreshStatuses(studentId) {
  if (!conf()) return;
  const { data } = await supabase
    .from('payouts').select('id').eq('student_id', studentId).eq('status', 'pending').eq('sent_to_tracker', true);
  const ids = (data || []).map((p) => p.id);
  if (!ids.length) return;
  try {
    const rows = await call('GET', `/integrations/stack-reward-status?refs=${ids.join(',')}`);
    for (const r of rows || []) {
      if (r.status === 'paid' || r.status === 'rejected') {
        await supabase.from('payouts')
          .update({ status: r.status, decided_at: new Date().toISOString() })
          .eq('id', r.ref).eq('status', 'pending');
      }
    }
  } catch (e) { console.log('[rewards] could not read tracker status:', e.message); }
}

module.exports = { syncUnsent, refreshStatuses };
