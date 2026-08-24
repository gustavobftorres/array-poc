/**
 * Calendar arithmetic shared by the API validation and by the fixtures.
 *
 * It lives in its own module because BOTH sides need it: the DOB validation in
 * `index.ts` (W-006) and the report aggregates in `array/mock.ts` (X-005, the
 * same class of defect surviving in the report: `oldestAccountYears` was a bare
 * subtraction of years, so an account opened 2012-12-01 showed "14 anos" on
 * 2026-08-23 instead of 13).
 */

/** Today in UTC as `[y, m, d]` — the calendar, not a millisecond count. */
export function todayParts(now = new Date()): [number, number, number] {
  return [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()]
}

/**
 * Whole years between a `YYYY-MM-DD` date and today, by CALENDAR.
 * Dividing milliseconds by an average year (365.25 d) made the same consumer
 * pass or fail depending on the hour of the day: somebody turning 18 today was
 * 17.9986 at midnight and 18.0008 in the evening (W-006).
 */
export function calendarAge(dob: string, now = new Date()): number {
  const [y, m, d] = dob.split('-').map(Number)
  const [ty, tm, td] = todayParts(now)
  let age = ty - y
  if (tm < m || (tm === m && td < (d || 1))) age -= 1
  return age
}

/** True when `date` is strictly after today's calendar date (UTC). */
export function isFutureDate(date: string, now = new Date()): boolean {
  const [ty, tm, td] = todayParts(now)
  const today = `${ty}-${String(tm).padStart(2, '0')}-${String(td).padStart(2, '0')}`
  return date > today
}

/** Last calendar day of a (possibly out-of-range) year/month pair, UTC. */
function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate()
}

/**
 * `YYYY-MM-DD` of the same calendar day `months` months ago (UTC), with the day
 * CLAMPED to the target month (Y-007).
 * `Date.UTC(2026, 2, 31)` rolls over into April, so on 2026-08-31 the "6 months
 * ago" cutoff came out 2026-03-03 — a window of 5 months and 28 days announced
 * on screen as "6 meses". Same rollover class that `calendarAge` avoids.
 */
export function monthsAgoISO(months: number, now = new Date()): string {
  const [ty, tm, td] = todayParts(now)
  const target = new Date(Date.UTC(ty, tm - 1 - months, 1))
  const y = target.getUTCFullYear()
  const m = target.getUTCMonth() + 1
  const d = Math.min(td, lastDayOfMonth(y, m))
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
