/**
 * Returns a date string in YYYY-MM-DD format using the user's LOCAL timezone.
 *
 * `new Date().toISOString()` always returns UTC — if you're ahead of UTC,
 * early-morning meals get stamped as the previous date and appear as "yesterday".
 * Use this function everywhere a calendar date (not a timestamp) is needed.
 *
 * @param offsetDays  positive = future, negative = past (default 0 = today)
 */
export function localDate(offsetDays = 0): string {
  const d = new Date()
  if (offsetDays !== 0) d.setDate(d.getDate() + offsetDays)
  return d.toLocaleDateString('en-CA')  // en-CA locale gives YYYY-MM-DD
}
