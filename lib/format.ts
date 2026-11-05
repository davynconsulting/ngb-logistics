/** Date formatting in an explicit time zone (timestamps are stored in UTC). */
export function formatDate(iso: string | null | undefined, timeZone = "Africa/Kigali", locale = "en-GB") {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(new Date(iso));
}
