// services/finalExam.js — picks a student's final exam: a few questions from every chapter,
// a different pick and order for each student and each attempt (round).
const quizMix = require('./quizMix');

// chapters: [{id, number, sort_order}], sections: [{id, chapter_id}], quiz: [{id, section_id, ...}]
function pickFinalQuestions(studentId, round, chapters, sections, quiz, perChapter = 5) {
  const chapterOf = new Map((sections || []).map((s) => [s.id, s.chapter_id]));
  const out = [];
  for (const ch of (chapters || []).slice().sort((a, b) => a.sort_order - b.sort_order)) {
    const qs = (quiz || []).filter((q) => chapterOf.get(q.section_id) === ch.id);
    const chosen = quizMix.orderQuestions(studentId, quizMix.pickQuestions(studentId, qs, 2, round), round).slice(0, perChapter);
    out.push(...chosen.map((q) => ({ ...q, chapter_number: ch.number })));
  }
  return quizMix.orderQuestions(studentId, out, round + '-all');
}

module.exports = { pickFinalQuestions };
