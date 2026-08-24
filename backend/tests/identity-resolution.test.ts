import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRecognizedIdentity } from '../src/modules/attendance/verification.js';

const expected = {
  id: 'student-expected',
  studentNumber: '14119051925',
  name: 'Aditya Vishwakarma',
  batch: 'B',
  group: 'B',
};
const unexpected = {
  id: 'student-unexpected',
  studentNumber: '99919051925',
  name: 'Known Campus Student',
  batch: 'A',
  group: 'A',
};
const identities = new Map([
  [expected.studentNumber, expected],
  [unexpected.studentNumber, unexpected],
]);

test('resolves an expected global student separately from class membership', () => {
  const result = resolveRecognizedIdentity(
    expected.studentNumber,
    identities,
    new Set([expected.id]),
  );
  assert.equal(result.status, 'EXPECTED');
  assert.equal(result.student?.name, 'Aditya Vishwakarma');
});

test('resolves a known but unexpected global student without making them eligible', () => {
  const result = resolveRecognizedIdentity(
    unexpected.studentNumber,
    identities,
    new Set([expected.id]),
  );
  assert.equal(result.status, 'UNEXPECTED_STUDENT');
  assert.equal(result.student?.studentNumber, '99919051925');
});

test('returns unknown without exposing an internal identifier', () => {
  const result = resolveRecognizedIdentity('not-in-campus-database', identities, new Set());
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.student, null);
});
