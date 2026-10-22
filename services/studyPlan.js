// services/studyPlan.js — the centre's study calendar and the weekly pace limit.
// All dates are worked out in South African time (UTC+2, no daylight saving), whatever the server's own clock says.
const SAST_MS = 2 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

// Group 1 comes Mon/Wed/Fri in week 1 and Tue/Thu in week 2; group 2 is the other way round.
// Weekday numbers: 1 = Monday ... 5 = Friday.
const PLAN = {
  1: { 1: [1, 3, 5], 2: [2, 4] },
  2: { 1: [2, 4], 2: [1, 3, 5] },
};

// A Date shifted so its UTC getters read South African wall-clock time.
function sast(date) { return new Date(date.getTime() + SAST_MS); }

// Midnight at the start of the Monday of this date's week, as a real instant.
function weekStart(date) {
  const s = sast(date);
  const dow = (s.getUTCDay() + 6) % 7; // Monday = 0
  const mondayLocal = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - dow * DAY_MS;
  return new Date(mondayLocal - SAST_MS);
}

function nextWeekStart(date) { return new Date(weekStart(date).getTime() + 7 * DAY_MS); }

// 1 or 2: which week of the two-week rotation this date falls in. week1Start is 'YYYY-MM-DD' (any day in the first week).
function rotationWeek(date, week1Start) {
  const [y, m, d] = String(week1Start).split('-').map(Number);
  const startMonday = weekStart(new Date(Date.UTC(y, m - 1, d, 12) - SAST_MS));
  const n = Math.round((weekStart(date).getTime() - startMonday.getTime()) / (7 * DAY_MS));
  return ((n % 2) + 2) % 2 === 0 ? 1 : 2;
}

// true / false when the student has a group, null when we don't know (no group set).
function scheduledToday(group, date, week1Start) {
  if (group !== 1 && group !== 2) return null;
  const s = sast(date);
  const weekday = (s.getUTCDay() + 6) % 7 + 1;
  return PLAN[group][rotationWeek(date, week1Start)].includes(weekday);
}

// progressRows: [{status, mastered_at}]. A section counts once, in the week it was first mastered.
function paceState(progressRows, limit, now = new Date()) {
  const from = weekStart(now).getTime();
  let done = 0, open = 0;
  for (const p of progressRows || []) {
    if (p.status === 'mastered') {
      if (p.mastered_at && new Date(p.mastered_at).getTime() >= from) done += 1;
    } else if (p.status === 'in_progress' || p.status === 'reinforced') {
      open += 1;
    }
  }
  return { limit, done, open, blocked: done + open >= limit, opens_on: nextWeekStart(now).toISOString() };
}

module.exports = { PLAN, weekStart, nextWeekStart, rotationWeek, scheduledToday, paceState };
