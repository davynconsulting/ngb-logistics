/** Date formatting in an explicit time zone (timestamps are stored in UTC). */
export function formatDate(iso: string | null | undefined, timeZone = "Africa/Kigali", locale = "en-GB") {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(new Date(iso));
}

/** Date and time, e.g. "5 Nov 2026, 14:30", in an explicit time zone. */
export function formatDateTime(iso: string | null | undefined, timeZone = "Africa/Kigali", locale = "en-GB") {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(iso));
}
