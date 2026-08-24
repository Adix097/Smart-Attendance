import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { AIServiceError } from '../src/integrations/ai-service/index.js';
import type {
  AIInferenceRequest,
  AIInferenceResponse,
} from '../src/integrations/ai-service/index.js';
import { createApp } from '../src/app.js';
import type {
  AIObservationInput,
  AttendanceObservation,
  AttendanceRecord,
  AttendanceRepository,
  AttendanceSession,
  AttendanceSessionDatabaseStatus,
  AttendanceContext,
  AttendanceSightingInput,
  ClassSessionOption,
  CreateAttendanceSessionInput,
  FinalizeAttendanceInput,
  ProvisionalAttendanceInput,
  EnrolledStudent,
} from '../src/modules/attendance/types.js';

class MockAttendanceRepository implements AttendanceRepository {
  readonly classSessions = new Set(['class-1']);
  readonly enrolled = new Map([['class-1', ['student-a', 'student-b', 'student-c']]]);
  readonly sessions = new Map<string, AttendanceSession>();
  readonly observations: AttendanceObservation[] = [];
  readonly records = new Map<string, AttendanceRecord>();
  readonly sightings: AttendanceSightingInput[] = [];
  readonly occupancy: Array<{ expected: number; observed: number }> = [];

  classSessionExists(classSessionId: string): Promise<boolean> {
    return Promise.resolve(this.classSessions.has(classSessionId));
  }

  getEnrolledStudentIds(classSessionId: string): Promise<string[]> {
    return Promise.resolve(this.enrolled.get(classSessionId) ?? []);
  }

  ensureUpcomingClassSession(): Promise<void> {
    return Promise.resolve();
  }

  getEnrolledStudents(classSessionId: string): Promise<EnrolledStudent[]> {
    return Promise.resolve(
      (this.enrolled.get(classSessionId) ?? []).map((id) => ({
        id,
        studentNumber: id,
        name: id,
        batch: null,
        group: null,
      })),
    );
  }

  createAttendanceContext(): Promise<void> {
    return Promise.resolve();
  }

  getExpectedStudents(): Promise<EnrolledStudent[]> {
    return this.getEnrolledStudents('class-1');
  }

  getStudentIdentityMap(): Promise<Map<string, EnrolledStudent>> {
    return Promise.resolve(new Map([
      ['student-a', { id: 'student-a', studentNumber: 'student-a', name: 'Student A', batch: null, group: null }],
      ['student-b', { id: 'student-b', studentNumber: 'student-b', name: 'Student B', batch: null, group: null }],
    ]));
  }

  getAttendanceContext(): Promise<AttendanceContext | null> {
    return Promise.resolve({
      scheduledStart: '2026-08-24T11:00:00.000Z',
      scheduledEnd: '2026-08-24T13:00:00.000Z',
      entryDeadline: '2026-08-24T11:15:00.000Z',
    });
  }

  storeAttendanceSightings(
    _attendanceSessionId: string,
    sightings: AttendanceSightingInput[],
  ): Promise<void> {
    this.sightings.push(...sightings);
    return Promise.resolve();
  }

  storeOccupancySnapshot(
    _sessionId: string,
    _observedAt: string,
    expectedCount: number,
    observedCount: number,
  ): Promise<void> {
    this.occupancy.push({ expected: expectedCount, observed: observedCount });
    return Promise.resolve();
  }

  getClassSessionOptions(): Promise<ClassSessionOption[]> {
    return Promise.resolve([{
      id: 'class-1',
      courseCode: 'ARD253',
      courseTitle: 'Computer Networking (Lab)',
      facultyName: 'Mr. Anuj Kumar',
      classroomName: 'AUB-03-Com Lab',
      scheduledStart: '2026-08-24T11:00:00.000Z',
      scheduledEnd: '2026-08-24T13:00:00.000Z',
      students: [{
        id: 'student-a',
        studentNumber: '14119051925',
        name: 'aditya vishwakarma',
        batch: 'B2',
        group: 'B',
      }],
    }]);
  }

  createAttendanceSession(input: CreateAttendanceSessionInput): Promise<AttendanceSession> {
    const existing = [...this.sessions.values()].find(
      (session) => session.classSessionId === input.classSessionId,
    );
    if (existing) return Promise.resolve(existing);
    const session: AttendanceSession = {
      id: input.id,
      classSessionId: input.classSessionId,
      status: input.status ?? 'open',
      processingError: null,
    };
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  }

