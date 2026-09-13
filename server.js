// server.js — ShalaKasi backend
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const supabase = require('./services/supabase');
const { decideNextStep } = require('./services/aiEngine');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '2mb' }));

// API responses must never be cached — a stale cached /api/curriculum
// response (e.g. showing an old review_passed:false) is exactly the
// kind of bug that would make a student look like they're stuck
// re-doing a chapter review they already passed.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  },
}));

const JWT_SECRET = process.env.JWT_SECRET || 'shalakasi-dev-secret-change-me';
const MASTERY_THRESHOLD = 0.75;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts — please wait a few minutes and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests — please wait a few minutes.' },
});
const adminKeyFailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  skipSuccessfulRequests: true,
  message: { error: 'Too many failed admin key attempts — please wait a few minutes.' },
});

// ---------------------------------------------------------
// AUTH MIDDLEWARE
// ---------------------------------------------------------
function requireStudent(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    req.student = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired — please log in again' });
  }
}

function requireAdmin(req, res, next) {
  const provided = req.headers['x-admin-key'];
  if (!provided || provided !== (process.env.ADMIN_KEY || 'ekasi-admin-change-me')) {
    return res.status(401).json({ error: 'Admin key required' });
  }
  next();
}

// Local (SAST-ish) calendar date string, not UTC — a login at 23:50 SAST
// shouldn't get logged against the wrong day just because UTC has already
// rolled over. Uses the server's local timezone; set TZ=Africa/Johannesburg
// in the environment if the host machine's default timezone differs.
function todayLocalDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------
// AUTH
// ---------------------------------------------------------
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const { data: student, error } = await supabase
    .from('students')
    .select('*')
    .eq('username', username)
    .eq('active', true)
    .single();

  if (error || !student || !bcrypt.compareSync(password, student.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = jwt.sign({ id: student.id, username: student.username }, JWT_SECRET, { expiresIn: '8h' });

  // Record attendance — one row per student per calendar day. First login
  // of the day creates it; any later logins that same day just bump the
  // count and last_login_at, so a student who logs out/in a few times
  // still only counts as "present" once for the register.
  const logDate = todayLocalDate();
  const { data: existing } = await supabase
    .from('attendance_log')
    .select('id, login_count')
    .eq('student_id', student.id)
    .eq('log_date', logDate)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('attendance_log')
      .update({ last_login_at: new Date().toISOString(), login_count: existing.login_count + 1 })
      .eq('id', existing.id);
  } else {
    await supabase.from('attendance_log').insert({
      student_id: student.id,
      log_date: logDate,
    });
  }

  res.json({ token, student: { id: student.id, username: student.username, full_name: student.full_name } });
});

app.post('/api/auth/logout', requireStudent, (req, res) => {
  res.json({ ok: true });
});

// ---------------------------------------------------------
// CURRICULUM + PROGRESS
// ---------------------------------------------------------

app.get('/api/curriculum', requireStudent, async (req, res) => {
  const { data: chapters } = await supabase.from('chapters').select('*').order('sort_order');
  const { data: sections } = await supabase.from('sections').select('*').order('sort_order');
  const { data: progress } = await supabase
    .from('student_progress')
    .select('*')
    .eq('student_id', req.student.id);
  const { data: reviews } = await supabase
    .from('chapter_reviews')
    .select('chapter_id, passed, score_percent')
    .eq('student_id', req.student.id);

  const progressBySection = Object.fromEntries((progress || []).map((p) => [p.section_id, p]));
  const reviewByChapter = Object.fromEntries((reviews || []).map((r) => [r.chapter_id, r]));

  const tree = (chapters || []).map((ch) => ({
    ...ch,
    review_completed: !!reviewByChapter[ch.id],
    review_passed: !!reviewByChapter[ch.id]?.passed,
    review_score_percent: reviewByChapter[ch.id]?.score_percent ?? null,
    sections: (sections || [])
      .filter((s) => s.chapter_id === ch.id)
      .map((s) => ({
        id: s.id,
        number: s.number,
        title: s.title,
        has_activity: s.has_activity,
        activity_title: s.activity_title,
        status: progressBySection[s.id]?.status || 'locked',
        mastery_score: progressBySection[s.id]?.mastery_score || 0,
      })),
  }));

  res.json({ chapters: tree });
});

