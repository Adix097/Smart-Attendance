import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deriveCoursesAndFacultyFromTimetable,
  importAcademicData,
  parseStudents,
  parseTimetable,
  timetableWarnings,
  validateEnrollmentDirectories,
  type TimetableRow,
} from '../src/db/import-data.js';

const header =
  'course_code,course_name,faculty_name,weekday,start_time,end_time,class,batch';

// The room files in backend/data/timetables omit the course_name value.
const roomA204 = `${header}
ARD253,Dalal Dr. Renu,Monday,10:00,11:00,AIDS-III,BI B
ARD451,Jangid Dr. Manisha,Monday,10:00,11:00,AIDS-VII,B1
ARM-253,Kumar Dr. Ashok,Friday,14:00,15:00,AIML-III,B2-A
`;

const roomA203 = `${header}
ARD253,Dalal Dr. Renu,Wednesday,10:00,11:00,AIDS-III,B1 A
`;

const studentsCsv = `student_id,first_name,last_name,batch,group
14119051925,aditya,vishwakarma,B2,B
12819051925,abhishek,verma,B2,B
13419051925,mayu,gulia,B2,B
10819051925,roshan,jain,B2,A
03019051925,krishan,kant,B2,A
`;

function timetableFor(files: [string, string][]): TimetableRow[] {
  return files.flatMap(([room, content]) =>
    parseTimetable(content, `timetables/${room}.csv`, room),
  );
}

const bothRooms: [string, string][] = [
  ['A-203', roomA203],
  ['A-204', roomA204],
];

class MockClient {
  readonly courses = new Map<string, { id: string; title: string }>();
  readonly faculty = new Map<string, string>();
  readonly classrooms = new Map<string, string>();
  readonly students = new Map<string, Record<string, string>>();
  readonly timetable = new Map<
    string,
    { id: string; facultyId: string; facultyName: string; room: string; className: string; batch: string }
  >();

