// scripts/apply_rebalance.js
// Replaces the answer options of existing questions so the right answer is not the longest one.
// Finds each question by section number + its old text, so it never touches anything it cannot match.
// Safe to run twice. Usage: node scripts/apply_rebalance.js [quiz_bank_rebalanced.json]

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../services/supabase');

async function run() {
  const filename = process.argv[2] || 'quiz_bank_rebalanced.json';
  const { updates } = JSON.parse(fs.readFileSync(path.join(__dirname, '../data', filename), 'utf-8'));
  let changed = 0, missing = 0;

  for (const u of updates) {
    const { data: section } = await supabase.from('sections').select('id').eq('number', u.section_number).maybeSingle();
    if (!section) { console.error(`Section ${u.section_number} not found`); missing++; continue; }

    // Match the old text first; if that is gone, it may already carry the new text.
    let { data: rows } = await supabase.from('quiz_bank').select('id').eq('section_id', section.id).eq('question', u.match_question);
    if ((!rows || !rows.length) && u.question) {
      ({ data: rows } = await supabase.from('quiz_bank').select('id').eq('section_id', section.id).eq('question', u.question));
    }
    if (!rows || !rows.length) { console.error(`NOT FOUND ${u.section_number}: "${u.match_question.slice(0, 60)}..."`); missing++; continue; }

    for (const r of rows) {
      const patch = { options: u.options, correct_index: u.correct_index };
      if (u.question) patch.question = u.question;
      const { error } = await supabase.from('quiz_bank').update(patch).eq('id', r.id);
      if (error) { console.error(`Update failed for ${u.section_number}:`, error.message); missing++; }
      else changed++;
    }
  }
  console.log(`\nUpdated ${changed} question${changed === 1 ? '' : 's'}. Not matched: ${missing}.`);
  if (missing) process.exitCode = 1;
}
run().catch((e) => { console.error('Failed:', e); process.exit(1); });
