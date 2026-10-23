// server.js — Study & Stack backend
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const supabase = require('./services/supabase');
const quizMix = require('./services/quizMix');
const studyPlan = require('./services/studyPlan');
const trackerRewards = require('./services/trackerRewards');
const bookFiles = require('./services/bookStorage');
const { decideNextStep } = require('./services/aiEngine');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

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
const POSTGRAD_MASTERY_THRESHOLD = 0.75;
const REVIEW_PASS_PERCENT = 70;
// Sats rewards for progress (pending until an admin approves them).
const CHAPTER_PASS_SATS = parseInt(process.env.CHAPTER_PASS_SATS, 10) || 500;
const BOOK_PASS_SATS = parseInt(process.env.BOOK_PASS_SATS, 10) || 1000;

// Logs a reward as pending. Returns {sats, status:'pending'} only when a new
// reward was created; a student who already earned it gets null (paid once).
async function createPayoutIfNew(studentId, kind, refId, label, amountSats) {
  const { data: existing } = await supabase
    .from('payouts').select('id')
    .eq('student_id', studentId).eq('kind', kind).eq('ref_id', refId)
    .maybeSingle();
  if (existing) return null;
  const { error } = await supabase.from('payouts').insert({
    student_id: studentId, kind, ref_id: refId, label, amount_sats: amountSats,
  });
  if (error) { console.error('[payouts] could not log reward:', error.message); return null; }
  trackerRewards.syncUnsent(studentId).catch(() => {}); // hand it to the tracker; if that is down it is retried later
  return { sats: amountSats, status: 'pending' };
}

// Books stay in memory just long enough to stream to Supabase Storage —
// nothing is ever written to local disk on the server.
const bookUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') return cb(new Error('Only PDF files are accepted.'));
    cb(null, true);
  },
});

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
// Study pace: the most new sections a student can start in one week (Monday to Sunday, South African time).
// The limit begins on STUDY_WEEK1_START, which is also the first Monday of the two-week centre rotation.
// ---------------------------------------------------------
const SECTIONS_PER_WEEK = parseInt(process.env.SECTIONS_PER_WEEK, 10) || 3;
const STUDY_WEEK1_START = process.env.STUDY_WEEK1_START || '2026-11-02';

// Midnight (South African time) on the first Monday of the centre rotation.
function studyStartMs() { const [y, m, d] = STUDY_WEEK1_START.split('-').map(Number); return Date.UTC(y, m - 1, d) - 2 * 3600 * 1000; }

async function getPace(studentId) {
  const { data } = await supabase.from('student_progress').select('status, mastered_at').eq('student_id', studentId);
  const now = new Date();
  const pace = studyPlan.paceState(data || [], SECTIONS_PER_WEEK, now);
  if (now.getTime() < studyStartMs()) pace.blocked = false; // the limit has not started yet
  return pace;
}

