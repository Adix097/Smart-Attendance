import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  importAcademicData,
  parseCourses,
  parseFaculty,
  parseStudents,
  parseTimetable,
  validateEnrollmentDirectories,
} from './import-data.js';
import { pool } from './pool.js';

async function run(): Promise<void> {
  const dataDirectory = path.resolve(process.cwd(), 'data');
  const students = parseStudents(
    await readFile(path.join(dataDirectory, 'students.csv'), 'utf8'),
  );
  await validateEnrollmentDirectories(
    students,
    path.join(dataDirectory, 'enrollment'),
  );
  const faculty = parseFaculty(
    await readFile(path.join(dataDirectory, 'faculty.csv'), 'utf8'),
  );
  const courses = parseCourses(
    await readFile(path.join(dataDirectory, 'courses.csv'), 'utf8'),
  );
  const timetable = parseTimetable(
    await readFile(path.join(dataDirectory, 'timetable.csv'), 'utf8'),
    courses,
  );
  const summary = await importAcademicData(pool, courses, timetable, faculty, students);
  console.log(
    `Imported ${summary.facultyImported} faculty, ${summary.coursesImported} courses, ` +
      `${summary.timetableEntriesImported} timetable entries, and linked ` +
      `${summary.timetableEntriesLinked} timetable faculty references; imported ` +
      `${summary.studentsImported} students`,
  );
}

run().catch((error: unknown) => {
  console.error('Academic data import failed', error);
  process.exitCode = 1;
});