  getAttendanceSession(id: string): Promise<AttendanceSession | null> {
    return Promise.resolve(this.sessions.get(id) ?? null);
  }

  updateAttendanceSessionStatus(
    id: string,
    status: AttendanceSessionDatabaseStatus,
    processingError: string | null = null,
  ): Promise<AttendanceSession> {
    const session = this.sessions.get(id);
    assert(session);
    session.status = status;
    session.processingError = processingError;
    return Promise.resolve(session);
  }

  storeAIObservations(
    attendanceSessionId: string,
    inputs: AIObservationInput[],
  ): Promise<AttendanceObservation[]> {
    const stored = inputs.map((input) => ({ ...input, attendanceSessionId }));
    this.observations.push(...stored);
    return Promise.resolve(stored);
  }

  upsertProvisionalAttendance(input: ProvisionalAttendanceInput): Promise<AttendanceRecord> {
    const existing = [...this.records.values()].find(
      (record) =>
        record.attendanceSessionId === input.attendanceSessionId &&
        record.studentId === input.studentId,
    );
    const record: AttendanceRecord = {
      ...input,
      id: existing?.id ?? input.id,
      finalizedBy: existing?.finalizedBy ?? null,
      finalizedAt: existing?.finalizedAt ?? null,
      verificationResult: input.verificationResult ?? null,
      firstSeen: input.firstSeen ?? null,
      lastSeen: input.lastSeen ?? null,
      totalSightings: input.totalSightings ?? 0,
      lateEntry: input.lateEntry ?? false,
    };
    this.records.set(record.id, record);
    return Promise.resolve(record);
  }

  finalizeAttendance(input: FinalizeAttendanceInput): Promise<AttendanceRecord> {
    const record = this.records.get(input.recordId);
    assert(record);
    if (input.status) record.status = input.status;
    record.finalizedBy = input.finalizedBy;
    record.finalizedAt = '2026-08-23T10:00:00.000Z';
    return Promise.resolve(record);
  }

  getAttendanceRecords(attendanceSessionId: string): Promise<AttendanceRecord[]> {
    return Promise.resolve(
      [...this.records.values()].filter(
        (record) => record.attendanceSessionId === attendanceSessionId,
      ),
    );
  }

  getAttendanceObservations(
    attendanceSessionId: string,
  ): Promise<AttendanceObservation[]> {
    return Promise.resolve(
      this.observations.filter(
        (observation) => observation.attendanceSessionId === attendanceSessionId,
      ),
    );
  }
}

const inferenceResponse: AIInferenceResponse = {
  schema_version: '1.0',
  model_name: 'buffalo_l',
  model_version: '1.0.1',
  processing_time_seconds: 1,
  video: {
    path: 'C:\\demo\\classroom.mp4',
    total_frames: 100,
    source_fps: 25,
    duration_seconds: 4,
  },
  sampling: { requested_fps: 2, frame_interval: 13 },
  detected_faces: 3,
  sampled_frames: 8,
  results: [
    {
      identity: 'student-a',
      status: 'confirmed',
      observation_count: 5,
      best_similarity: 0.91,
      average_similarity: 0.87,
      second_best_similarity: 0.32,
      identity_margin: 0.59,
    },
    {
      identity: 'student-b',
      status: 'uncertain',
      observation_count: 2,
      best_similarity: 0.68,
      average_similarity: 0.65,
      second_best_similarity: 0.61,
      identity_margin: 0.07,
    },
    {
      identity: 'unknown',
      status: 'unknown',
      observation_count: 1,
      best_similarity: 0.2,
      average_similarity: 0.2,
      second_best_similarity: null,
      identity_margin: null,
    },
  ],
  errors: [],
  warnings: [],
  sightings: [
    {
      timestamp_seconds: 0,
      tracker_id: 'track-001',
      identity: 'student-a',
      status: 'confirmed',
      best_similarity: 0.91,
      second_best_similarity: 0.32,
      identity_margin: 0.59,
      bbox: { x: 10, y: 10, width: 20, height: 20 },
    },
    {
      timestamp_seconds: 5400,
      tracker_id: 'track-001',
      identity: 'student-a',
      status: 'confirmed',
      best_similarity: 0.91,
      second_best_similarity: 0.32,
      identity_margin: 0.59,
    },
    {
      timestamp_seconds: 7199,
      tracker_id: 'track-001',
      identity: 'student-a',
      status: 'confirmed',
      best_similarity: 0.91,
      second_best_similarity: 0.32,
      identity_margin: 0.59,
    },
  ],
};

