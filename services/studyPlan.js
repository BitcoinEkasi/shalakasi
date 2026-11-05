// services/studyPlan.js — the centre's study calendar and the daily pace limit.
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

// Midnight at the start of this date's day (South African time), as a real instant.
function dayStart(date) {
  const s = sast(date);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - SAST_MS);
}

// 'YYYY-MM-DD' of this date in South African time.
function dateKey(date) { return sast(date).toISOString().slice(0, 10); }

// Can new sections be started on this date? Not on a closed date (centre shut), not on a day outside the student's own group days.
// A student with no group set can study on any open day.
function isStudyDay(group, date, week1Start, closed = []) {
  if (closed.includes(dateKey(date))) return false;
  if (!week1Start) return true;
  return scheduledToday(group, date, week1Start) !== false;
}

// Start of the next day after `date` on which new sections can be started.
function nextStudyDay(group, date, week1Start, closed = []) {
  let t = dayStart(date).getTime();
  for (let i = 0; i < 28; i++) {
    t += DAY_MS;
    if (isStudyDay(group, new Date(t), week1Start, closed)) return new Date(t);
  }
  return new Date(dayStart(date).getTime() + DAY_MS);
}

// progressRows: [{status, mastered_at}]. A section counts once, on the day it was first finished.
// limit = the most NEW sections a student can finish in one study day. opts: { group, week1Start, closed }.
function paceState(progressRows, limit, now = new Date(), opts = {}) {
  const { group = null, week1Start = null, closed = [] } = opts;
  const from = dayStart(now).getTime();
  let done = 0, open = 0;
  for (const p of progressRows || []) {
    if (p.status === 'mastered' || p.status === 'reinforced') {
      // finished (right, or wrong and moved on): counts on the day it was first finished
      if (p.mastered_at && new Date(p.mastered_at).getTime() >= from) done += 1;
    } else if (p.status === 'in_progress') {
      open += 1;
    }
  }
  const studyDay = isStudyDay(group, now, week1Start, closed);
  const full = done + open >= limit;
  return {
    limit, done, open,
    blocked: !studyDay || full,
    reason: !studyDay ? 'not_study_day' : (full ? 'limit' : null),
    opens_on: nextStudyDay(group, now, week1Start, closed).toISOString(),
  };
}

module.exports = { PLAN, weekStart, nextWeekStart, rotationWeek, scheduledToday, dayStart, dateKey, isStudyDay, nextStudyDay, paceState };
