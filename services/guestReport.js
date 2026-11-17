// services/guestReport.js — the progress report for guest accounts (cohort starting with "guest").
// Pure function: give it the rows, get the report back, so it can be tested without a database.

// A section counts as done once it has been finished, right or wrong ("mastered" or "reinforced").
const DONE = new Set(['mastered', 'reinforced']);

function buildGuestReport({ students = [], chapters = [], sections = [], progress = [], reviews = [], logins = [] }) {
  const chaptersSorted = chapters.slice().sort((a, b) => (a.sort_order ?? a.number) - (b.sort_order ?? b.number));
  const sectionsByChapter = new Map();
  for (const s of sections) {
    if (!sectionsByChapter.has(s.chapter_id)) sectionsByChapter.set(s.chapter_id, []);
    sectionsByChapter.get(s.chapter_id).push(s);
  }

  const doneBy = new Map(); // student_id -> Set(section_id)
  for (const p of progress) {
    if (!DONE.has(p.status)) continue;
    if (!doneBy.has(p.student_id)) doneBy.set(p.student_id, new Set());
    doneBy.get(p.student_id).add(p.section_id);
  }
  const reviewBy = new Map(); // `${student}:${chapter}` -> review row
  for (const r of reviews) reviewBy.set(`${r.student_id}:${r.chapter_id}`, r);
  const lastLogin = new Map(); // student_id -> latest last_login_at
  for (const l of logins) {
    const cur = lastLogin.get(l.student_id);
    if (!cur || new Date(l.last_login_at) > new Date(cur)) lastLogin.set(l.student_id, l.last_login_at);
  }

  const totalSections = sections.length;
  return students.map((st) => {
    const done = doneBy.get(st.id) || new Set();
    let currentChapter = null;
    let testsPassed = 0;
    const perChapter = chaptersSorted.map((ch) => {
      const secs = sectionsByChapter.get(ch.id) || [];
      const secDone = secs.filter((s) => done.has(s.id)).length;
      const rv = reviewBy.get(`${st.id}:${ch.id}`) || null;
      if (rv && rv.passed) testsPassed += 1;
      if (!currentChapter && secs.length && (secDone < secs.length || !(rv && rv.passed))) currentChapter = ch.number;
      return {
        number: ch.number,
        title: ch.title,
        sections_done: secDone,
        sections_total: secs.length,
        test: rv ? { passed: !!rv.passed, score_percent: rv.score_percent, attempts: rv.attempts, completed_at: rv.completed_at } : null,
      };
    });
    return {
      id: st.id,
      full_name: st.full_name,
      username: st.username,
      cohort: st.cohort,
      active: st.active,
      created_at: st.created_at,
      last_login_at: lastLogin.get(st.id) || null,
      sections_done: done.size,
      sections_total: totalSections,
      percent: totalSections ? Math.round((done.size / totalSections) * 100) : 0,
      tests_passed: testsPassed,
      tests_total: chaptersSorted.length,
      current_chapter: currentChapter, // null once every chapter is finished and passed
      chapters: perChapter,
    };
  });
}

module.exports = { buildGuestReport };
