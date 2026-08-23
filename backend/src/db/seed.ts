import { pool } from './pool.js';

const ids = {
  facultyUser: '00000000-0000-0000-0000-000000000001',
  faculty: '00000000-0000-0000-0000-000000000002',
  course: '00000000-0000-0000-0000-000000000003',
  classroom: '00000000-0000-0000-0000-000000000004',
  classSession: '00000000-0000-0000-0000-000000000005',
  attendanceSession: '00000000-0000-0000-0000-000000000006',
  studentUserA: '00000000-0000-0000-0000-000000000011',
  studentA: '00000000-0000-0000-0000-000000000012',
  studentUserB: '00000000-0000-0000-0000-000000000013',
  studentB: '00000000-0000-0000-0000-000000000014',
  studentUserC: '00000000-0000-0000-0000-000000000015',
  studentC: '00000000-0000-0000-0000-000000000016',
};

async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (id, email, display_name, role)
       VALUES
         ($1, 'faculty.demo@example.edu', 'Demo Faculty', 'faculty'),
         ($2, 'student.a@example.edu', 'Student A', 'student'),
         ($3, 'student.b@example.edu', 'Student B', 'student'),
         ($4, 'student.c@example.edu', 'Student C', 'student')
       ON CONFLICT (id) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         role = EXCLUDED.role`,
      [
        ids.facultyUser,
        ids.studentUserA,
        ids.studentUserB,
        ids.studentUserC,
      ],
    );
    await client.query(
      `INSERT INTO faculty (id, user_id, faculty_number, name)
       VALUES ($1, $2, 'FAC-DEMO-001', 'Demo Faculty')
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         faculty_number = EXCLUDED.faculty_number,
         name = EXCLUDED.name`,
      [ids.faculty, ids.facultyUser],
    );
    await client.query(
      `INSERT INTO students (id, user_id, student_number, name, programme)
       VALUES
         ($1, $2, 'USAR-DEMO-001', 'Student A', 'B.Tech Automation & Robotics'),
         ($3, $4, 'USAR-DEMO-002', 'Student B', 'B.Tech Automation & Robotics'),
         ($5, $6, 'USAR-DEMO-003', 'Student C', 'B.Tech Automation & Robotics')
       ON CONFLICT (id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         student_number = EXCLUDED.student_number,
         name = EXCLUDED.name,
         programme = EXCLUDED.programme`,
      [
        ids.studentA,
        ids.studentUserA,
        ids.studentB,
        ids.studentUserB,
        ids.studentC,
        ids.studentUserC,
      ],
    );
    await client.query(
      `INSERT INTO courses (id, code, title)
       VALUES ($1, 'SAR-DEMO-101', 'Smart Automation Foundations')
       ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, title = EXCLUDED.title`,
      [ids.course],
    );
    await client.query(
      `INSERT INTO classrooms (id, name, capacity)
       VALUES ($1, 'USAR Demo Classroom', 60)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, capacity = EXCLUDED.capacity`,
      [ids.classroom],
    );
    await client.query(
      `INSERT INTO enrollments (id, course_id, student_id)
       VALUES
         ('00000000-0000-0000-0000-000000000021', $1, $2),
         ('00000000-0000-0000-0000-000000000022', $1, $3),
         ('00000000-0000-0000-0000-000000000023', $1, $4)
       ON CONFLICT (course_id, student_id) DO NOTHING`,
      [ids.course, ids.studentA, ids.studentB, ids.studentC],
    );
    await client.query(
      `INSERT INTO class_sessions (
         id, course_id, faculty_id, classroom_id, scheduled_start, scheduled_end
       )
       VALUES ($1, $2, $3, $4, '2026-08-24T09:00:00Z', '2026-08-24T10:00:00Z')
       ON CONFLICT (id) DO UPDATE SET
         course_id = EXCLUDED.course_id,
         faculty_id = EXCLUDED.faculty_id,
         classroom_id = EXCLUDED.classroom_id,
         scheduled_start = EXCLUDED.scheduled_start,
         scheduled_end = EXCLUDED.scheduled_end`,
      [ids.classSession, ids.course, ids.faculty, ids.classroom],
    );
    await client.query(
      `INSERT INTO attendance_sessions (id, class_session_id, status)
       VALUES ($1, $2, 'open')
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
      [ids.attendanceSession, ids.classSession],
    );
    await client.query('COMMIT');
    console.log('Seeded deterministic classroom scenario');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  console.error('Database seed failed', error);
  process.exitCode = 1;
});
