import crypto from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

const timetableColumnsWithName = [
  'course_code',
  'course_name',
  'faculty_name',
  'weekday',
  'start_time',
  'end_time',
  'class',
  'batch',
];
const timetableColumnsWithoutName = timetableColumnsWithName.filter(
  (column) => column !== 'course_name',
);
const validDays = new Set([
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
]);
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface CourseRow {
  courseCode: string;
  courseName: string | null;
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
  sourceFile: string;
  sourceLine: number;
  day: string;
  startTime: string;
  endTime: string;
  courseCode: string;
  courseName: string | null;
  className: string;
  batch: string;
  facultyName: string;
  room: string;
}

export interface ImportSummary {
  facultyImported: number;
  coursesImported: number;
  classroomsImported: number;
  timetableEntriesImported: number;
  studentsImported: number;
  duplicateRowsSkipped: number;
}

function parseCsvRows(content: string, fileName: string): string[][] {
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
  return rows.map((values) => values.map((value) => value.trim()));
}

function parseCsv(content: string, fileName: string): Record<string, string>[] {
  const rows = parseCsvRows(content, fileName);
  const headers = rows[0];
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
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function requireColumns(rows: Record<string, string>[], required: string[], fileName: string): void {
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const missing = required.filter((column) => !columns.includes(column));
  if (missing.length > 0) {
    throw new Error(`${fileName}: missing required columns: ${missing.join(', ')}`);
  }
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
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.length >= 8 && bytes.subarray(0, 8).equals(pngSignature);
  const isBmp = bytes.length >= 2 && bytes.toString('ascii', 0, 2) === 'BM';
  const isWebp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return isJpeg || isPng || isBmp || isWebp;
}

export async function validateEnrollmentDirectories(students: StudentRow[], enrollmentRoot: string): Promise<void> {
  for (const student of students) {
    const directory = path.join(enrollmentRoot, student.studentId);
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      throw new Error(`Missing enrollment directory for student ${student.studentId}: ${directory}`);
    }

    const images = entries.filter(
      (entry) => entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase()),
    );
    if (images.length === 0) {
      throw new Error(`Enrollment directory for student ${student.studentId} must contain at least one image`);
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
        throw new Error(`Enrollment image is not a JPEG, PNG, BMP, or WebP file: ${imagePath}`);
      }
    }
  }
}

export function parseTimetable(
  content: string,
  sourceFile: string,
  room: string,
): TimetableRow[] {
  if (!room) throw new Error(`${sourceFile}: room is required from the file name`);
  const rows = parseCsvRows(content, sourceFile);
  const header = rows[0];
  if (
    header.join(',') !== timetableColumnsWithName.join(',') &&
    header.join(',') !== timetableColumnsWithoutName.join(',')
  ) {
    throw new Error(
      `${sourceFile}: unexpected header "${header.join(',')}"; expected ${timetableColumnsWithName.join(',')}`,
    );
  }

  return rows.slice(1).map((values, index) => {
    const line = index + 2;
    let columns: string[];
    if (values.length === timetableColumnsWithName.length) {
      columns = timetableColumnsWithName;
    } else if (values.length === timetableColumnsWithoutName.length) {
      columns = timetableColumnsWithoutName;
    } else {
      throw new Error(
        `${sourceFile}: row ${line} has ${values.length} fields; expected ` +
        `${timetableColumnsWithoutName.length} or ${timetableColumnsWithName.length}`,
      );
    }
    const row = Object.fromEntries(columns.map((column, at) => [column, values[at]]));

    for (const column of timetableColumnsWithoutName) {
      if (!row[column]) throw new Error(`${sourceFile}: row ${line} requires ${column}`);
    }
    if (!validDays.has(row.weekday)) {
      throw new Error(`${sourceFile}: row ${line} has invalid day ${row.weekday}`);
    }
    if (!timePattern.test(row.start_time) || !timePattern.test(row.end_time)) {
      throw new Error(`${sourceFile}: row ${line} has invalid time`);
    }
    if (row.start_time >= row.end_time) {
      throw new Error(`${sourceFile}: row ${line} end_time must be after start_time`);
    }
    return {
      sourceFile,
      sourceLine: line,
      day: row.weekday,
      startTime: row.start_time,
      endTime: row.end_time,
      courseCode: row.course_code,
      courseName: row.course_name ?? null,
      className: row.class,
      batch: row.batch,
      facultyName: row.faculty_name,
      room,
    };
  });
}

function entryKey(row: TimetableRow): string {
  return [row.room, row.courseCode, row.day, row.startTime, row.endTime, row.className, row.batch].join('|');
}


