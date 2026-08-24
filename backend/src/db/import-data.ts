import crypto from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

const requiredCourseColumns = ['course_code', 'course_name'];
const requiredTimetableColumns = [
  'day',
  'start_time',
  'end_time',
  'course_code',
  'batch',
  'faculty_name',
  'room',
];
const validDays = new Set([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
]);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const validBatches = new Set(['A', 'B', 'ALL']);

export interface CourseRow {
  courseCode: string;
  courseName: string;
}

export interface FacultyRow {
  facultyName: string;
}

export interface StudentRow {
  studentId: string;
  firstName: string;
  lastName: string;
  batch: string;
  group: string;
}

export interface TimetableRow {
  day: string;
  startTime: string;
  endTime: string;
  courseCode: string;
  batch: 'A' | 'B' | 'ALL';
  facultyName: string;
  room: string;
}

export interface ImportSummary {
  facultyImported: number;
  coursesImported: number;
  timetableEntriesImported: number;
  timetableEntriesLinked: number;
  studentsImported: number;
}

const facultyNameAliases: Record<string, string> = {
  'Kumar Mr. Anuj': 'Mr. Anuj Kumar',
  'Arora Dr. Amar': 'Dr. Amar Arora',
  'Jindal Ms. Kanika': 'Ms. Kanika Jindal',
  'Tripathi Dr. Atul': 'Dr. Atul Tripathi',
  'Priya Dr. Annu': 'Dr. Annu Priya',
  'Dalal Dr. Renu': 'Dr. Renu Dalal',
  'Sehgal Dr. Ruchika': 'Dr. Ruchika Sehgal',
  'Aggarwal Prof. Abha': 'Prof. Abha Aggarwal',
};

function parseCsv(content: string, fileName: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    if (character === '"' && quoted && next === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error(`${fileName}: unterminated quoted field`);
  row.push(field);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  if (rows.length === 0) throw new Error(`${fileName}: file is empty`);

  const headers = rows[0].map((header) => header.trim());
  const duplicates = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  if (duplicates.length > 0) {
    throw new Error(`${fileName}: duplicate columns: ${[...new Set(duplicates)].join(', ')}`);
  }

  return rows.slice(1).map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw new Error(
        `${fileName}: row ${rowIndex + 2} has ${values.length} fields; expected ${headers.length}`,
      );
    }
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index].trim()]),
    );
  });
}

function requireColumns(
  rows: Record<string, string>[],
  required: string[],
  fileName: string,
): void {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const missing = required.filter((column) => !columns.includes(column));
  if (missing.length > 0) {
    throw new Error(`${fileName}: missing required columns: ${missing.join(', ')}`);
  }
}

export function parseCourses(content: string): CourseRow[] {
  const fileName = 'courses.csv';
  const rows = parseCsv(content, fileName);
  requireColumns(rows, requiredCourseColumns, fileName);
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const line = index + 2;
    if (!row.course_code || !row.course_name) {
      throw new Error(`${fileName}: row ${line} requires course_code and course_name`);
    }
    if (seen.has(row.course_code)) {
      throw new Error(`${fileName}: duplicate course_code ${row.course_code}`);
    }
    seen.add(row.course_code);
    return { courseCode: row.course_code, courseName: row.course_name };
  });
}

export function parseFaculty(content: string): FacultyRow[] {
  const fileName = 'faculty.csv';
  const rows = parseCsv(content, fileName);
  requireColumns(rows, ['faculty_name'], fileName);
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const line = index + 2;
    if (!row.faculty_name) {
      throw new Error(`${fileName}: row ${line} requires faculty_name`);
    }
    const facultyName = normalizeFacultyName(row.faculty_name);
    if (seen.has(facultyName)) {
      throw new Error(`${fileName}: duplicate faculty_name ${facultyName}`);
    }
    seen.add(facultyName);
    return { facultyName };
  });
}

