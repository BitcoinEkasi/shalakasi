// services/quizMix.js — gives each student their own mix of questions.
// Everything is worked out from (student id, question id, round) with a hash, so it needs no
// stored state: the same student sees the same mix until `round` changes (a new attempt),
// and two students beside each other see different questions and different answer order.
const crypto = require('crypto');

function hashBytes(...parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest();
}

// Deterministic Fisher-Yates driven by a hash stream.
function shuffledIndexes(n, ...seedParts) {
  const idx = Array.from({ length: n }, (_, i) => i);
  let bytes = hashBytes(...seedParts, 0), pos = 0, ctr = 0;
  const next = (max) => {
    if (pos + 4 > bytes.length) { bytes = hashBytes(...seedParts, ++ctr); pos = 0; }
    const v = bytes.readUInt32BE(pos); pos += 4;
    return v % max;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = next(i + 1);
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

// perm[displayedIndex] = originalIndex
function optionOrder(studentId, quizId, n, round = 0) {
  return shuffledIndexes(n, 'opt', studentId, quizId, round);
}

// One question per section, chosen per student. questions: [{id, section_id, ...}]
function pickPerSection(studentId, questions, round = 0) {
  const bySection = new Map();
  for (const q of questions || []) {
    if (!bySection.has(q.section_id)) bySection.set(q.section_id, []);
    bySection.get(q.section_id).push(q);
  }
  const picked = [];
  for (const [sectionId, list] of bySection) {
    list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const k = hashBytes('pick', studentId, sectionId, round).readUInt32BE(0) % list.length;
    picked.push(list[k]);
  }
  return picked;
}

// Put the questions in a per-student order.
function orderQuestions(studentId, questions, round = 0) {
  const idx = shuffledIndexes(questions.length, 'ord', studentId, round);
  return idx.map((i) => questions[i]);
}

// A question as the student sees it: options reordered, correct_index never included.
function presentQuestion(studentId, q, round = 0) {
  const perm = optionOrder(studentId, q.id, q.options.length, round);
  return { ...q, options: perm.map((i) => q.options[i]) };
}

// Student picked displayed option `selected`: which original option is that?
function toOriginalIndex(studentId, quizId, n, selected, round = 0) {
  const perm = optionOrder(studentId, quizId, n, round);
  return perm[selected];
}

// Where does the original correct option sit on the student's screen?
function toDisplayedIndex(studentId, quizId, n, originalCorrect, round = 0) {
  return optionOrder(studentId, quizId, n, round).indexOf(originalCorrect);
}

// A longer pick for chapter tests: up to `perSection` questions from each section, a different pick for each student and round.
function pickQuestions(studentId, questions, perSection, round = 0) {
  const bySection = new Map();
  for (const q of questions || []) {
    if (!bySection.has(q.section_id)) bySection.set(q.section_id, []);
    bySection.get(q.section_id).push(q);
  }
  const picked = [];
  for (const [sectionId, list] of bySection) {
    list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const order = shuffledIndexes(list.length, 'test', studentId, sectionId, round);
    for (const i of order.slice(0, perSection)) picked.push(list[i]);
  }
  return picked;
}

module.exports = { optionOrder, pickPerSection, pickQuestions, orderQuestions, presentQuestion, toOriginalIndex, toDisplayedIndex };