app.get('/api/book', requireStudent, async (req, res) => {
  const { data: chapters } = await supabase.from('chapters').select('*').order('sort_order');
  const { data: sections } = await supabase
    .from('sections')
    .select('id, chapter_id, number, title, activity_title, content_md, sort_order')
    .order('sort_order');

  const tree = (chapters || []).map((ch) => ({
    number: ch.number,
    title: ch.title,
    sections: (sections || [])
      .filter((s) => s.chapter_id === ch.id)
      .map((s) => ({
        number: s.number,
        title: s.title,
        activity_title: s.activity_title,
        content_md: s.content_md,
      })),
  }));

  res.json({ chapters: tree });
});

app.get('/api/sections/:id', requireStudent, async (req, res) => {
  const { data: section, error } = await supabase
    .from('sections')
    .select('*, chapters(number, title)')
    .eq('id', req.params.id)
    .single();

  if (error || !section) return res.status(404).json({ error: 'Section not found' });

  const { data: quiz } = await supabase
    .from('quiz_bank')
    .select('id, question, options, difficulty')
    .eq('section_id', section.id);

  await supabase.from('student_progress').upsert(
    {
      student_id: req.student.id,
      section_id: section.id,
      status: 'in_progress',
      last_updated: new Date().toISOString(),
    },
    { onConflict: 'student_id,section_id', ignoreDuplicates: false }
  );

  res.json({ section, quiz: quiz || [] });
});

app.post('/api/sections/:id/complete', requireStudent, async (req, res) => {
  const { data: quiz } = await supabase.from('quiz_bank').select('id').eq('section_id', req.params.id);
  if (quiz && quiz.length) {
    return res.status(400).json({ error: 'This section has checkpoint questions — use /attempt instead.' });
  }

  await supabase.from('student_progress').upsert(
    {
      student_id: req.student.id,
      section_id: req.params.id,
      status: 'mastered',
      mastery_score: 1,
      last_updated: new Date().toISOString(),
    },
    { onConflict: 'student_id,section_id' }
  );

  res.json({ ok: true });
});

// ---------------------------------------------------------
// CHAPTER REVIEW — a cumulative test pulling together every
// checkpoint question from every section in a chapter, shown once
// a student has mastered all of that chapter's sections. This is
// mandatory to attempt (it's what gates moving to the next chapter
// on the client), but the score itself doesn't block progress —
// it's a reflection/reinforcement tool, not a hard wall.
// ---------------------------------------------------------

app.get('/api/chapters/:id/review', requireStudent, async (req, res) => {
  const { data: chapter, error: chErr } = await supabase
    .from('chapters')
    .select('id, number, title')
    .eq('id', req.params.id)
    .single();
  if (chErr || !chapter) return res.status(404).json({ error: 'Chapter not found' });

  const { data: sections } = await supabase.from('sections').select('id, number').eq('chapter_id', chapter.id);
  const sectionIds = (sections || []).map((s) => s.id);

  const { data: questions } = await supabase
    .from('quiz_bank')
    .select('id, question, options, section_id, sections(number)')
    .in('section_id', sectionIds);

  const shaped = (questions || []).map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options,
    section_number: q.sections?.number,
  }));

  res.json({ chapter: { id: chapter.id, number: chapter.number, title: chapter.title }, questions: shaped });
});

// Grades one question at a time, stateless — no DB write here. This
// mirrors the per-section checkpoint's immediate feedback without
// polluting the main attempts/mastery tables with review-time answers.
app.post('/api/chapters/:id/review/answer', requireStudent, async (req, res) => {
  const { quizId, selectedIndex } = req.body;
  const { data: quizItem } = await supabase.from('quiz_bank').select('correct_index').eq('id', quizId).single();
  if (!quizItem) return res.status(404).json({ error: 'Question not found' });
  res.json({ isCorrect: quizItem.correct_index === selectedIndex, correctIndex: quizItem.correct_index });
});

