// scripts/seed_quiz.js
// Loads a quiz_bank JSON file into quiz_bank, resolving each
// section_number to its section_id. Run after seed_curriculum.js.
// Usage: npm run seed:quiz                              (uses data/quiz_bank_seed.json)
//        node scripts/seed_quiz.js quiz_bank_seed_ch3_4.json   (uses a different file in data/)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../services/supabase');

async function seed() {
  const filename = process.argv[2] || 'quiz_bank_seed.json';
  const raw = fs.readFileSync(path.join(__dirname, '../data', filename), 'utf-8');
  const { quizzes } = JSON.parse(raw);

  for (const q of quizzes) {
    const { data: section, error: sectionErr } = await supabase
      .from('sections')
      .select('id')
      .eq('number', q.section_number)
      .single();

    if (sectionErr || !section) {
      console.error(`Section ${q.section_number} not found — run seed:curriculum first.`);
      continue;
    }

    // Skip a question that is already there, so running this twice never doubles it.
    const { data: dup } = await supabase.from('quiz_bank').select('id').eq('section_id', section.id).eq('question', q.question).maybeSingle();
    if (dup) { console.log(`Already present for ${q.section_number}: "${q.question.slice(0, 50)}..." (skipped)`); continue; }

    const { error } = await supabase.from('quiz_bank').insert({
      section_id: section.id,
      question: q.question,
      options: q.options,
      correct_index: q.correct_index,
      difficulty: q.difficulty || 'core',
    });

    if (error) console.error(`Quiz for ${q.section_number} failed:`, error.message);
    else console.log(`Quiz added for section ${q.section_number}: "${q.question.slice(0, 50)}..."`);
  }
  console.log('\nDone.');
}

seed().catch((err) => { console.error('Seed failed:', err); process.exit(1); });
