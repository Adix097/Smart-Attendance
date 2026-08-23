import assert from 'node:assert/strict';
import test from 'node:test';

import {
  occurrenceStatus,
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