// Records the final tally once the student has gone through every
// question. score_percent is computed client-side across the review
// session — trusted the same way quizIndex sequencing already is
// elsewhere in this app; the stakes here are pedagogical, not financial.
app.post('/api/chapters/:id/review/complete', requireStudent, async (req, res) => {
  const { score_percent } = req.body;
  if (typeof score_percent !== 'number' || score_percent < 0 || score_percent > 100) {
    return res.status(400).json({ error: 'Invalid score_percent' });
  }
  const passed = score_percent >= 70;

  await supabase.from('chapter_reviews').upsert(
    {
      student_id: req.student.id,
      chapter_id: req.params.id,
      score_percent,
      passed,
      completed_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,chapter_id' }
  );

  // Sats reward payment intentionally disabled for now — re-enable by
  // restoring services/blinkPayment.js and the payment block here once
  // BITCOINEKASI_SUPABASE_URL / BITCOINEKASI_SUPABASE_SERVICE_ROLE_KEY /
  // BLINK_API_KEY are actually configured.
  const reward = null;

  res.json({ passed, score_percent, reward });
});

app.post('/api/sections/:id/attempt', requireStudent, async (req, res) => {
  const { quizId, selectedIndex, responseTimeMs } = req.body;
  const sectionId = req.params.id;

  const { data: quizItem } = await supabase.from('quiz_bank').select('*').eq('id', quizId).single();
  if (!quizItem) return res.status(404).json({ error: 'Question not found' });

  const isCorrect = quizItem.correct_index === selectedIndex;

  await supabase.from('attempts').insert({
    student_id: req.student.id,
    quiz_id: quizId,
    selected_index: selectedIndex,
    is_correct: isCorrect,
    response_time_ms: responseTimeMs || null,
  });

  const { data: sectionQuizIds } = await supabase.from('quiz_bank').select('id').eq('section_id', sectionId);
  const ids = (sectionQuizIds || []).map((q) => q.id);
  const { data: allAttempts } = await supabase
    .from('attempts')
    .select('is_correct')
    .eq('student_id', req.student.id)
    .in('quiz_id', ids);

  const total = allAttempts?.length || 1;
  const correctCount = (allAttempts || []).filter((a) => a.is_correct).length;
  const scorePercent = Math.round((correctCount / total) * 100);
  const masteryScore = scorePercent / 100;

  const newStatus = masteryScore >= MASTERY_THRESHOLD ? 'mastered' : 'reinforced';
  await supabase.from('student_progress').upsert(
    {
      student_id: req.student.id,
      section_id: sectionId,
      status: newStatus,
      mastery_score: masteryScore,
      last_updated: new Date().toISOString(),
    },
    { onConflict: 'student_id,section_id' }
  );

  let decision = null;
  const { data: allSections } = await supabase.from('sections').select('*').order('sort_order');
  const orderedIndex = (allSections || []).findIndex((s) => s.id === sectionId);

  if (orderedIndex !== -1) {
    decision = await decideNextStep({
      studentId: req.student.id,
      sectionId,
      scorePercent,
      allSections,
      orderedIndex,
    });
  }

  res.json({ isCorrect, correctIndex: quizItem.correct_index, scorePercent, decision });
});

// ---------------------------------------------------------
// ADMIN
// ---------------------------------------------------------
app.use('/api/admin', adminLimiter);

app.post('/api/admin/students', requireAdmin, adminKeyFailLimiter, async (req, res) => {
  const { username, password, full_name, cohort } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: 'username, password, full_name required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const password_hash = bcrypt.hashSync(password, 10);
  const { data, error } = await supabase
    .from('students')
    .insert({ username, password_hash, full_name, cohort, created_by: 'admin' })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ id: data.id, username: data.username, full_name: data.full_name });
});

