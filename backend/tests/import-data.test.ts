import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  importAcademicData,
  parseCourses,
  parseFaculty,
  normalizeFacultyName,
  parseStudents,
  parseTimetable,
  validateEnrollmentDirectories,
  type CourseRow,
  type TimetableRow,
} from '../src/db/import-data.js';

const coursesCsv = `course_code,course_name
ARD201,Software Engineering
ARD203,Analysis and Design of Algorithms
`;

const timetableCsv = `day,start_time,end_time,course_code,batch,faculty_name,room
Monday,09:00,10:00,ARD201,A,Demo Faculty,A-101
Tuesday,10:00,11:00,ARD203,ALL,Demo Faculty,A-102
`;

const studentsCsv = `student_id,first_name,last_name,batch,group
14119051925,aditya,vishwakarma,B2,B
1289051925,abhishek,verma,B2,B
13419051925,mayu,gulia,B2,B
10819051925,roshan,jain,B2,A
03019051925,krishan,kant,B2,A
`;

class MockClient {
  readonly courses = new Map<string, { id: string; title: string }>();
  readonly faculty = new Map<string, string>();
  readonly students = new Map<string, { id: string; name: string; firstName: string; lastName: string; batch: string; group: string }>();
  readonly timetable = new Map<
    string,
    { id: string; facultyId: string; facultyName: string; room: string }
  >();
  queryCount = 0;