let server: Server;
let baseUrl: string;
let repository: MockAttendanceRepository;

function startBackend(
  inferenceHandler: (request: AIInferenceRequest) => Promise<AIInferenceResponse>,
): Promise<void> {
  return new Promise((resolve) => {
    server = createServer(
      createApp(inferenceHandler, { attendanceRepository: repository }),
    );
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert(address && typeof address === 'object');
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

function stopBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function request(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, options);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

before(async () => {
  repository = new MockAttendanceRepository();
  await startBackend(async () => inferenceResponse);
});

after(async () => {
  await stopBackend();
});

describe('attendance session API', () => {
  it('creates a session for an existing class session', async () => {
    const response = await postJson('/api/attendance-sessions', {
      class_session_id: 'class-1',
    });

    it('retrieves persisted class-session options with enrolled students', async () => {
      const response = await request('/api/attendance-classes');
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.classes[0].courseCode, 'ARD253');
      assert.equal(body.classes[0].students[0].studentNumber, '14119051925');
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.class_session_id, 'class-1');
    assert.equal(body.status, 'pending');
    assert.equal(typeof body.id, 'string');
  });

  it('persists all evidence and provisional recognized attendance', async () => {
    const sessionId = [...repository.sessions.keys()][0];
    const response = await postJson(`/api/attendance-sessions/${sessionId}/process`, {
      video_path: 'C:\\demo\\classroom.mp4',
      enrollment_dir: 'C:\\demo\\enrollment',
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.session.status, 'completed');
    assert.equal(body.observation_count, 3);
    assert.equal(repository.observations.length, 3);
    assert.equal(repository.sightings.length, 3);
    assert.deepEqual(repository.occupancy[0], { expected: 3, observed: 1 });
    assert.deepEqual(
      repository.observations.map((observation) => [
        observation.studentId,
        observation.status,
      ]),
      [
        ['student-a', 'confirmed'],
        ['student-b', 'uncertain'],
        [null, 'unknown'],
      ],
    );
    assert.deepEqual(
      [...repository.records.values()].map((record) => [
        record.studentId,
        record.status,
      ]),
      [
        ['student-a', 'present'],
        ['student-b', 'uncertain'],
      ],
    );
  });

  it('retrieves status, observations, and records', async () => {
    const sessionId = [...repository.sessions.keys()][0];

    const status = await request(`/api/attendance-sessions/${sessionId}/status`);
    const observations = await request(
      `/api/attendance-sessions/${sessionId}/observations`,
    );
    const records = await request(`/api/attendance-sessions/${sessionId}/records`);

    assert.equal((await status.json()).status, 'completed');
    assert.equal((await observations.json()).observations.length, 3);
    assert.equal((await records.json()).records.length, 2);
  });

  it('finalizes a reviewed provisional record with the selected status', async () => {
    const sessionId = [...repository.sessions.keys()][0];
    const record = [...repository.records.values()][0];
    const response = await postJson(`/api/attendance-sessions/${sessionId}/finalize`, {
      record_id: record.id,
      finalized_by: 'faculty-demo',
      status: 'present',
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.record.status, 'present');
    assert.equal(body.record.finalizedBy, 'faculty-demo');
  });

  it('marks the session failed when the AI service fails', async () => {
    await stopBackend();
    repository = new MockAttendanceRepository();
    const session = await repository.createAttendanceSession({
      id: 'failed-session',
      classSessionId: 'class-1',
    });
    await startBackend(async () => {
      throw new AIServiceError('AI_SERVICE_UNAVAILABLE', 'AI service unavailable');
    });

    const response = await postJson(`/api/attendance-sessions/${session.id}/process`, {
      video_path: 'C:\\demo\\classroom.mp4',
      enrollment_dir: 'C:\\demo\\enrollment',
    });
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.error.code, 'AI_SERVICE_UNAVAILABLE');
    assert.equal(body.session.status, 'failed');
    assert.match(body.session.error, /AI service unavailable/);
    assert.equal(repository.observations.length, 0);
    assert.equal(repository.records.size, 0);
  });
});
