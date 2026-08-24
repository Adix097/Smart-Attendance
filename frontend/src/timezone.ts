export const displayTimeZone = import.meta.env.VITE_APP_TIMEZONE ?? 'Asia/Kolkata';

const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: displayTimeZone,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: displayTimeZone,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: displayTimeZone,
  weekday: 'long',
});

export function formatClock(date: Date): string {
  return clockFormatter.format(date);
}

export function formatTime(isoTimestamp: string): string {
  return timeFormatter.format(new Date(isoTimestamp));
}

export function formatWeekday(isoTimestamp: string): string {
  return dayFormatter.format(new Date(isoTimestamp));
}