  async query(sql: string, values: unknown[] = []) {
    this.queryCount += 1;
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT id, title FROM courses')) {
      const course = this.courses.get(values[0] as string);
      return { rows: course ? [{ id: course.id, title: course.title }] : [], rowCount: course ? 1 : 0 };
    }
    if (sql.startsWith('SELECT id FROM faculty')) {
      const id = this.faculty.get(values[0] as string);
      return { rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 };
    }
    if (sql.startsWith('INSERT INTO faculty')) {
      this.faculty.set(values[1] as string, values[0] as string);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id, name, first_name, last_name, batch, student_group')) {
      const student = this.students.get(values[0] as string);
      return { rows: student ? [{
        id: student.id,
        name: student.name,
        first_name: student.firstName,
        last_name: student.lastName,
        batch: student.batch,
        student_group: student.group,
      }] : [], rowCount: student ? 1 : 0 };
    }
    if (sql.startsWith('INSERT INTO students')) {
      this.students.set(values[1] as string, {
        id: values[0] as string,
        name: values[2] as string,
        firstName: values[3] as string,
        lastName: values[4] as string,
        batch: values[5] as string,
        group: values[6] as string,
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO courses')) {
      this.courses.set(values[1] as string, {
        id: values[0] as string,
        title: values[2] as string,
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id, faculty_id, faculty_name, room')) {
      const key = values.slice(0, 5).join('|');
      const entry = this.timetable.get(key);
      return {
        rows: entry
          ? [
              {
                id: entry.id,
                faculty_id: entry.facultyId,
                faculty_name: entry.facultyName,
                room: entry.room,
              },
            ]
          : [],
        rowCount: entry ? 1 : 0,
      };
    }
    if (sql.startsWith('UPDATE timetable_entries')) {
      const entry = [...this.timetable.values()].find(
        (candidate) => candidate.id === values[0],
      );
      assert(entry);
      entry.facultyId = values[1] as string;
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO timetable_entries')) {
      const key = values.slice(1, 2).concat(values.slice(5, 9)).join('|');
      this.timetable.set(key, {
        id: values[0] as string,
        facultyId: values[2] as string,
        facultyName: values[3] as string,
        room: values[4] as string,
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

describe('academic CSV import', () => {
  it('parses valid courses and recurring timetable entries', () => {
    const courses = parseCourses(coursesCsv);
    const faculty = parseFaculty('faculty_name\nMr. Anuj Kumar\n');
    const timetable = parseTimetable(timetableCsv, courses);

    assert.deepEqual(courses, [
      { courseCode: 'ARD201', courseName: 'Software Engineering' },
      { courseCode: 'ARD203', courseName: 'Analysis and Design of Algorithms' },
    ]);
    assert.equal(timetable.length, 2);
    assert.equal(timetable[0].batch, 'A');
    assert.equal(faculty[0].facultyName, 'Mr. Anuj Kumar');
    assert.equal(normalizeFacultyName('Kumar Mr. Anuj'), 'Mr. Anuj Kumar');
  });

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

  it('rejects missing columns, duplicates, invalid schedules, and unknown courses', () => {
    assert.throws(
      () => parseCourses('course_code\nARD201\n'),
      /missing required columns: course_name/,
    );
    assert.throws(
      () => parseCourses('course_code,course_name\nARD201,One\nARD201,Two\n'),
      /duplicate course_code ARD201/,
    );
    assert.throws(
      () =>
        parseTimetable(
          'day,start_time,end_time,course_code,batch,faculty_name,room\nMonday,11:00,10:00,ARD201,A,F,R\n',
          [{ courseCode: 'ARD201', courseName: 'One' }],
        ),
      /end_time must be after start_time/,
    );
    assert.throws(
      () =>
        parseTimetable(
          'day,start_time,end_time,course_code,batch,faculty_name,room\nSunday,09:00,10:00,ARD999,C,F,R\n',
          [],
        ),
      /unknown course_code ARD999/,
    );
  });

  it('imports idempotently and preserves existing course IDs', async () => {
    const client = new MockClient();
    const courses: CourseRow[] = parseCourses(coursesCsv);
    const timetable: TimetableRow[] = parseTimetable(timetableCsv, courses);
    const faculty = parseFaculty('faculty_name\nDemo Faculty\n');

    const first = await importAcademicData(fakePool(client), courses, timetable, faculty);
    const second = await importAcademicData(fakePool(client), courses, timetable, faculty);

    assert.deepEqual(first, {
      facultyImported: 1,
      coursesImported: 2,
      timetableEntriesImported: 2,
      timetableEntriesLinked: 2,
      studentsImported: 0,
    });
    assert.deepEqual(second, {
      facultyImported: 0,
      coursesImported: 0,
      timetableEntriesImported: 0,
      timetableEntriesLinked: 0,
      studentsImported: 0,
    });
    assert.equal(client.courses.size, 2);
    assert.equal(client.faculty.size, 1);
    assert.equal(client.timetable.size, 2);
  });

  it('imports provided students idempotently without changing existing values', async () => {
    const client = new MockClient();
    const students = parseStudents(studentsCsv);
    const courses = parseCourses(coursesCsv);
    const timetable = parseTimetable(timetableCsv, courses);
    const faculty = parseFaculty('faculty_name\nDemo Faculty\n');

    const first = await importAcademicData(
      fakePool(client),
      courses,
      timetable,
      faculty,
      students,
    );
    const second = await importAcademicData(
      fakePool(client),
      courses,
      timetable,
      faculty,
      students,
    );

    assert.equal(first.studentsImported, 5);
    assert.equal(second.studentsImported, 0);
    assert.equal(client.students.size, 5);
    assert.ok(client.students.has('03019051925'));
  });

  it('fails when a timetable faculty cannot be resolved', async () => {
    const client = new MockClient();
    const courses = parseCourses(coursesCsv);
    const timetable = parseTimetable(timetableCsv, courses);

    await assert.rejects(
      importAcademicData(fakePool(client), courses, timetable, []),
      /references unresolved faculty/,
    );
  });

  it('requires an enrollment directory for every student', async () => {
    await assert.rejects(
      validateEnrollmentDirectories(
        parseStudents(studentsCsv),
        'C:\\missing-enrollment-root',
      ),
      /Missing enrollment directory for student 14119051925/,
    );
  });
});
