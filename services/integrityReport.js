// services/integrityReport.js — what an admin should look at before approving a reward.
// A flag is a reason to look, not proof of cheating.
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const cleanIp = (ip) => String(ip || '').replace(/^::ffff:/, '').trim();

function buildIntegrityReport({ students, chapters, reviews, payouts, attempts, logins, centreIps = [], maxAttempts = 3, fastMs = 4000 }) {
  const who = new Map(students.map((s) => [s.id, s]));
  const num = new Map(chapters.map((c) => [c.id, c.number]));
  const rewardStatus = new Map(payouts.map((p) => [p.student_id + '|' + p.label, p.status]));

  const tests = reviews
    .filter((r) => who.has(r.student_id))
    .map((r) => {
      const s = who.get(r.student_id);
      const chapter = num.get(r.chapter_id);
      const used = r.attempts || 0;
      const locked = !r.passed && used >= maxAttempts + (r.extra_attempts || 0);
      const flags = [];
      if (r.passed && used >= 2) flags.push('Passed on attempt ' + used);
      if (locked) flags.push('Out of tries');
      return {
        student_id: r.student_id, chapter_id: r.chapter_id, name: s.full_name, guest: /^guest/i.test(s.cohort || ''),
        chapter, score_percent: r.score_percent, passed: !!r.passed, attempts: used, completed_at: r.completed_at,
        reward: rewardStatus.get(r.student_id + '|Chapter ' + chapter + ' review') || null, locked, flags,
      };
    })
    .sort((a, b) => String(b.completed_at || '').localeCompare(String(a.completed_at || '')));

  const times = new Map();
  for (const a of attempts) {
    if (a.response_time_ms == null || !who.has(a.student_id)) continue;
    if (!times.has(a.student_id)) times.set(a.student_id, []);
    times.get(a.student_id).push(a.response_time_ms);
  }
  const fast = [];
  for (const [id, list] of times) {
    const m = median(list);
    if (list.length >= 8 && m < fastMs) fast.push({ name: who.get(id).full_name, answers: list.length, median_seconds: Math.round(m / 100) / 10 });
  }
  fast.sort((a, b) => a.median_seconds - b.median_seconds);

  const skip = new Set(centreIps.map(cleanIp));
  const byIp = new Map();
  for (const l of logins) {
    const ip = cleanIp(l.last_ip);
    if (!ip || skip.has(ip) || !who.has(l.student_id)) continue;
    if (!byIp.has(ip)) byIp.set(ip, new Map());
    const m = byIp.get(ip);
    if (!m.has(l.student_id)) m.set(l.student_id, new Set());
    m.get(l.student_id).add(String(l.log_date).slice(0, 10));
  }
  const shared = [];
  for (const [ip, m] of byIp) {
    if (m.size < 2) continue;
    shared.push({ ip, students: [...m.keys()].map((id) => who.get(id).full_name), days: [...new Set([...m.values()].flatMap((d) => [...d]))].sort() });
  }

  return { tests, locked: tests.filter((t) => t.locked), fast, shared };
}

module.exports = { buildIntegrityReport };
