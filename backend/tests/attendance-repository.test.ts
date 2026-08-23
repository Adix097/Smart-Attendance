import assert from 'node:assert/strict';
import test from 'node:test';

import { PgAttendanceRepository } from '../src/modules/attendance/repository.js';

test('createAttendanceContext explicitly types timestamp parameters', async () => {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const database = {
    query: async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      if (text.includes('FROM class_sessions')) {
        return {
          rows: [{
            scheduled_start: new Date('2026-08-24T11:00:00Z'),
            scheduled_end: new Date('2026-08-24T13:00:00Z'),
          }],
        };
      }
      if (text.includes('FROM timetable_entries')) {
        return {
          rows: [
            { id: 'student-1', student_number: '14119051925', name: 'Student One', batch: 'A', student_group: 'A' },
            { id: 'student-2', student_number: '14119051926', name: 'Student Two', batch: 'A', student_group: 'A' },
            { id: 'student-3', student_number: '14119051927', name: 'Student Three', batch: 'A', student_group: 'A' },
          ],
        };
      }
      if (text.includes('SELECT id FROM attendance_contexts')) {
        return { rows: [{ id: 'context-1' }] };
      }
      return { rows: [] };
    },
  };

  const repository = new PgAttendanceRepository(database as never);
  await repository.createAttendanceContext('attendance-1', 'class-1');

  const insert = calls.find((call) => call.text.includes('INSERT INTO attendance_contexts'));
  assert.ok(insert);
  assert.equal((insert.text.match(/\$4/g) ?? []).length, 2);
  assert.match(insert.text, /\$4::timestamptz/);
  assert.deepEqual(insert.values?.slice(3, 5), [
    new Date('2026-08-24T11:00:00Z'),
    new Date('2026-08-24T13:00:00Z'),
  ]);
});
