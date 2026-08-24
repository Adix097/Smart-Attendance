import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  deriveCoursesAndFacultyFromTimetable,
  importAcademicData,
  parseStudents,
  parseTimetable,
  timetableWarnings,
  validateEnrollmentDirectories,
} from './import-data.js';
import { pool } from './pool.js';

async function run(): Promise<void> {
  const dataDirectory = path.resolve(process.cwd(), 'data');
  const timetableDirectory = path.join(dataDirectory, 'timetables');

  const timetableFiles = (await readdir(timetableDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === '.csv')
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  if (timetableFiles.length === 0) {
    throw new Error(`No timetable CSV files found in ${timetableDirectory}`);
  }

  const timetable = (
    await Promise.all(
      timetableFiles.map(async (fileName) => {
        const room = path.basename(fileName, '.csv');
        const content = await readFile(path.join(timetableDirectory, fileName), 'utf8');
        return parseTimetable(content, `timetables/${fileName}`, room);
      }),
    )
  ).flat();

  const students = parseStudents(
    await readFile(path.join(dataDirectory, 'students.csv'), 'utf8'),
  );
  await validateEnrollmentDirectories(
    students,
    path.join(dataDirectory, 'enrollment'),
  );
  const { courses, faculty } = deriveCoursesAndFacultyFromTimetable(timetable);

  const warnings = timetableWarnings(timetable);
  if (warnings.length > 0) {
    console.warn(`${warnings.length} timetable data warnings:`);
    for (const warning of warnings) console.warn(`  ${warning}`);
  }

  const summary = await importAcademicData(pool, courses, timetable, faculty, students);
  console.log(
    [
      `Rooms discovered:   ${timetableFiles.length} (${timetableFiles
        .map((file) => path.basename(file, '.csv'))
        .join(', ')})`,
      `Timetable rows: ${timetable.length}`,
      `Distinct courses: ${courses.length}`,
      `Distinct faculty: ${faculty.length}`,
      `Inserted classrooms: ${summary.classroomsImported}`,
      `Inserted courses: ${summary.coursesImported}`,
      `Inserted faculty: ${summary.facultyImported}`,
      `Inserted timetable rows: ${summary.timetableEntriesImported}`,
      `Inserted students: ${summary.studentsImported}`,
      `Repeated rows skipped: ${summary.duplicateRowsSkipped}`,
    ].join('\n'),
  );
}

run().catch((error: unknown) => {
  console.error('Academic data import failed', error);
  process.exitCode = 1;
});
