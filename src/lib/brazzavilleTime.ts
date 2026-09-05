/** Reference time zone used for all Mimsi business dates and timestamps. */
export const BRAZZAVILLE_TIME_ZONE = 'Africa/Brazzaville';

/** ISO calendar date in Congo/Brazzaville, independent of the device time zone. */
export function brazzavilleToday(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BRAZZAVILLE_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** Timestamp display in Congo/Brazzaville time, even on devices configured elsewhere. */
export function formatBrazzavilleDateTime(value: string | Date, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: BRAZZAVILLE_TIME_ZONE,
    dateStyle: 'short', timeStyle: 'short',
    ...options,
  }).format(new Date(value));
}

export function formatBrazzavilleDate(value: string | Date, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: BRAZZAVILLE_TIME_ZONE, dateStyle: 'short', ...options }).format(new Date(value));
}
