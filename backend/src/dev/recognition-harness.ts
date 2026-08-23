import path from 'node:path';

import { config } from '../config.js';
import { pool } from '../db/pool.js';
import { PgAttendanceRepository } from '../modules/attendance/repository.js';

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function run(): Promise<void> {
  const imagePath = path.resolve(argument('--image'));
  const classSessionId = argument('--class-session');
  const repository = new PgAttendanceRepository(pool);

  if (!(await repository.classSessionExists(classSessionId))) {
    throw new Error(`Class session not found: ${classSessionId}`);
  }
  const expectedStudents = await repository.getEnrolledStudents(classSessionId);
  if (expectedStudents.length === 0) {
    throw new Error('Selected class session has no expected students');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiServiceTimeoutMs);
  let response: Response;
  try {
    response = await fetch(`${config.aiServiceUrl}/v1/dev/recognition-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        image_path: imagePath,
        enrollment_dir: config.enrollmentRoot,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof body === 'object' &&
        body !== null &&
        'detail' in body &&
        typeof body.detail === 'string'
        ? body.detail
        : `AI harness failed with HTTP ${response.status}`,
    );
  }

  const result = body as {
    model_name: string;
    model_version: string | null;
    sighting: {
      identity: string | null;
      status: string;
      best_similarity: number | null;
      tracker_id: string;
    } | null;
    warnings: string[];
  };
  const student = result.sighting?.identity
    ? (await repository.getStudentIdentityMap()).get(result.sighting.identity)
    : undefined;
  const expected = student
    ? expectedStudents.find((candidate) => candidate.id === student)
    : undefined;

  console.log(
    JSON.stringify(
      {
        diagnostic_only: true,
        image_path: imagePath,
        class_session_id: classSessionId,
        model_name: result.model_name,
        model_version: result.model_version,
        sighting: result.sighting,
        resolved_student: expected
          ? {
              id: expected.id,
              student_number: expected.studentNumber,
              name: expected.name,
              belongs_to_selected_class: true,
            }
          : result.sighting?.identity
            ? {
                identity: result.sighting.identity,
                belongs_to_selected_class: false,
              }
            : null,
        warnings: result.warnings,
        attendance_record_created: false,
      },
      null,
      2,
    ),
  );
}

run()
  .catch((error: unknown) => {
    console.error('Recognition harness failed', error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