// ---------------------------------------------------------
// Attendance tracker link: after a login, tell the tracker who logged in and from which address.
// Set TRACKER_URL and TRACKER_KEY in .env to turn this on; without them nothing is sent.
// ---------------------------------------------------------
function notifyTracker(name, ip, scheduledToday) {
  const url = process.env.TRACKER_URL, key = process.env.TRACKER_KEY;
  if (!url || !key) return;
  fetch(`${url}/integrations/stack-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Integration-Key': key },
    body: JSON.stringify({ name, ip: String(ip || '').replace(/^::ffff:/, ''), scheduled_today: scheduledToday }),
    signal: AbortSignal.timeout(4000),
  }).catch((e) => console.log('tracker notice failed:', e.message));
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

  // Tell the attendance tracker this student logged in (it decides if it was in class). Never blocks login.
  notifyTracker(student.full_name, req.ip, (Date.now() < studyStartMs() ? null : studyPlan.scheduledToday(student.study_group, new Date(), STUDY_WEEK1_START)));

  res.json({
    token,
    student: {
      id: student.id,
      username: student.username,
      full_name: student.full_name,
      student_type: student.student_type || 'diploma',
    },
  });
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

  res.json({ chapters: tree, pace: await getPace(req.student.id) });
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

// The student's own running total of sats earned (paid + still waiting for approval; rejected ones don't count).
app.get('/api/me/sats', requireStudent, async (req, res) => {
  trackerRewards.syncUnsent(req.student.id).catch(() => {});
  await trackerRewards.refreshStatuses(req.student.id);
  const { data, error } = await supabase.from('payouts').select('amount_sats, status').eq('student_id', req.student.id);
  if (error) return res.status(500).json({ error: 'Could not load sats' });
  let paid = 0, pending = 0;
  for (const p of data || []) {
    if (p.status === 'paid') paid += p.amount_sats || 0;
    else if (p.status === 'pending') pending += p.amount_sats || 0;
  }
  res.json({ total: paid + pending, paid, pending });
});

// The moment a section was first mastered: kept if it already has one, so revising never counts twice towards the weekly pace.
async function masteredAtFor(studentId, sectionId) {
  const { data } = await supabase.from('student_progress').select('mastered_at').eq('student_id', studentId).eq('section_id', sectionId).maybeSingle();
  return data?.mastered_at || new Date().toISOString();
}

app.get('/api/sections/:id', requireStudent, async (req, res) => {
  const { data: section, error } = await supabase
    .from('sections')
    .select('*, chapters(number, title)')
    .eq('id', req.params.id)
    .single();

  if (error || !section) return res.status(404).json({ error: 'Section not found' });

  const { data: quiz } = await supabase
    .from('quiz_bank')
    .select('id, question, options, difficulty, section_id')
    .eq('section_id', section.id);
  // Each student gets one question per section, with the answers in their own order.
  const myQuiz = quizMix.pickPerSection(req.student.id, quiz || []).map((q) => quizMix.presentQuestion(req.student.id, q));

  // Starting a brand-new section counts against the weekly pace; one already started or mastered can always be opened.
  const { data: existingProgress } = await supabase
    .from('student_progress').select('status').eq('student_id', req.student.id).eq('section_id', section.id).maybeSingle();
  if (!existingProgress) {
    const pace = await getPace(req.student.id);
    if (pace.blocked) {
      return res.status(403).json({ error: 'weekly_limit', message: 'You have done your sections for this week.', pace });
    }
  }
  // Opening a section never takes away a mastery it already has.
  if (!existingProgress || ['locked', 'available'].includes(existingProgress.status)) {
    await supabase.from('student_progress').upsert(
      {
        student_id: req.student.id,
        section_id: section.id,
        status: 'in_progress',
        last_updated: new Date().toISOString(),
      },
      { onConflict: 'student_id,section_id', ignoreDuplicates: false }
    );
  }

  res.json({ section, quiz: myQuiz });
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
      mastered_at: await masteredAtFor(req.student.id, req.params.id),
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

// How many times this student has finished this chapter's review; each attempt gets a fresh mix.
async function reviewRound(studentId, chapterId) {
  const { data } = await supabase.from('chapter_reviews').select('attempts').eq('student_id', studentId).eq('chapter_id', chapterId).maybeSingle();
  return (data && data.attempts) || 0;
}

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

  // One question per section for this student, in their own order, answers shuffled.
  const round = await reviewRound(req.student.id, chapter.id);
  const mine = quizMix.orderQuestions(req.student.id, quizMix.pickPerSection(req.student.id, questions || [], round), round);
  const shaped = mine.map((q) => ({
    id: q.id,
    question: q.question,
    options: quizMix.presentQuestion(req.student.id, q, round).options,
    section_number: q.sections?.number,
  }));

  // Opening the review starts a fresh attempt: forget earlier recorded answers.
  await supabase.from('review_answers').delete().eq('student_id', req.student.id).eq('chapter_id', chapter.id);

  res.json({ chapter: { id: chapter.id, number: chapter.number, title: chapter.title }, questions: shaped });
});

// Grades one question at a time, stateless — no DB write here. This
// mirrors the per-section checkpoint's immediate feedback without
// polluting the main attempts/mastery tables with review-time answers.
app.post('/api/chapters/:id/review/answer', requireStudent, async (req, res) => {
  const { quizId, selectedIndex } = req.body;
  if (!quizId || !Number.isInteger(selectedIndex)) return res.status(400).json({ error: 'quizId and selectedIndex required' });

  const { data: quizItem } = await supabase
    .from('quiz_bank').select('correct_index, options, section_id, sections(chapter_id)').eq('id', quizId).single();
  if (!quizItem || quizItem.sections?.chapter_id !== req.params.id) {
    return res.status(404).json({ error: 'Question not found' });
  }
  const round = await reviewRound(req.student.id, req.params.id);
  const { data: allQs } = await supabase.from('quiz_bank').select('id, section_id, sections!inner(chapter_id)').eq('sections.chapter_id', req.params.id);
  if (!quizMix.pickPerSection(req.student.id, allQs || [], round).some((q) => q.id === quizId)) {
    return res.status(404).json({ error: 'Question not found' });
  }
  const optCount = (quizItem.options || []).length;
  if (selectedIndex < 0 || selectedIndex >= optCount) return res.status(400).json({ error: 'Invalid answer' });
  const originalIndex = quizMix.toOriginalIndex(req.student.id, quizId, optCount, selectedIndex, round);
  const shownCorrect = quizMix.toDisplayedIndex(req.student.id, quizId, optCount, quizItem.correct_index, round);

  // Only the FIRST answer to each question counts in a review attempt, so the
  // answer key can't be discovered by trying every option and re-answering.
  const { data: prior } = await supabase
    .from('review_answers').select('is_correct')
    .eq('student_id', req.student.id).eq('quiz_id', quizId).maybeSingle();

  let isCorrect;
  if (prior) {
    isCorrect = prior.is_correct;
  } else {
    isCorrect = quizItem.correct_index === originalIndex;
    await supabase.from('review_answers').insert({
      student_id: req.student.id, chapter_id: req.params.id, quiz_id: quizId, is_correct: isCorrect,
    });
  }
  res.json({ isCorrect, correctIndex: shownCorrect });
});

// Records the final tally once the student has gone through every question.
// The score is worked out HERE from the answers the server recorded; the
// score the browser sends is ignored, because passing now earns sats.
app.post('/api/chapters/:id/review/complete', requireStudent, async (req, res) => {
  const chapterId = req.params.id;
  const { data: chapter } = await supabase.from('chapters').select('id, number').eq('id', chapterId).single();
  if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

  const { data: sections } = await supabase.from('sections').select('id').eq('chapter_id', chapterId);
  const sectionIds = (sections || []).map((s) => s.id);
  const { data: questions } = await supabase.from('quiz_bank').select('id, section_id').in('section_id', sectionIds);
  const round = await reviewRound(req.student.id, chapterId);
  const total = quizMix.pickPerSection(req.student.id, questions || [], round).length;

  let score_percent = 100; // a chapter with no review questions passes, with no reward
  if (total > 0) {
    const { data: answers } = await supabase
      .from('review_answers').select('is_correct')
      .eq('student_id', req.student.id).eq('chapter_id', chapterId);
    if ((answers || []).length < total) {
      return res.status(400).json({ error: 'Answer every review question before finishing.' });
    }
    const correct = answers.filter((a) => a.is_correct).length;
    score_percent = Math.round((correct / total) * 100);
  }
  const passed = score_percent >= REVIEW_PASS_PERCENT;

  await supabase.from('chapter_reviews').upsert(
    {
      student_id: req.student.id,
      chapter_id: chapterId,
      score_percent,
      passed,
      attempts: round + 1,
      completed_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,chapter_id' }
  );

  // Passing earns a reward, logged as pending until an admin approves it.
  let reward = null;
  if (passed && total > 0) {
    reward = await createPayoutIfNew(
      req.student.id, 'chapter', chapterId, `Chapter ${chapter.number} review`, CHAPTER_PASS_SATS
    );
  }

  res.json({ passed, score_percent, reward });
});

app.post('/api/sections/:id/attempt', requireStudent, async (req, res) => {
  const { quizId, selectedIndex, responseTimeMs } = req.body;
  const sectionId = req.params.id;

  const { data: quizItem } = await supabase.from('quiz_bank').select('*').eq('id', quizId).single();
  if (!quizItem || quizItem.section_id !== sectionId) return res.status(404).json({ error: 'Question not found' });

  // Only the question this student was given may be answered (so other variants' answers can't be probed).
  const { data: sectionQs } = await supabase.from('quiz_bank').select('id, section_id').eq('section_id', sectionId);
  const mine = quizMix.pickPerSection(req.student.id, sectionQs || []);
  if (!mine.some((q) => q.id === quizItem.id)) return res.status(404).json({ error: 'Question not found' });

  const optCount = (quizItem.options || []).length;
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= optCount) return res.status(400).json({ error: 'Invalid answer' });
  const originalIndex = quizMix.toOriginalIndex(req.student.id, quizItem.id, optCount, selectedIndex);
  const shownCorrect = quizMix.toDisplayedIndex(req.student.id, quizItem.id, optCount, quizItem.correct_index);
  const isCorrect = quizItem.correct_index === originalIndex;

  await supabase.from('attempts').insert({
    student_id: req.student.id,
    quiz_id: quizId,
    selected_index: originalIndex,
    is_correct: isCorrect,
    response_time_ms: responseTimeMs || null,
  });

  const ids = mine.map((q) => q.id);
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
      ...(newStatus === 'mastered' ? { mastered_at: await masteredAtFor(req.student.id, sectionId) } : {}),
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

  res.json({ isCorrect, correctIndex: shownCorrect, scorePercent, decision });
});

// ---------------------------------------------------------
// POSTGRAD — library, reading, and per-book tests
// ---------------------------------------------------------

// Next sort_order for a table (0 when empty).
async function nextSortOrder(table, filterCol, filterVal) {
  let q = supabase.from(table).select('sort_order').order('sort_order', { ascending: false }).limit(1);
  if (filterCol) q = q.eq(filterCol, filterVal);
  const { data } = await q;
  return data && data.length ? (data[0].sort_order || 0) + 1 : 0;
}

// Signed link to a book PDF (self-hosted storage only). The signature and
// expiry in the link are the access check, so an <iframe> can load it.
app.get('/api/postgrad/file/:name', bookFiles.serveSigned);

// All active books, with this student's reading/test status on each.
app.get('/api/postgrad/books', requireStudent, async (req, res) => {
  const { data: books } = await supabase
    .from('postgrad_books')
    .select('id, title, author, description, file_name, storage_path, sort_order')
    .eq('active', true)
    .order('sort_order');

  const { data: progress } = await supabase
    .from('postgrad_progress')
    .select('*')
    .eq('student_id', req.student.id);

  const progressByBook = Object.fromEntries((progress || []).map((p) => [p.book_id, p]));

  const list = (books || []).map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author,
    description: b.description,
    file_name: b.file_name,
    is_pdf: !!b.storage_path,
    sort_order: b.sort_order,
    status: progressByBook[b.id]?.status || 'unread',
    score_percent: progressByBook[b.id]?.score_percent ?? null,
    attempts_count: progressByBook[b.id]?.attempts_count || 0,
  }));

  res.json({ books: list });
});

// One book: a fresh signed URL (PDF) or the pasted text, plus its test
// (correct answers withheld). Marks in_progress the first time it's opened.
app.get('/api/postgrad/books/:id', requireStudent, async (req, res) => {
  const { data: book, error } = await supabase
    .from('postgrad_books')
    .select('*')
    .eq('id', req.params.id)
    .eq('active', true)
    .single();

  if (error || !book) return res.status(404).json({ error: 'Book not found' });

  let fileUrl = null;
  if (book.storage_path) {
    const { url: signedUrl, error: signErr } = await bookFiles.signedUrl(book.storage_path, 60 * 30);
    if (signErr || !signedUrl) return res.status(500).json({ error: 'Could not open this book right now — try again shortly.' });
    fileUrl = signedUrl;
  }

  const { data: quiz } = await supabase
    .from('postgrad_quiz_bank')
    .select('id, question, options, sort_order')
    .eq('book_id', book.id)
    .order('sort_order');
  const myBookQuiz = quizMix.orderQuestions(req.student.id, (quiz || []).map((q) => quizMix.presentQuestion(req.student.id, q)));

  // Only move unread -> in_progress; never overwrite completed/failed
  // just because the student re-opened the book to read it again.
  const { data: existing } = await supabase
    .from('postgrad_progress')
    .select('status')
    .eq('student_id', req.student.id)
    .eq('book_id', book.id)
    .maybeSingle();

  if (!existing) {
    await supabase.from('postgrad_progress').insert({
      student_id: req.student.id,
      book_id: book.id,
      status: 'in_progress',
    });
  }

  res.json({
    book: { id: book.id, title: book.title, author: book.author, description: book.description, file_name: book.file_name },
    fileUrl,
    contentText: book.content_text || null,
    quiz: myBookQuiz,
  });
});

// Submit one test answer. Grades it, and once every question has an
// answer, scores the whole test and marks the book completed or failed.
app.post('/api/postgrad/books/:id/attempt', requireStudent, async (req, res) => {
  const { quizId, selectedIndex } = req.body;
  const bookId = req.params.id;
  if (!quizId || !Number.isInteger(selectedIndex)) return res.status(400).json({ error: 'quizId and selectedIndex required' });

  const { data: quizItem } = await supabase
    .from('postgrad_quiz_bank').select('*').eq('id', quizId).eq('book_id', bookId).single();
  if (!quizItem) return res.status(404).json({ error: 'Question not found' });
  const pgCount = (quizItem.options || []).length;
  if (selectedIndex < 0 || selectedIndex >= pgCount) return res.status(400).json({ error: 'Invalid answer' });
  const originalIndex = quizMix.toOriginalIndex(req.student.id, quizId, pgCount, selectedIndex);
  const shownCorrect = quizMix.toDisplayedIndex(req.student.id, quizId, pgCount, quizItem.correct_index);

  // Only the FIRST answer to a question counts until the student retakes the
  // test, so the answer key can't be found by trying every option.
  const { data: prior } = await supabase
    .from('postgrad_attempts').select('is_correct')
    .eq('student_id', req.student.id).eq('quiz_id', quizId).maybeSingle();

  let isCorrect;
  if (prior) {
    isCorrect = prior.is_correct;
  } else {
    isCorrect = quizItem.correct_index === originalIndex;
    await supabase.from('postgrad_attempts').insert({
      student_id: req.student.id,
      quiz_id: quizId,
      selected_index: originalIndex,
      is_correct: isCorrect,
    });
  }

  const { data: bookQuizIds } = await supabase.from('postgrad_quiz_bank').select('id').eq('book_id', bookId);
  const ids = (bookQuizIds || []).map((q) => q.id);
  const { data: allAttempts } = await supabase
    .from('postgrad_attempts')
    .select('is_correct')
    .eq('student_id', req.student.id)
    .in('quiz_id', ids);

  const totalQuestions = ids.length;
  const answeredSoFar = allAttempts?.length || 0;
  const correctCount = (allAttempts || []).filter((a) => a.is_correct).length;

  let scorePercent = null;
  let status = 'in_progress';
  if (totalQuestions > 0 && answeredSoFar >= totalQuestions) {
    scorePercent = Math.round((correctCount / totalQuestions) * 100);
    status = scorePercent / 100 >= POSTGRAD_MASTERY_THRESHOLD ? 'completed' : 'failed';
  }

  await supabase.from('postgrad_progress').upsert(
    {
      student_id: req.student.id,
      book_id: bookId,
      status,
      score_percent: scorePercent,
      attempts_count: answeredSoFar,
      last_updated: new Date().toISOString(),
    },
    { onConflict: 'student_id,book_id' }
  );

  // Passing a book earns a reward, pending until an admin approves it.
  let reward = null;
  if (status === 'completed') {
    const { data: bk } = await supabase.from('postgrad_books').select('title').eq('id', bookId).single();
    reward = await createPayoutIfNew(req.student.id, 'book', bookId, `Book: ${bk?.title || 'book'}`, BOOK_PASS_SATS);
  }

  res.json({ isCorrect, correctIndex: shownCorrect, finished: status !== 'in_progress', scorePercent, status, reward });
});

// Retake — clears prior answers on this book's test so the student can
// start again from question 1.
app.post('/api/postgrad/books/:id/retake', requireStudent, async (req, res) => {
  const bookId = req.params.id;
  const { data: bookQuizIds } = await supabase.from('postgrad_quiz_bank').select('id').eq('book_id', bookId);
  const ids = (bookQuizIds || []).map((q) => q.id);

  if (ids.length) {
    await supabase.from('postgrad_attempts').delete().eq('student_id', req.student.id).in('quiz_id', ids);
  }

  await supabase.from('postgrad_progress').upsert(
    {
      student_id: req.student.id,
      book_id: bookId,
      status: 'in_progress',
      score_percent: null,
      attempts_count: 0,
      last_updated: new Date().toISOString(),
    },
    { onConflict: 'student_id,book_id' }
  );

  res.json({ ok: true });
});

// ---------------------------------------------------------
// ADMIN
// ---------------------------------------------------------
app.use('/api/admin', adminLimiter);

app.post('/api/admin/students', requireAdmin, adminKeyFailLimiter, async (req, res) => {
  const { username, password, full_name, cohort, student_type } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: 'username, password, full_name required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (student_type && !['diploma', 'postgrad'].includes(student_type)) {
    return res.status(400).json({ error: "student_type must be 'diploma' or 'postgrad'" });
  }
  const password_hash = bcrypt.hashSync(password, 10);
  const { data, error } = await supabase
    .from('students')
    .insert({ username, password_hash, full_name, cohort, created_by: 'admin', student_type: student_type || 'diploma' })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ id: data.id, username: data.username, full_name: data.full_name, student_type: data.student_type });
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
    .select('id, username, full_name, cohort, active, student_type, created_at')
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
    part_a_accepted, part_a_signature, part_a_date,
    part_b_accepted, part_b_signature, part_b_date,
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
        part_a_date: part_a_date || null,
        part_b_accepted: !!part_b_accepted,
        part_b_signature: part_b_signature || null,
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

// Postgrad progress for one student, for the admin detail panel.
app.get('/api/admin/students/:id/postgrad-progress', requireAdmin, async (req, res) => {
  const { data } = await supabase
    .from('postgrad_progress')
    .select('book_id, status, score_percent, attempts_count, last_updated, postgrad_books(title)')
    .eq('student_id', req.params.id)
    .order('last_updated', { ascending: false });
  res.json(data || []);
});

// ---------------------------------------------------------
// ADMIN — postgrad book library
// ---------------------------------------------------------

app.get('/api/admin/books', requireAdmin, async (req, res) => {
  const { data } = await supabase
    .from('postgrad_books')
    .select('id, title, author, description, file_name, storage_path, sort_order, active, created_at')
    .order('sort_order');
  res.json((data || []).map((b) => ({ ...b, is_pdf: !!b.storage_path, storage_path: undefined })));
});

// Upload a book PDF (multipart/form-data: file, title, author, description).
// The file goes straight into Supabase Storage — nothing touches local disk.
app.post('/api/admin/books', requireAdmin, (req, res, next) => {
  bookUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'A PDF file is required.' });
  const { title, author, description } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required.' });

  const storagePath = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  const { error: uploadErr } = await bookFiles.upload(storagePath, req.file.buffer);
  if (uploadErr) return res.status(500).json({ error: `Upload failed: ${uploadErr.message}` });

  const { data, error } = await supabase
    .from('postgrad_books')
    .insert({
      title,
      author: author || null,
      description: description || null,
      storage_path: storagePath,
      file_name: req.file.originalname,
      sort_order: await nextSortOrder('postgrad_books'),
      uploaded_by: 'admin',
    })
    .select()
    .single();

  if (error) {
    await bookFiles.remove(storagePath);
    return res.status(400).json({ error: error.message });
  }
  res.json(data);
});

// Create a book from pasted text instead of an uploaded PDF.
app.post('/api/admin/books/text', requireAdmin, async (req, res) => {
  const { title, author, description, content_text } = req.body;
  if (!title || !content_text) return res.status(400).json({ error: 'title and content_text are required.' });

  const { data, error } = await supabase
    .from('postgrad_books')
    .insert({
      title,
      author: author || null,
      description: description || null,
      content_text,
      sort_order: await nextSortOrder('postgrad_books'),
      uploaded_by: 'admin',
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

// Edit / deactivate a book. Deactivating hides it from students but keeps history.
app.patch('/api/admin/books/:id', requireAdmin, async (req, res) => {
  const { active, title, author, description, sort_order } = req.body;
  const update = {};
  if (active !== undefined) update.active = active;
  if (title !== undefined) update.title = title;
  if (author !== undefined) update.author = author;
  if (description !== undefined) update.description = description;
  if (sort_order !== undefined) update.sort_order = sort_order;

  const { error } = await supabase.from('postgrad_books').update(update).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

// Hard delete — removes the PDF (if any) and the row (cascades to its
// quiz bank, progress rows and attempts).
app.delete('/api/admin/books/:id', requireAdmin, async (req, res) => {
  const { data: book } = await supabase.from('postgrad_books').select('storage_path').eq('id', req.params.id).single();
  if (book?.storage_path) await bookFiles.remove(book.storage_path);

  const { error } = await supabase.from('postgrad_books').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

// ---------------------------------------------------------
// ADMIN — per-book test questions
// ---------------------------------------------------------

app.get('/api/admin/books/:id/quiz', requireAdmin, async (req, res) => {
  const { data } = await supabase
    .from('postgrad_quiz_bank')
    .select('*')
    .eq('book_id', req.params.id)
    .order('sort_order');
  res.json(data || []);
});

app.post('/api/admin/books/:id/quiz', requireAdmin, async (req, res) => {
  const { question, options, correct_index } = req.body;
  if (!question || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ error: 'question and at least 2 options are required.' });
  }
  if (!Number.isInteger(correct_index) || correct_index < 0 || correct_index >= options.length) {
    return res.status(400).json({ error: 'correct_index must point at one of the options.' });
  }

  const { data, error } = await supabase
    .from('postgrad_quiz_bank')
    .insert({
      book_id: req.params.id,
      question,
      options,
      correct_index,
      sort_order: await nextSortOrder('postgrad_quiz_bank', 'book_id', req.params.id),
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.delete('/api/admin/quiz/:quizId', requireAdmin, async (req, res) => {
  const { error } = await supabase.from('postgrad_quiz_bank').delete().eq('id', req.params.quizId);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

// ---------------------------------------------------------
// ADMIN — progress payouts (approve / reject) and Lightning addresses
// ---------------------------------------------------------

app.get('/api/admin/payouts', requireAdmin, async (req, res) => {
  const status = req.query.status;
  let q = supabase
    .from('payouts')
    .select('id, kind, label, amount_sats, status, note, created_at, decided_at, student_id, students(full_name, username, lightning_address)')
    .order('created_at', { ascending: false })
    .eq('sent_to_tracker', false) // rewards the tracker has are approved and paid there
    .limit(500);
  if (['pending', 'paid', 'rejected'].includes(status)) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return res.status(400).json({ error: error.message });

  const { data: pend } = await supabase.from('payouts').select('amount_sats').eq('status', 'pending').eq('sent_to_tracker', false);
  const pendingSats = (pend || []).reduce((n, r) => n + r.amount_sats, 0);
  res.json({ payouts: data || [], pending_count: (pend || []).length, pending_sats: pendingSats });
});

// Approve = "I have paid this" (status paid), or reject it. Only pending
// rewards can be decided, so nothing is marked paid twice.
app.patch('/api/admin/payouts/:id', requireAdmin, async (req, res) => {
  const { status, note } = req.body;
  if (!['paid', 'rejected'].includes(status)) return res.status(400).json({ error: "status must be 'paid' or 'rejected'" });
  const { data, error } = await supabase
    .from('payouts')
    .update({ status, note: note || null, decided_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(409).json({ error: 'That reward is no longer pending.' });
  res.json({ ok: true });
});

app.patch('/api/admin/students/:id/lightning-address', requireAdmin, async (req, res) => {
  const addr = (req.body.lightning_address || '').trim();
  if (addr && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
    return res.status(400).json({ error: 'Lightning address must look like name@domain.com' });
  }
  const { error } = await supabase.from('students').update({ lightning_address: addr || null }).eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3300;
app.listen(PORT, () => console.log(`Study & Stack running on http://localhost:${PORT}`));
