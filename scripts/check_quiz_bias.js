// scripts/check_quiz_bias.js
// Reads every question in the quiz bank and reports whether the right answer gives itself away by length.
// For 3 options, a fair bank has the correct answer as the longest about a third of the time.
// Usage: node scripts/check_quiz_bias.js

require('dotenv').config();
const supabase = require('../services/supabase');

async function run() {
  const { data, error } = await supabase.from('quiz_bank').select('id, question, options, correct_index, sections(number)');
  if (error) throw new Error(error.message);
  const rows = (data || []).filter((q) => Array.isArray(q.options) && q.options.length > 1);
  let longest = 0, tied = 0, shortest = 0, ratioSum = 0;
  const flagged = [];
  for (const q of rows) {
    const len = q.options.map((o) => String(o).length);
    const c = len[q.correct_index];
    const others = len.filter((_, i) => i !== q.correct_index);
    const maxO = Math.max(...others), minO = Math.min(...others);
    const mean = others.reduce((a, b) => a + b, 0) / others.length;
    const ratio = c / mean;
    ratioSum += ratio;
    if (c > maxO) longest++; else if (c === maxO) tied++;
    if (c < minO) shortest++;
    if (ratio > 1.3 || ratio < 0.7) flagged.push({ section: q.sections && q.sections.number, ratio: ratio.toFixed(2), q: q.question.slice(0, 70) });
  }
  const n = rows.length, pct = (x) => Math.round((100 * x) / n) + '%';
  console.log(`Questions checked: ${n}`);
  console.log(`Right answer is the longest:  ${longest} (${pct(longest)})   tied for longest: ${tied} (${pct(tied)})`);
  console.log(`Right answer is the shortest: ${shortest} (${pct(shortest)})`);
  console.log(`Average length of right answer compared with the others: ${(ratioSum / n).toFixed(2)} (1.00 is fair)`);
  if (flagged.length) { console.log('\nVery uneven options (right answer much longer or shorter):'); flagged.forEach((f) => console.log(`  ${f.section}  x${f.ratio}  ${f.q}`)); }
  const fair = longest / n <= 0.45 && shortest / n <= 0.45;
  console.log(fair ? '\nOK: length does not give the answer away.' : '\nBIASED: kids can guess from the length. Rewrite the flagged questions.');
  if (!fair) process.exitCode = 1;
}
run().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