app.patch('/api/admin/students/:id/password', requireAdmin, adminKeyFailLimiter, async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  const password_hash = bcrypt.hashSync(password, 10);
  const { error } = await supabase.from('students').update({ password_hash }).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

app.get('/api/admin/students', requireAdmin, async (req, res) => {
  const { data: students } = await supabase
    .from('students')
    .select('id, username, full_name, cohort, active, created_at')
    .order('created_at', { ascending: false });
  res.json(students || []);
});

app.get('/api/admin/students/:id/decisions', requireAdmin, async (req, res) => {
  const { data } = await supabase
    .from('ai_decisions')
    .select('*, from:sections!ai_decisions_from_section_id_fkey(number,title), to:sections!ai_decisions_to_section_id_fkey(number,title)')
    .eq('student_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(30);
  res.json(data || []);
});

app.get('/api/admin/curriculum', requireAdmin, async (req, res) => {
  const { data: chapters } = await supabase.from('chapters').select('*').order('sort_order');
  const { data: sections } = await supabase.from('sections').select('*').order('sort_order');
  const tree = (chapters || []).map((ch) => ({
    ...ch,
    sections: (sections || []).filter((s) => s.chapter_id === ch.id),
  }));
  res.json({ chapters: tree });
});

app.get('/api/admin/students/:id/progress', requireAdmin, async (req, res) => {
  const { data } = await supabase
    .from('student_progress')
    .select('section_id, status, mastery_score, attempts_count, last_updated')
    .eq('student_id', req.params.id);
  res.json(data || []);
});

app.get('/api/admin/students/:id/chat', requireAdmin, async (req, res) => {
  const { data } = await supabase
    .from('chat_log')
    .select('role, message, created_at, sections(number, title)')
    .eq('student_id', req.params.id)
    .order('created_at', { ascending: false })
    .limit(100);
  res.json(data || []);
});

// Enrolment agreement — the signed liability waiver / media release /
// POPIA consent, one record per student. Contains real personal
// information (ID numbers, DOB, contact details), admin-only access.
app.get('/api/admin/students/:id/enrolment', requireAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from('enrolment_agreements')
    .select('*')
    .eq('student_id', req.params.id)
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data || null);
});