  async query(sql: string, values: unknown[] = []) {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT id, title FROM courses')) {
      const course = this.courses.get(values[0] as string);
      return { rows: course ? [course] : [], rowCount: course ? 1 : 0 };
    }
    if (sql.startsWith('INSERT INTO courses')) {
      this.courses.set(values[1] as string, {
        id: values[0] as string,
        title: values[2] as string,
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id FROM faculty')) {
      const id = this.faculty.get(values[0] as string);
      return { rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 };
    }
    if (sql.startsWith('INSERT INTO faculty')) {
      this.faculty.set(values[1] as string, values[0] as string);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id FROM classrooms')) {
      const id = this.classrooms.get(values[0] as string);
      return { rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 };
    }
    if (sql.startsWith('INSERT INTO classrooms')) {
      this.classrooms.set(values[1] as string, values[0] as string);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id, faculty_name FROM timetable_entries')) {
      const entry = this.timetable.get(values.slice(0, 7).join('|'));
      return {
        rows: entry ? [{ id: entry.id, faculty_name: entry.facultyName }] : [],
        rowCount: entry ? 1 : 0,
      };
    }
    if (sql.startsWith('INSERT INTO timetable_entries')) {
      const key = [1, 4, 6, 7, 8, 9, 10].map((index) => values[index]).join('|');
      this.timetable.set(key, {
        id: values[0] as string,
        facultyId: values[2] as string,
        facultyName: values[3] as string,
        room: values[5] as string,
        className: values[10] as string,
        batch: values[9] as string,
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id, name, first_name')) {
      const student = this.students.get(values[0] as string);
      return { rows: student ? [student] : [], rowCount: student ? 1 : 0 };
    }
    if (sql.startsWith('INSERT INTO students')) {
      this.students.set(values[1] as string, {
        id: values[0] as string,
        name: values[2] as string,
        first_name: values[3] as string,
        last_name: values[4] as string,
        batch: values[5] as string,
        student_group: values[6] as string,
      });
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  release() {}
}

function fakePool(client: MockClient) {
  return { connect: async () => client } as never;
}

describe('room timetable import', () => {
  it('takes the classroom from the file name and keeps class and batch verbatim', () => {
    const rows = parseTimetable(roomA204, 'timetables/A-204.csv', 'A-204');

    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((row) => row.room),
      ['A-204', 'A-204', 'A-204'],
    );
    assert.equal(rows[0].courseCode, 'ARD253');
    assert.equal(rows[0].facultyName, 'Dalal Dr. Renu');
    assert.equal(rows[0].className, 'AIDS-III');
    assert.equal(rows[0].batch, 'BI B');
    assert.equal(rows[0].courseName, null);
    assert.equal(rows[2].courseCode, 'ARM-253');
    assert.equal(rows[2].batch, 'B2-A');
  });

  it('reads a row that does supply course_name', () => {
    const rows = parseTimetable(
      `${header}\nARD253,Computer Networking (Lab),Dalal Dr. Renu,Monday,10:00,11:00,AIDS-III,BI B\n`,
      'timetables/A-204.csv',
      'A-204',
    );
    assert.equal(rows[0].courseName, 'Computer Networking (Lab)');
    assert.equal(rows[0].className, 'AIDS-III');
    assert.equal(rows[0].batch, 'BI B');
  });

  it('rejects a missing room, a bad header, and unusable rows', () => {
    assert.throws(
      () => parseTimetable(roomA204, 'timetables/A-204.csv', ''),
      /room is required from the file name/,
    );
    assert.throws(
      () => parseTimetable('a,b,c\n1,2,3\n', 'x.csv', 'A-1'),
      /unexpected header/,
    );
    assert.throws(
      () => parseTimetable(`${header}\nARD253,F,Monday,10:00\n`, 'x.csv', 'A-1'),
      /row 2 has 4 fields; expected 7 or 8/,
    );
    assert.throws(
      () => parseTimetable(`${header}\nARD253,F,Sunday,10:00,11:00,AIDS-III,B1\n`, 'x.csv', 'A-1'),
      /invalid day Sunday/,
    );
    assert.throws(
      () => parseTimetable(`${header}\nARD253,F,Monday,11:00,10:00,AIDS-III,B1\n`, 'x.csv', 'A-1'),
      /end_time must be after start_time/,
    );
    assert.throws(
      () => parseTimetable(`${header}\nARD253,,Monday,10:00,11:00,AIDS-III,B1\n`, 'x.csv', 'A-1'),
      /row 2 requires faculty_name/,
    );
  });

  it('derives courses and faculty across several rooms', () => {
    const { courses, faculty } = deriveCoursesAndFacultyFromTimetable(timetableFor(bothRooms));

    assert.deepEqual(
      courses.map((course) => course.courseCode),
      ['ARD253', 'ARD451', 'ARM-253'],
    );
    // No file supplies a course name, so the code is used as the title.
    assert.deepEqual(courses.map((course) => course.courseName), [null, null, null]);
    assert.deepEqual(
      faculty.map((member) => member.facultyName),
      ['Dalal Dr. Renu', 'Jangid Dr. Manisha', 'Kumar Dr. Ashok'],
    );
  });

  it('rejects two different names for one course code', () => {
    assert.throws(
      () =>
        deriveCoursesAndFacultyFromTimetable(
          parseTimetable(
            `${header}
ARD253,Computer Networking (Lab),Dalal Dr. Renu,Monday,10:00,11:00,AIDS-III,B1
ARD253,Something Else,Dalal Dr. Renu,Tuesday,10:00,11:00,AIDS-III,B1
`,
            'timetables/A-204.csv',
            'A-204',
          ),
        ),
      /course_code ARD253 has conflicting course_name/,
    );
  });

  it('reports repeated rows and rooms booked twice at once', () => {
    const warnings = timetableWarnings(
      parseTimetable(
        `${header}
ARM315,Parlewar Dr. Manisha,Friday,15:00,16:00,AIML-V,B2 / B1
ARM315,Parlewar Dr. Manisha,Friday,15:00,16:00,AIML-V,B2 / B1
ARD253,Dalal Dr. Renu,Monday,10:00,11:00,AIDS-III,BI B
ARD451,Jangid Dr. Manisha,Monday,10:00,11:00,AIDS-VII,B1
`,
        'timetables/A-406.csv',
        'A-406',
      ),
    );

    assert.equal(warnings.filter((line) => line.includes('repeats row 2')).length, 1);
    assert.equal(
      warnings.filter((line) => line.includes('double-booked on Monday at 10:00')).length,
      1,
    );
  });

  it('links every entry to its course, faculty and classroom', async () => {
    const client = new MockClient();
    const timetable = timetableFor(bothRooms);
    const { courses, faculty } = deriveCoursesAndFacultyFromTimetable(timetable);

    const summary = await importAcademicData(fakePool(client), courses, timetable, faculty);

    assert.equal(summary.classroomsImported, 2);
    assert.equal(summary.coursesImported, 3);
    assert.equal(summary.facultyImported, 3);
    assert.equal(summary.timetableEntriesImported, 4);
    assert.deepEqual([...client.classrooms.keys()].sort(), ['A-203', 'A-204']);
    // The title falls back to the code because the room files carry no name.
    assert.equal(client.courses.get('ARD253')?.title, 'ARD253');

    const stored = [...client.timetable.values()];
    assert.equal(stored.length, 4);
    assert.equal(stored.filter((entry) => entry.room === 'A-204').length, 3);
    assert.equal(stored.filter((entry) => entry.room === 'A-203').length, 1);
    assert.ok(stored.every((entry) => client.faculty.get(entry.facultyName) === entry.facultyId));
    assert.deepEqual(
      stored.map((entry) => entry.className).sort(),
      ['AIDS-III', 'AIDS-III', 'AIDS-VII', 'AIML-III'],
    );
    assert.ok(stored.some((entry) => entry.batch === 'BI B'));
    assert.ok(stored.some((entry) => entry.batch === 'B2-A'));
  });

  it('keeps one entry when the same course runs in two rooms at the same hour', async () => {
    const client = new MockClient();
    const sameSlotTwoRooms: [string, string][] = [
      ['A-203', `${header}\nARD253,Dalal Dr. Renu,Monday,10:00,11:00,AIDS-III,B1\n`],
      ['A-204', `${header}\nARD253,Dalal Dr. Renu,Monday,10:00,11:00,AIDS-III,B1\n`],
    ];
    const timetable = timetableFor(sameSlotTwoRooms);
    const { courses, faculty } = deriveCoursesAndFacultyFromTimetable(timetable);

    const summary = await importAcademicData(fakePool(client), courses, timetable, faculty);

    assert.equal(summary.timetableEntriesImported, 2);
    assert.equal(client.timetable.size, 2);
  });

  it('imports the same files twice without creating duplicates', async () => {
    const client = new MockClient();
    const timetable = timetableFor(bothRooms);
    const { courses, faculty } = deriveCoursesAndFacultyFromTimetable(timetable);
    const students = parseStudents(studentsCsv);

    const first = await importAcademicData(fakePool(client), courses, timetable, faculty, students);
    const second = await importAcademicData(fakePool(client), courses, timetable, faculty, students);

    assert.deepEqual(first, {
      facultyImported: 3,
      coursesImported: 3,
      classroomsImported: 2,
      timetableEntriesImported: 4,
      studentsImported: 5,
      duplicateRowsSkipped: 0,
    });
    assert.deepEqual(second, {
      facultyImported: 0,
      coursesImported: 0,
      classroomsImported: 0,
      timetableEntriesImported: 0,
      studentsImported: 0,
      duplicateRowsSkipped: 0,
    });
    assert.equal(client.timetable.size, 4);
    assert.equal(client.classrooms.size, 2);
    assert.equal(client.students.size, 5);
  });

  it('stores a row repeated inside one file only once', async () => {
    const client = new MockClient();
    const timetable = parseTimetable(
      `${header}
ARM315,Parlewar Dr. Manisha,Friday,15:00,16:00,AIML-V,B2 / B1
ARM315,Parlewar Dr. Manisha,Friday,15:00,16:00,AIML-V,B2 / B1
`,
      'timetables/A-406.csv',
      'A-406',
    );
    const { courses, faculty } = deriveCoursesAndFacultyFromTimetable(timetable);

    const summary = await importAcademicData(fakePool(client), courses, timetable, faculty);

    assert.equal(summary.timetableEntriesImported, 1);
    assert.equal(summary.duplicateRowsSkipped, 1);
    assert.equal(client.timetable.size, 1);
  });

  it('refuses to reassign a stored slot to a different faculty member', async () => {
    const client = new MockClient();
    const original = timetableFor([['A-204', roomA204]]);
    const { courses, faculty } = deriveCoursesAndFacultyFromTimetable(original);
    await importAcademicData(fakePool(client), courses, original, faculty);

    const reassigned = parseTimetable(
      `${header}\nARD253,Arora Dr. Amar,Monday,10:00,11:00,AIDS-III,BI B\n`,
      'timetables/A-204.csv',
      'A-204',
    );
    const changed = deriveCoursesAndFacultyFromTimetable(reassigned);

    await assert.rejects(
      importAcademicData(fakePool(client), changed.courses, reassigned, changed.faculty),
      /assigns "Arora Dr. Amar" to a slot already held by "Dalal Dr. Renu"/,
    );
  });

  it('keeps an existing course title when the room files supply no name', async () => {
    const client = new MockClient();
    client.courses.set('ARD253', { id: 'course-1', title: 'Computer Networking (Lab)' });
    const timetable = timetableFor([['A-203', roomA203]]);
    const { courses, faculty } = deriveCoursesAndFacultyFromTimetable(timetable);

    const summary = await importAcademicData(fakePool(client), courses, timetable, faculty);

    assert.equal(summary.coursesImported, 0);
    assert.equal(client.courses.get('ARD253')?.title, 'Computer Networking (Lab)');
  });

  it('reports a course title that disagrees with the database', async () => {
    const client = new MockClient();
    client.courses.set('ARD253', { id: 'course-1', title: 'Computer Networking (Lab)' });
    const timetable = parseTimetable(
      `${header}\nARD253,Renamed Course,Dalal Dr. Renu,Monday,10:00,11:00,AIDS-III,B1\n`,
      'timetables/A-204.csv',
      'A-204',
    );
    const { courses, faculty } = deriveCoursesAndFacultyFromTimetable(timetable);

    await assert.rejects(
      importAcademicData(fakePool(client), courses, timetable, faculty),
      /Course ARD253 conflicts/,
    );
  });

  it('fails when a timetable faculty member was not imported', async () => {
    const client = new MockClient();
    const timetable = timetableFor([['A-204', roomA204]]);
    const { courses } = deriveCoursesAndFacultyFromTimetable(timetable);

    await assert.rejects(
      importAcademicData(fakePool(client), courses, timetable, []),
      /references unresolved faculty/,
    );
  });
});

describe('student master data', () => {
  it('preserves student IDs as strings, including leading zeros', () => {
    const students = parseStudents(studentsCsv);
    assert.equal(students.length, 5);
    assert.equal(students[4].studentId, '03019051925');
    assert.equal(students[4].group, 'A');
    assert.throws(
      () =>
        parseStudents(
          'student_id,first_name,last_name,batch,group\n14119051925,a,b,B2,A\n14119051925,c,d,B2,B\n',
        ),
      /duplicate student_id 14119051925/,
    );
  });

  it('imports students idempotently without changing existing values', async () => {
    const client = new MockClient();
    const students = parseStudents(studentsCsv);

    const first = await importAcademicData(fakePool(client), [], [], [], students);
    const second = await importAcademicData(fakePool(client), [], [], [], students);

    assert.equal(first.studentsImported, 5);
    assert.equal(second.studentsImported, 0);
    assert.equal(client.students.size, 5);
    assert.ok(client.students.has('03019051925'));
  });

  it('requires an enrollment directory for every student', async () => {
    await assert.rejects(
      validateEnrollmentDirectories(parseStudents(studentsCsv), 'C:\\missing-enrollment-root'),
      /Missing enrollment directory for student 14119051925/,
    );
  });
});
