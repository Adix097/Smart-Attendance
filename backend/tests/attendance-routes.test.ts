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
  ClassroomOccurrence,
  ClassroomOption,
  ClassroomTimetableEntry,
  ClassSessionOption,
  CreateAttendanceSessionInput,
  FinalizeAttendanceInput,
  ProvisionalAttendanceInput,
  EnrolledStudent,
} from '../src/modules/attendance/types.js';

class MockAttendanceRepository implements AttendanceRepository {
  readonly classSessions = new Set([
    'class-1',
    'class-failed-reset',
    'class-reuse-open',
  ]);
  readonly enrolled = new Map([['class-1', ['student-a', 'student-b', 'student-c']]]);
  readonly sessions = new Map<string, AttendanceSession>();
  readonly observations: AttendanceObservation[] = [];
  readonly records = new Map<string, AttendanceRecord>();
  readonly sightings: AttendanceSightingInput[] = [];
  readonly occupancy: Array<{ expected: number; observed: number }> = [];

  classSessionExists(classSessionId: string): Promise<boolean> {
    return Promise.resolve(this.classSessions.has(classSessionId));
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

  /**
   * A two-hour window that has already ended, expressed relative to now so the
   * suite does not depend on the wall clock. Individual tests move the window to
   * exercise upcoming and active classes.
   */
  contextStart = new Date(Date.now() - 3 * 60 * 60 * 1000);
  contextEnd = new Date(Date.now() - 60 * 60 * 1000);
  contextMissing = false;

  getAttendanceContext(): Promise<AttendanceContext | null> {
    if (this.contextMissing) return Promise.resolve(null);
    return Promise.resolve({
      scheduledStart: this.contextStart.toISOString(),
      scheduledEnd: this.contextEnd.toISOString(),
      entryDeadline: new Date(
        this.contextStart.getTime() + 15 * 60 * 1000,
      ).toISOString(),
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

  lastClassroomFilter: string | undefined;

  getClassSessionOptions(classroomId?: string): Promise<ClassSessionOption[]> {
    this.lastClassroomFilter = classroomId;
    return Promise.resolve([{
      id: 'class-1',
      classroomId: 'room-1',
      courseCode: 'ARD253',
      courseTitle: 'Computer Networking (Lab)',
      facultyName: 'Dalal Dr. Renu',
      className: 'AIDS-III',
      classroomName: 'A-204',
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

  getClassrooms(): Promise<ClassroomOption[]> {
    return Promise.resolve([{ id: 'room-1', name: 'A-204' }]);
  }

  classroomExists(classroomId: string): Promise<boolean> {
    return Promise.resolve(classroomId === 'room-1');
  }

  getClassroomTimetable(): Promise<ClassroomTimetableEntry[]> {
    return Promise.resolve([
      {
        id: 'entry-1',
        courseCode: 'ARD253',
        courseName: 'Computer Networking (Lab)',
        facultyName: 'Dalal Dr. Renu',
        className: 'AIDS-III',
        batch: 'BI B',
        startTime: '10:00',
        endTime: '11:00',
        weekday: 'Monday',
        room: 'A-204',
      },
    ]);
  }

  getClassroomOccurrence(): Promise<ClassroomOccurrence | null> {
    return Promise.resolve({
      entryId: 'entry-1',
      status: 'active',
      scheduledStart: '2026-08-24T04:30:00.000Z',
      scheduledEnd: '2026-08-24T05:30:00.000Z',
    });
  }

  createAttendanceSession(input: CreateAttendanceSessionInput): Promise<AttendanceSession> {
    const existing = [...this.sessions.values()].find(
      (session) => session.classSessionId === input.classSessionId,
    );
    if (existing) {
      if (existing.status === 'failed') {
        existing.status = input.status ?? 'open';
        existing.processingError = null;
      }
      return Promise.resolve(existing);
    }
    const session: AttendanceSession = {
      id: input.id,
      classSessionId: input.classSessionId,
      status: input.status ?? 'open',
      processingError: null,
    };
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  }

  getAttendanceSessionForClass(classSessionId: string): Promise<AttendanceSession | null> {
    return Promise.resolve(
      [...this.sessions.values()].find(
        (session) => session.classSessionId === classSessionId,
      ) ?? null,
    );
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
  it('retrieves persisted class-session options with enrolled students', async () => {
    const response = await request('/api/attendance-classes');
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.classes[0].courseCode, 'ARD253');
    assert.equal(body.classes[0].students[0].studentNumber, '14119051925');
  });

  it('lists the classrooms that have a timetable', async () => {
    const response = await request('/api/classrooms');
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.classrooms, [{ id: 'room-1', name: 'A-204' }]);
  });

  it('returns a room timetable with its active occurrence', async () => {
    const response = await request('/api/classrooms/room-1/timetable');
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.timetable.length, 1);
    assert.equal(body.timetable[0].room, 'A-204');
    assert.equal(body.timetable[0].className, 'AIDS-III');
    assert.equal(body.timetable[0].batch, 'BI B');
    assert.equal(body.timetable[0].weekday, 'Monday');
    assert.equal(body.occurrence.entryId, 'entry-1');
    assert.equal(body.occurrence.status, 'active');
    assert.equal(body.timeZone, 'Asia/Kolkata');
  });

  it('rejects a timetable request for an unknown classroom', async () => {
    const response = await request('/api/classrooms/does-not-exist/timetable');
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error.code, 'CLASSROOM_NOT_FOUND');
  });

  it('passes a classroom filter through to the class-session lookup', async () => {
    const response = await request('/api/attendance-classes?classroom_id=room-1');

    assert.equal(response.status, 200);
    assert.equal(repository.lastClassroomFilter, 'room-1');
  });

  it('creates a session for an existing class session', async () => {
    const response = await postJson('/api/attendance-sessions', {
      class_session_id: 'class-1',
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.class_session_id, 'class-1');
    assert.equal(body.status, 'pending');
    assert.equal(typeof body.id, 'string');
  });

  it('resets a previously failed session instead of returning the stale error', async () => {
    const failed = await repository.createAttendanceSession({
      id: 'stale-failed',
      classSessionId: 'class-failed-reset',
      status: 'open',
    });
    await repository.updateAttendanceSessionStatus(
      failed.id,
      'failed',
      "Model 'buffalo_l' is too large for a 512MiB instance",
    );

    const response = await postJson('/api/attendance-sessions', {
      class_session_id: 'class-failed-reset',
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.id, failed.id);
    assert.equal(body.status, 'pending');
    assert.equal(body.error, null);

    const stored = await repository.getAttendanceSession(failed.id);
    assert.equal(stored?.status, 'open');
    assert.equal(stored?.processingError, null);
  });

  it('reuses an open session without clearing it', async () => {
    const first = await postJson('/api/attendance-sessions', {
      class_session_id: 'class-reuse-open',
    });
    const created = await first.json();

    const second = await postJson('/api/attendance-sessions', {
      class_session_id: 'class-reuse-open',
    });
    const reused = await second.json();

    assert.equal(second.status, 200);
    assert.equal(reused.id, created.id);
    assert.equal(reused.status, 'pending');
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

  it('forwards an uploaded recording as bytes rather than a backend file path', async () => {
    await stopBackend();
    repository = new MockAttendanceRepository();
    const session = await repository.createAttendanceSession({
      id: 'upload-session',
      classSessionId: 'class-1',
    });
    let forwarded: AIInferenceRequest | null = null;
    await startBackend(async (aiRequest) => {
      forwarded = aiRequest;
      return inferenceResponse;
    });

    const response = await postJson(`/api/attendance-sessions/${session.id}/process`, {
      video_filename: 'classroom.mp4',
      video_data_base64: Buffer.from('demo-video').toString('base64'),
    });

    assert.equal(response.status, 200);
    assert(forwarded);
    const sent = forwarded as AIInferenceRequest;
    assert.equal(sent.video_path, undefined);
    assert.equal(sent.video_filename, 'classroom.mp4');
    assert.equal(sent.video_data_base64, Buffer.from('demo-video').toString('base64'));
  });

  it('rejects an unsupported upload format without calling the AI service', async () => {
    await stopBackend();
    repository = new MockAttendanceRepository();
    const session = await repository.createAttendanceSession({
      id: 'bad-format-session',
      classSessionId: 'class-1',
    });
    let called = false;
    await startBackend(async () => {
      called = true;
      return inferenceResponse;
    });

    const response = await postJson(`/api/attendance-sessions/${session.id}/process`, {
      video_filename: 'classroom.txt',
      video_data_base64: Buffer.from('demo-video').toString('base64'),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(called, false);
    assert.equal(body.error.code, 'INVALID_REQUEST');
    assert.match(body.error.message, /Unsupported video format/);
    assert.equal(repository.sessions.get(session.id)?.status, 'open');
  });

  it('refuses to process a class that has not started and leaves it pending', async () => {
    await stopBackend();
    repository = new MockAttendanceRepository();
    repository.contextStart = new Date(Date.now() + 60 * 60 * 1000);
    repository.contextEnd = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const session = await repository.createAttendanceSession({
      id: 'upcoming-session',
      classSessionId: 'class-1',
    });
    let called = false;
    await startBackend(async () => {
      called = true;
      return inferenceResponse;
    });

    const response = await postJson(`/api/attendance-sessions/${session.id}/process`, {
      video_path: 'C:\\demo\\classroom.mp4',
    });
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.error.code, 'SESSION_NOT_STARTED');
    assert.match(body.error.message, /has not started yet/);
    assert.equal(body.error.scheduled_start, repository.contextStart.toISOString());
    assert.equal(body.error.time_zone, 'Asia/Kolkata');
    assert.equal(called, false, 'no inference may be attempted before the class starts');
    assert.equal(body.session.status, 'pending');
    assert.equal(repository.sessions.get(session.id)?.status, 'open');
  });

  it('processes a class that is currently running', async () => {
    await stopBackend();
    repository = new MockAttendanceRepository();
    repository.contextStart = new Date(Date.now() - 30 * 60 * 1000);
    repository.contextEnd = new Date(Date.now() + 30 * 60 * 1000);
    const session = await repository.createAttendanceSession({
      id: 'active-session',
      classSessionId: 'class-1',
    });
    await startBackend(async () => inferenceResponse);

    const response = await postJson(`/api/attendance-sessions/${session.id}/process`, {
      video_path: 'C:\\demo\\classroom.mp4',
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.session.status, 'completed');
  });

  it('reports a missing scheduled window without attempting inference', async () => {
    await stopBackend();
    repository = new MockAttendanceRepository();
    repository.contextMissing = true;
    const session = await repository.createAttendanceSession({
      id: 'no-context-session',
      classSessionId: 'class-1',
    });
    let called = false;
    await startBackend(async () => {
      called = true;
      return inferenceResponse;
    });

    const response = await postJson(`/api/attendance-sessions/${session.id}/process`, {
      video_path: 'C:\\demo\\classroom.mp4',
    });
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.error.code, 'ATTENDANCE_CONTEXT_MISSING');
    assert.equal(called, false);
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