export function parseStudents(content: string): StudentRow[] {
  const fileName = 'students.csv';
  const rows = parseCsv(content, fileName);
  requireColumns(rows, ['student_id', 'first_name', 'last_name', 'batch', 'group'], fileName);
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const line = index + 2;
    for (const column of ['student_id', 'first_name', 'last_name', 'batch', 'group']) {
      if (!row[column]) throw new Error(`${fileName}: row ${line} requires ${column}`);
    }
    if (!/^\d+$/.test(row.student_id)) {
      throw new Error(`${fileName}: row ${line} student_id must be a digit string`);
    }
    if (seen.has(row.student_id)) {
      throw new Error(`${fileName}: duplicate student_id ${row.student_id}`);
    }
    if (!['A', 'B'].includes(row.group)) {
      throw new Error(`${fileName}: row ${line} group must be A or B`);
    }
    seen.add(row.student_id);
    return {
      studentId: row.student_id,
      firstName: row.first_name,
      lastName: row.last_name,
      batch: row.batch,
      group: row.group,
    };
  });
}

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp']);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function hasSupportedImageSignature(bytes: Buffer): boolean {
  const isJpeg =
    bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(pngSignature);
  const isBmp = bytes.length >= 2 && bytes.toString('ascii', 0, 2) === 'BM';
  const isWebp =
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP';
  return isJpeg || isPng || isBmp || isWebp;
}

export async function validateEnrollmentDirectories(
  students: StudentRow[],
  enrollmentRoot: string,
): Promise<void> {
  for (const student of students) {
    const directory = path.join(enrollmentRoot, student.studentId);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      throw new Error(
        `Missing enrollment directory for student ${student.studentId}: ${directory}`,
      );
    }

    const images = entries.filter(
      (entry) =>
        entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase()),
    );
    if (images.length === 0) {
      throw new Error(
        `Enrollment directory for student ${student.studentId} must contain at least one image`,
      );
    }

    for (const image of images) {
      const imagePath = path.join(directory, image.name);
      let bytes: Buffer;
      try {
        bytes = await readFile(imagePath);
      } catch {
        throw new Error(`Enrollment image is not readable: ${imagePath}`);
      }
      if (bytes.length === 0) {
        throw new Error(`Enrollment image is empty: ${imagePath}`);
      }
      if (!hasSupportedImageSignature(bytes)) {
        throw new Error(
          `Enrollment image is not a JPEG, PNG, BMP, or WebP file: ${imagePath}`,
        );
      }
    }
  }
}

export function normalizeFacultyName(sourceName: string): string {
  const normalized = sourceName.trim();
  return facultyNameAliases[normalized] ?? normalized;
}

export function parseTimetable(
  content: string,
  courses: CourseRow[],
): TimetableRow[] {
  const fileName = 'timetable.csv';
  const rows = parseCsv(content, fileName);
  requireColumns(rows, requiredTimetableColumns, fileName);
  const courseCodes = new Set(courses.map((course) => course.courseCode));

  return rows.map((row, index) => {
    const line = index + 2;
    for (const column of requiredTimetableColumns) {
      if (!row[column]) throw new Error(`${fileName}: row ${line} requires ${column}`);
    }
    if (!courseCodes.has(row.course_code)) {
      throw new Error(
        `${fileName}: row ${line} references unknown course_code ${row.course_code}`,
      );
    }
    if (!validDays.has(row.day)) {
      throw new Error(`${fileName}: row ${line} has invalid day ${row.day}`);
    }
    if (!timePattern.test(row.start_time) || !timePattern.test(row.end_time)) {
      throw new Error(`${fileName}: row ${line} has invalid time`);
    }
    if (row.start_time >= row.end_time) {
      throw new Error(`${fileName}: row ${line} end_time must be after start_time`);
    }
    if (!validBatches.has(row.batch)) {
      throw new Error(`${fileName}: row ${line} batch must be A, B, or ALL`);
    }
    return {
      day: row.day,
      startTime: row.start_time,
      endTime: row.end_time,
      courseCode: row.course_code,
      batch: row.batch as TimetableRow['batch'],
      facultyName: row.faculty_name,
      room: row.room,
    };
  });
}