// Reports data problems that should not stop the import: the source timetables
// contain repeated rows and slots where one room hosts two classes at once.
export function timetableWarnings(timetable: TimetableRow[]): string[] {
  const warnings: string[] = [];
  const seen = new Map<string, TimetableRow>();
  const slots = new Map<string, TimetableRow[]>();

  for (const row of timetable) {
    const key = entryKey(row);
    const previous = seen.get(key);
    if (previous) {
      warnings.push(
        `${row.sourceFile}: row ${row.sourceLine} repeats row ${previous.sourceLine} ` +
        `(${row.courseCode} ${row.day} ${row.startTime}); only one entry is stored`,
      );
      if (previous.facultyName !== row.facultyName) {
        warnings.push(
          `${row.sourceFile}: row ${row.sourceLine} names faculty "${row.facultyName}" ` +
          `but row ${previous.sourceLine} names "${previous.facultyName}"`,
        );
      }
    } else {
      seen.set(key, row);
    }
    const slot = `${row.room}|${row.day}|${row.startTime}`;
    const existing = slots.get(slot);
    if (existing) existing.push(row);
    else slots.set(slot, [row]);
  }

  for (const [slot, rows] of slots) {
    const distinct = new Set(rows.map(entryKey));
    if (distinct.size > 1) {
      const [room, day, startTime] = slot.split('|');
      warnings.push(
        `${room} is double-booked on ${day} at ${startTime}: ` +
        rows.map((row) => `${row.courseCode}/${row.className}/${row.batch}`).join(', '),
      );
    }
  }
  return warnings;
}

export function deriveCoursesAndFacultyFromTimetable(timetable: TimetableRow[]): { courses: CourseRow[]; faculty: FacultyRow[] } {
  const coursesByCode = new Map<string, string | null>();
  const facultyNames = new Set<string>();
  for (const row of timetable) {
    const known = coursesByCode.get(row.courseCode) ?? null;
    if (known && row.courseName && known !== row.courseName) {
      throw new Error(
        `${row.sourceFile}: row ${row.sourceLine} course_code ${row.courseCode} has conflicting course_name values`,
      );
    }
    coursesByCode.set(row.courseCode, known ?? row.courseName);
    facultyNames.add(row.facultyName);
  }
  return {
    courses: [...coursesByCode.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([courseCode, courseName]) => ({ courseCode, courseName })),
    faculty: [...facultyNames]
      .sort((a, b) => a.localeCompare(b))
      .map((facultyName) => ({ facultyName })),
  };
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
  let classroomsImported = 0;
  let timetableEntriesImported = 0;
  let studentsImported = 0;
  let duplicateRowsSkipped = 0;
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
    const classroomIds = new Map<string, string>();

    for (const course of courses) {
      const existing = await client.query(
        'SELECT id, title FROM courses WHERE code = $1',
        [course.courseCode],
      );
      if (existing.rows[0]) {
        // The room files carry no course name, so an existing title is kept.
        if (course.courseName && existing.rows[0].title !== course.courseName) {
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
        [id, course.courseCode, course.courseName ?? course.courseCode],
      );
      courseIds.set(course.courseCode, id);
      coursesImported += 1;
    }

    const rooms = [...new Set(timetable.map((entry) => entry.room))];
    for (const roomName of rooms) {
      const existing = await client.query(
        'SELECT id FROM classrooms WHERE name = $1',
        [roomName],
      );
      if (existing.rows[0]) {
        classroomIds.set(roomName, existing.rows[0].id as string);
        continue;
      }
      const id = crypto.randomUUID();
      await client.query(
        'INSERT INTO classrooms (id, name, capacity) VALUES ($1, $2, NULL)',
        [id, roomName],
      );
      classroomIds.set(roomName, id);
      classroomsImported += 1;
    }

    const importedKeys = new Set<string>();
    for (const entry of timetable) {
      if (importedKeys.has(entryKey(entry))) {
        duplicateRowsSkipped += 1;
        continue;
      }
      importedKeys.add(entryKey(entry));

      const courseId = courseIds.get(entry.courseCode);
      if (!courseId) throw new Error(`Missing imported course ${entry.courseCode}`);
      const classroomId = classroomIds.get(entry.room);
      if (!classroomId) throw new Error(`Missing imported classroom ${entry.room}`);
      const facultyId = facultyIds.get(entry.facultyName);
      if (!facultyId) {
        throw new Error(
          `${entry.sourceFile}: row ${entry.sourceLine} references unresolved faculty "${entry.facultyName}"`,
        );
      }
      const existing = await client.query(
        `SELECT id, faculty_name FROM timetable_entries
         WHERE course_id = $1 AND classroom_id = $2 AND day_of_week = $3
           AND start_time = $4 AND end_time = $5 AND batch = $6 AND class_name = $7`,
        [courseId, classroomId, entry.day, entry.startTime, entry.endTime, entry.batch, entry.className],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].faculty_name !== entry.facultyName) {
          throw new Error(
            `${entry.sourceFile}: row ${entry.sourceLine} assigns "${entry.facultyName}" to a slot ` +
            `already held by "${existing.rows[0].faculty_name as string}"`,
          );
        }
        continue;
      }

      await client.query(
        `INSERT INTO timetable_entries (
           id, course_id, faculty_id, faculty_name, classroom_id, room,
           day_of_week, start_time, end_time, batch, class_name
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          crypto.randomUUID(),
          courseId,
          facultyId,
          entry.facultyName,
          classroomId,
          entry.room,
          entry.day,
          entry.startTime,
          entry.endTime,
          entry.batch,
          entry.className,
        ],
      );
      timetableEntriesImported += 1;
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
      classroomsImported,
      timetableEntriesImported,
      studentsImported,
      duplicateRowsSkipped,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