app.post('/api/admin/students/:id/enrolment', requireAdmin, async (req, res) => {
  const {
    signer_full_name, signer_id_number, signer_contact_number,
    participant_full_name, participant_dob,
    part_a_accepted, part_a_signature, part_a_signature_image, part_a_date,
    part_b_accepted, part_b_signature, part_b_signature_image, part_b_date,
  } = req.body;

  if (!signer_full_name || !signer_id_number || !signer_contact_number) {
    return res.status(400).json({ error: 'Signer full name, ID number, and contact number are required' });
  }

  const { data, error } = await supabase
    .from('enrolment_agreements')
    .upsert(
      {
        student_id: req.params.id,
        signer_full_name, signer_id_number, signer_contact_number,
        participant_full_name: participant_full_name || null,
        participant_dob: participant_dob || null,
        part_a_accepted: !!part_a_accepted,
        part_a_signature: part_a_signature || null,
        part_a_signature_image: part_a_signature_image || null,
        part_a_date: part_a_date || null,
        part_b_accepted: !!part_b_accepted,
        part_b_signature: part_b_signature || null,
        part_b_signature_image: part_b_signature_image || null,
        part_b_date: part_b_date || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'student_id' }
    )
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// The attendance register — defaults to today, or pass ?date=YYYY-MM-DD
// for any other day. Returns every student who logged in that day.
app.get('/api/admin/attendance', requireAdmin, async (req, res) => {
  const date = req.query.date || todayLocalDate();

  const { data: records, error } = await supabase
    .from('attendance_log')
    .select('student_id, first_login_at, last_login_at, login_count, students(full_name, username, cohort)')
    .eq('log_date', date)
    .order('first_login_at', { ascending: true });

  if (error) return res.status(400).json({ error: error.message });

  res.json({ date, present: records || [] });
});

// A simple date-range summary — how many days each student has attended,
// useful for spotting who's falling behind on showing up at all.
app.get('/api/admin/attendance/summary', requireAdmin, async (req, res) => {
  const { data: records, error } = await supabase
    .from('attendance_log')
    .select('student_id, log_date, students(full_name, username)');

  if (error) return res.status(400).json({ error: error.message });

  const byStudent = {};
  (records || []).forEach((r) => {
    const key = r.student_id;
    if (!byStudent[key]) {
      byStudent[key] = { student_id: key, full_name: r.students?.full_name, username: r.students?.username, days_present: 0, dates: [] };
    }
    byStudent[key].days_present += 1;
    byStudent[key].dates.push(r.log_date);
  });

  res.json(Object.values(byStudent).sort((a, b) => b.days_present - a.days_present));
});

// Program-level impact dashboard — cohort-wide numbers for reporting
// upward (steering committee, funders), not per-student classroom detail.
app.get('/api/admin/impact', requireAdmin, async (req, res) => {
  const [
    { data: students },
    { data: chapters },
    { data: sections },
    { data: progress },
    { data: attempts },
    { count: chatMessageCount },
  ] = await Promise.all([
    supabase.from('students').select('id, active').eq('active', true),
    supabase.from('chapters').select('id, number, title').order('sort_order'),
    supabase.from('sections').select('id, chapter_id, number, title').order('sort_order'),
    supabase.from('student_progress').select('student_id, section_id, status'),
    supabase.from('attempts').select('quiz_id, is_correct'),
    supabase.from('chat_log').select('id', { count: 'exact', head: true }),
  ]);

  const totalStudents = (students || []).length;
  const totalSections = (sections || []).length;

  // Overall completion: average, across all active students, of
  // (sections mastered / total sections in the curriculum).
  const masteredByStudent = {};
  (progress || []).forEach((p) => {
    if (p.status === 'mastered') {
      masteredByStudent[p.student_id] = (masteredByStudent[p.student_id] || 0) + 1;
    }
  });
  const completionPercents = (students || []).map((s) => {
    const mastered = masteredByStudent[s.id] || 0;
    return totalSections ? (mastered / totalSections) * 100 : 0;
  });
  const avgCompletionPercent = completionPercents.length
    ? Math.round(completionPercents.reduce((a, b) => a + b, 0) / completionPercents.length)
    : 0;

  // Per-chapter funnel: average % of that chapter's sections mastered,
  // across all active students — shows where the cohort collectively
  // slows down or drops off.
  const sectionsByChapter = {};
  (sections || []).forEach((s) => {
    if (!sectionsByChapter[s.chapter_id]) sectionsByChapter[s.chapter_id] = [];
    sectionsByChapter[s.chapter_id].push(s.id);
  });

  const masteredSectionSet = new Set(
    (progress || []).filter((p) => p.status === 'mastered').map((p) => `${p.student_id}:${p.section_id}`)
  );

  const chapterFunnel = (chapters || []).map((ch) => {
    const sectionIds = sectionsByChapter[ch.id] || [];
    if (!sectionIds.length || !totalStudents) return { number: ch.number, title: ch.title, avg_percent: 0 };
    let totalMastered = 0;
    (students || []).forEach((s) => {
      sectionIds.forEach((secId) => {
        if (masteredSectionSet.has(`${s.id}:${secId}`)) totalMastered += 1;
      });
    });
    const possible = sectionIds.length * totalStudents;
    return { number: ch.number, title: ch.title, avg_percent: Math.round((totalMastered / possible) * 100) };
  });

  // Toughest sections: lowest first-look correct rate, only counting
  // questions with a meaningful number of attempts (avoids one lucky/
  // unlucky guess looking like a real pattern).
  const attemptStatsByQuiz = {};
  (attempts || []).forEach((a) => {
    if (!attemptStatsByQuiz[a.quiz_id]) attemptStatsByQuiz[a.quiz_id] = { total: 0, correct: 0 };
    attemptStatsByQuiz[a.quiz_id].total += 1;
    if (a.is_correct) attemptStatsByQuiz[a.quiz_id].correct += 1;
  });

  const { data: quizItems } = await supabase.from('quiz_bank').select('id, question, section_id, sections(number, title)');
  const toughestSections = (quizItems || [])
    .map((q) => {
      const stats = attemptStatsByQuiz[q.id];
      if (!stats || stats.total < 3) return null;
      return {
        section_number: q.sections?.number,
        section_title: q.sections?.title,
        question: q.question,
        correct_rate: Math.round((stats.correct / stats.total) * 100),
        attempts: stats.total,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.correct_rate - b.correct_rate)
    .slice(0, 5);

  res.json({
    total_students: totalStudents,
    avg_completion_percent: avgCompletionPercent,
    total_checkpoint_attempts: (attempts || []).length,
    total_chat_messages: chatMessageCount || 0,
    chapter_funnel: chapterFunnel,
    toughest_sections: toughestSections,
  });
});

const PORT = process.env.PORT || 3300;
app.listen(PORT, () => console.log(`ShalaKasi running on http://localhost:${PORT}`));
