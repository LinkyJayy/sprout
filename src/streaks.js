// Daily reading streaks: reading at least one article on a calendar day counts that day.
// Days are the reader's local date (sent by the browser), so streaks follow their timezone.
import { db } from "./db.js";

const DAY_MS = 864e5;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (day) => Date.parse(`${day}T00:00:00Z`);

// Accept the browser's local date only if it's plausible (within a day of UTC); otherwise use UTC.
export function resolveToday(clientDay) {
  const utc = isoDay(Date.now());
  if (typeof clientDay !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(clientDay) || Number.isNaN(dayMs(clientDay))) return utc;
  return Math.abs(dayMs(clientDay) - dayMs(utc)) <= DAY_MS ? clientDay : utc;
}

export async function getStreak(userId, today) {
  const rows = await db.all("SELECT day FROM reading_days WHERE user_id = ? ORDER BY day DESC", [userId]);
  const days = rows.map((r) => r.day);
  const set = new Set(days);
  const todayMs = dayMs(today);

  // Current streak: consecutive days ending today, or ending yesterday if today isn't read yet.
  let current = 0;
  let cursor = set.has(today) ? todayMs : todayMs - DAY_MS;
  while (set.has(isoDay(cursor))) {
    current++;
    cursor -= DAY_MS;
  }

  let longest = 0;
  let run = 0;
  let prev = null;
  for (const day of [...days].reverse()) {
    const ms = dayMs(day);
    run = prev !== null && ms - prev === DAY_MS ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = ms;
  }

  // Last 7 days, oldest first, for the week view.
  const week = Array.from({ length: 7 }, (_, i) => {
    const day = isoDay(todayMs - (6 - i) * DAY_MS);
    return { day, read: set.has(day) };
  });

  return { current, longest: Math.max(longest, current), readToday: set.has(today), totalDays: days.length, week };
}

// Records a read for today. `increased` is true only the first time today, so the UI can celebrate once.
export async function recordRead(userId, today) {
  const r = await db.run("INSERT INTO reading_days (user_id, day) VALUES (?, ?) ON CONFLICT DO NOTHING", [userId, today]);
  return { ...(await getStreak(userId, today)), increased: r.changes > 0 };
}