export async function importAcademicData(
  database: Pool,
  courses: CourseRow[],
  timetable: TimetableRow[],
  faculty: FacultyRow[],
  students: StudentRow[] = [],
): Promise<ImportSummary> {
  const client = await database.connect();
  let facultyImported = 0;
  let coursesImported = 0;
  let timetableEntriesImported = 0;
  let timetableEntriesLinked = 0;
  let studentsImported = 0;
  try {
    await client.query('BEGIN');
    const facultyIds = new Map<string, string>();

    for (const member of faculty) {
      const existing = await client.query(
        'SELECT id FROM faculty WHERE name = $1',
        [member.facultyName],
      );
      if (existing.rows[0]) {
        facultyIds.set(member.facultyName, existing.rows[0].id);
        continue;
      }

      const id = crypto.randomUUID();
      await client.query(
        'INSERT INTO faculty (id, name) VALUES ($1, $2)',
        [id, member.facultyName],
      );
      facultyIds.set(member.facultyName, id);
      facultyImported += 1;
    }

    const courseIds = new Map<string, string>();

    for (const course of courses) {
      const existing = await client.query(
        'SELECT id, title FROM courses WHERE code = $1',
        [course.courseCode],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].title !== course.courseName) {
          throw new Error(
            `Course ${course.courseCode} conflicts: database has "${existing.rows[0].title}", CSV has "${course.courseName}"`,
          );
        }
        courseIds.set(course.courseCode, existing.rows[0].id);
        continue;
      }

      const id = crypto.randomUUID();
      await client.query(
        'INSERT INTO courses (id, code, title) VALUES ($1, $2, $3)',
        [id, course.courseCode, course.courseName],
      );
      courseIds.set(course.courseCode, id);
      coursesImported += 1;
    }

    for (const entry of timetable) {
      const courseId = courseIds.get(entry.courseCode);
      if (!courseId) throw new Error(`Missing imported course ${entry.courseCode}`);
      const facultyName = normalizeFacultyName(entry.facultyName);
      const facultyId = facultyIds.get(facultyName);
      if (!facultyId) {
        throw new Error(
          `Timetable entry ${entry.courseCode} ${entry.day} references unresolved faculty "${entry.facultyName}"`,
        );
      }
      const existing = await client.query(
        `SELECT id, faculty_id, faculty_name, room
         FROM timetable_entries
         WHERE course_id = $1 AND day_of_week = $2
           AND start_time = $3 AND end_time = $4 AND batch = $5`,
        [courseId, entry.day, entry.startTime, entry.endTime, entry.batch],
      );
      if (existing.rows[0]) {
        if (
          existing.rows[0].faculty_name !== entry.facultyName ||
          existing.rows[0].room !== entry.room
        ) {
          throw new Error(
            `Timetable conflict for ${entry.courseCode} ${entry.day} ${entry.startTime}-${entry.endTime} batch ${entry.batch}`,
          );
        }
        if (existing.rows[0].faculty_id !== facultyId) {
          await client.query(
            'UPDATE timetable_entries SET faculty_id = $2 WHERE id = $1',
            [existing.rows[0].id, facultyId],
          );
          timetableEntriesLinked += 1;
        }
        continue;
      }

      await client.query(
        `INSERT INTO timetable_entries (
           id, course_id, faculty_id, faculty_name, room,
           day_of_week, start_time, end_time, batch
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          crypto.randomUUID(),
          courseId,
          facultyId,
          entry.facultyName,
          entry.room,
          entry.day,
          entry.startTime,
          entry.endTime,
          entry.batch,
        ],
      );
      timetableEntriesImported += 1;
      timetableEntriesLinked += 1;
    }

    for (const student of students) {
      const existing = await client.query(
        `SELECT id, name, first_name, last_name, batch, student_group
         FROM students
         WHERE student_number = $1`,
        [student.studentId],
      );
      if (existing.rows[0]) {
        const matches =
          existing.rows[0].name === `${student.firstName} ${student.lastName}` &&
          existing.rows[0].first_name === student.firstName &&
          existing.rows[0].last_name === student.lastName &&
          existing.rows[0].batch === student.batch &&
          existing.rows[0].student_group === student.group;
        if (!matches) {
          throw new Error(
            `Student ${student.studentId} conflicts with existing master data`,
          );
        }
        continue;
      }

      await client.query(
        `INSERT INTO students (
           id, student_number, name, first_name, last_name, batch, student_group
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          crypto.randomUUID(),
          student.studentId,
          `${student.firstName} ${student.lastName}`,
          student.firstName,
          student.lastName,
          student.batch,
          student.group,
        ],
      );
      studentsImported += 1;
    }

    await client.query('COMMIT');
    return {
      facultyImported,
      coursesImported,
      timetableEntriesImported,
      timetableEntriesLinked,
      studentsImported,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
