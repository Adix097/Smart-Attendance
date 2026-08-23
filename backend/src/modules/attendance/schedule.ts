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
