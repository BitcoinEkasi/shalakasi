// services/aiEngine.js
// AI removed by request — this now runs entirely on fixed rules, no
// external API calls, no API key needed. Kept as its own module (rather
// than inlined in server.js) so the routing logic stays in one clear
// place, and so real AI could be reintroduced here later without
// touching server.js again.

const supabase = require('./supabase');

const MASTERY_THRESHOLD = 0.75;

async function decideNextStep({ studentId, sectionId, scorePercent, allSections, orderedIndex }) {
  const currentSection = allSections[orderedIndex];
  const nextSection = allSections[orderedIndex + 1] || null;

  const decision = ruleBasedDecision({ scorePercent, currentSection, nextSection });

  await supabase.from('ai_decisions').insert({
    student_id: studentId,
    from_section_id: currentSection.id,
    to_section_id: decision.toSectionId,
    decision_type: decision.type,
    reasoning: decision.reasoning,
  });

  return decision;
}

function ruleBasedDecision({ scorePercent, currentSection, nextSection }) {
  if (scorePercent >= MASTERY_THRESHOLD * 100) {
    return {
      type: 'advance',
      toSectionId: nextSection ? nextSection.id : null,
      reasoning: `Scored ${scorePercent}% on ${currentSection.number} (threshold ${MASTERY_THRESHOLD * 100}%) — moving ahead to ${nextSection ? nextSection.number : 'the next chapter'}.`,
    };
  }
  return {
    type: 'reinforce',
    toSectionId: nextSection ? nextSection.id : null,
    reasoning: `Not quite on ${currentSection.number} this time. Moving on: it will come up again in the chapter review, so it is worth a second read before then.`,
  };
}

module.exports = { decideNextStep };
