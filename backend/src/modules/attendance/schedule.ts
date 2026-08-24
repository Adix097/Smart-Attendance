export type ClassOccurrenceStatus = 'upcoming' | 'active' | 'ended';

export interface TimetableOccurrenceRow {
  id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  [key: string]: unknown;
}

export interface ScheduledOccurrence {
  row: TimetableOccurrenceRow;
  start: Date;
  end: Date;
}

const dayIndexes: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: values.weekday,
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function zonedDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const local = zonedParts(guess, timeZone);
  const representedAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return new Date(guess.getTime() - (representedAsUtc - guess.getTime()));
}

function nextDateParts(now: ReturnType<typeof zonedParts>, daysAhead: number) {
  const date = new Date(Date.UTC(now.year, now.month - 1, now.day + daysAhead));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function timetableOccurrences(
  rows: TimetableOccurrenceRow[],
  now: Date,
  timeZone: string,
): ScheduledOccurrence[] {
  const localNow = zonedParts(now, timeZone);
  const currentMinutes = localNow.hour * 60 + localNow.minute;
  return rows.flatMap((row) => {
    const targetDay = dayIndexes[row.day_of_week];
    if (targetDay === undefined) return [];
    const [hours, minutes] = String(row.start_time).slice(0, 5).split(':').map(Number);
    const [endHours, endMinutes] = String(row.end_time).slice(0, 5).split(':').map(Number);
    let daysAhead = (targetDay - dayIndexes[localNow.weekday] + 7) % 7;
    if (
      daysAhead === 0 &&
      endHours * 60 + endMinutes <= currentMinutes &&
      endHours * 60 + endMinutes > hours * 60 + minutes
    ) {
      daysAhead = 7;
    }
    const date = nextDateParts(localNow, daysAhead);
    const start = zonedDate(date.year, date.month, date.day, hours, minutes, timeZone);
    const endDate = endHours * 60 + endMinutes <= hours * 60 + minutes
      ? nextDateParts(localNow, daysAhead + 1)
      : date;
    const end = zonedDate(endDate.year, endDate.month, endDate.day, endHours, endMinutes, timeZone);
    return [{ row, start, end }];
  });
}

export function selectRelevantOccurrences(
  occurrences: ScheduledOccurrence[],
  now: Date,
): ScheduledOccurrence[] {
  const active = occurrences.filter(({ start, end }) => start <= now && now < end);
  if (active.length > 0) return active;
  const upcoming = occurrences
    .filter(({ start }) => start > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  return upcoming.length > 0 ? upcoming.filter(({ start }) => start.getTime() === upcoming[0].start.getTime()) : [];
}

export function occurrenceStatus(start: Date, end: Date, now: Date): ClassOccurrenceStatus {
  if (now < start) return 'upcoming';
  if (now < end) return 'active';
  return 'ended';
}

/**
 * The latest timetable slot that has already finished, in the app timezone.
 * Used only when ended-session testing is explicitly enabled.
 */
export function mostRecentEndedOccurrence(
  rows: TimetableOccurrenceRow[],
  now: Date,
  timeZone: string,
): ScheduledOccurrence | null {
  const localNow = zonedParts(now, timeZone);
  const weekdayIndex = dayIndexes[localNow.weekday];
  if (weekdayIndex === undefined) return null;

  let latest: ScheduledOccurrence | null = null;
  for (const row of rows) {
    const targetDay = dayIndexes[row.day_of_week];
    if (targetDay === undefined) continue;
    const [hours, minutes] = String(row.start_time).slice(0, 5).split(':').map(Number);
    const [endHours, endMinutes] = String(row.end_time).slice(0, 5).split(':').map(Number);
    const overnight = endHours * 60 + endMinutes <= hours * 60 + minutes;
    const daysBack = (weekdayIndex - targetDay + 7) % 7;

    const occurrenceFor = (back: number): ScheduledOccurrence => {
      const date = nextDateParts(localNow, -back);
      const start = zonedDate(date.year, date.month, date.day, hours, minutes, timeZone);
      const endDate = overnight ? nextDateParts(localNow, -back + 1) : date;
      const end = zonedDate(
        endDate.year,
        endDate.month,
        endDate.day,
        endHours,
        endMinutes,
        timeZone,
      );
      return { row, start, end };
    };

    let candidate = occurrenceFor(daysBack);
    if (candidate.end > now) candidate = occurrenceFor(daysBack + 7);
    if (candidate.end > now) continue;
    if (!latest || candidate.end > latest.end) latest = candidate;
  }
  return latest;
}

export function selectAttendanceClassRows<
  T extends { id: string; scheduled_start: Date; scheduled_end: Date },
>(rows: T[], now: Date, includeEnded: boolean): T[] {
  const active = rows.filter(
    (row) => row.scheduled_start <= now && now < row.scheduled_end,
  );
  const upcoming = rows
    .filter((row) => row.scheduled_start > now)
    .sort((a, b) => a.scheduled_start.getTime() - b.scheduled_start.getTime());
  const earliestUpcoming = upcoming[0]?.scheduled_start.getTime();
  const relevant =
    active.length > 0
      ? active
      : upcoming.filter((row) => row.scheduled_start.getTime() === earliestUpcoming);

  if (!includeEnded) return relevant;

  const ended = rows
    .filter((row) => row.scheduled_end <= now)
    .sort((a, b) => b.scheduled_end.getTime() - a.scheduled_end.getTime());
  const latestEnded = ended[0];
  if (!latestEnded) return relevant;
  return [
    latestEnded,
    ...relevant.filter((row) => row.id !== latestEnded.id),
  ];
}
