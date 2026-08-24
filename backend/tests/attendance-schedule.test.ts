import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mostRecentEndedOccurrence,
  occurrenceStatus,
  selectAttendanceClassRows,
  selectRelevantOccurrences,
  timetableOccurrences,
} from '../src/modules/attendance/schedule.js';

const timetable = [
  { id: 'first', day_of_week: 'Monday', start_time: '16:30:00', end_time: '18:30:00' },
  { id: 'second', day_of_week: 'Monday', start_time: '18:30:00', end_time: '20:30:00' },
];

test('selects the active timetable occurrence in the configured timezone', () => {
  const now = new Date('2026-08-24T12:29:00Z'); // 17:59 in Asia/Kolkata
  const occurrences = timetableOccurrences(timetable, now, 'Asia/Kolkata');
  const selected = selectRelevantOccurrences(occurrences, now);
  assert.deepEqual(selected.map(({ row }) => row.id), ['first']);
  assert.equal(occurrenceStatus(selected[0].start, selected[0].end, now), 'active');
});

test('moves to a class starting exactly when the previous class ends', () => {
  const now = new Date('2026-08-24T13:00:00Z'); // 18:30 in Asia/Kolkata
  const selected = selectRelevantOccurrences(
    timetableOccurrences(timetable, now, 'Asia/Kolkata'),
    now,
  );
  assert.deepEqual(selected.map(({ row }) => row.id), ['second']);
});

test('selects the next timetable day when today has ended', () => {
  const now = new Date('2026-08-23T18:30:00Z'); // Sunday
  const selected = selectRelevantOccurrences(
    timetableOccurrences(timetable, now, 'Asia/Kolkata'),
    now,
  );
  assert.deepEqual(selected.map(({ row }) => row.id), ['first']);
  assert.equal(selected[0].start.toISOString(), '2026-08-24T11:00:00.000Z');
});

test('marks an occurrence ended only after its end instant', () => {
  const start = new Date('2026-08-24T11:00:00Z');
  const end = new Date('2026-08-24T13:00:00Z');
  assert.equal(occurrenceStatus(start, end, new Date('2026-08-24T12:59:59Z')), 'active');
  assert.equal(occurrenceStatus(start, end, end), 'ended');
});

test('finds today\'s slot once it has finished', () => {
  const now = new Date('2026-08-24T15:00:00Z'); // 20:30 in Asia/Kolkata, after both Monday classes
  const ended = mostRecentEndedOccurrence(timetable, now, 'Asia/Kolkata');
  assert.equal(ended?.row.id, 'second');
  assert.equal(occurrenceStatus(ended!.start, ended!.end, now), 'ended');
});

test('walks back a week when today\'s slot has not finished', () => {
  const now = new Date('2026-08-24T10:00:00Z'); // 15:30 in Asia/Kolkata, before 16:30
  const ended = mostRecentEndedOccurrence(timetable, now, 'Asia/Kolkata');
  assert.equal(ended?.row.id, 'second');
  assert.equal(ended?.end.toISOString(), '2026-08-17T15:00:00.000Z');
});

test('lists the latest ended class in front of the next upcoming class', () => {
  const now = new Date('2026-08-24T15:00:00Z');
  const rows = [
    {
      id: 'ended',
      scheduled_start: new Date('2026-08-24T11:00:00Z'),
      scheduled_end: new Date('2026-08-24T13:00:00Z'),
    },
    {
      id: 'upcoming',
      scheduled_start: new Date('2026-08-25T03:30:00Z'),
      scheduled_end: new Date('2026-08-25T05:30:00Z'),
    },
  ];
  assert.deepEqual(
    selectAttendanceClassRows(rows, now, false).map((row) => row.id),
    ['upcoming'],
  );
  assert.deepEqual(
    selectAttendanceClassRows(rows, now, true).map((row) => row.id),
    ['ended', 'upcoming'],
  );
});
