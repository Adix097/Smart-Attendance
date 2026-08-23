import { useEffect, useMemo, useState } from 'react';

import {
  createAttendanceSession,
  finalizeAttendance,
  getAttendanceObservations,
  getAttendanceRecords,
  getAttendanceSessionStatus,
  processAttendanceSession,
  type AttendanceObservation,
  type AttendanceRecord,
  type AttendanceSession,
  type RecordStatus,
  type SessionStatus,
} from './api/attendance';

const CLASS_SESSION_ID = '00000000-0000-0000-0000-000000000005';
// Deterministic local demo mapping; production identity management is out of scope.
const DEMO_IDENTITY_STUDENT_IDS = {
  adi: '00000000-0000-0000-0000-000000000012',
};
const students: Record<string, string> = {
  '00000000-0000-0000-0000-000000000012': 'Student A',
  '00000000-0000-0000-0000-000000000014': 'Student B',
  '00000000-0000-0000-0000-000000000016': 'Student C',
};

const statusLabels: Record<SessionStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Completed - review required',
  failed: 'Failed',
};

function studentName(id: string | null): string {
  return id ? students[id] ?? id : 'Unknown face';
}

function similarity(value: number | null): string {
  return value === null ? '—' : value.toFixed(3);
}

function ObservationCard({ observation }: { observation: AttendanceObservation }) {
  const evidenceTone = {
    confirmed: 'border-emerald-500 bg-emerald-50',
    uncertain: 'border-amber-500 bg-amber-50',
    unknown: 'border-slate-400 bg-slate-50',
  }[observation.status];

  return (
    <article className={`my-2 rounded-lg border-l-4 p-4 ${evidenceTone}`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <strong>{studentName(observation.studentId)}</strong>
        <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold uppercase">
          {observation.status}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
        <span>Similarity: {similarity(observation.similarity)}</span>
        <span>Observations: {observation.observationCount}</span>
        <span>Margin: {similarity(observation.identityMargin)}</span>
        <span>Camera/track: Not provided</span>
        <span>Model: {observation.modelName} {observation.modelVersion ?? ''}</span>
      </div>
    </article>
  );
}

function App() {
  return window.location.pathname === '/attendance' ? (
    <AttendancePage />
  ) : (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:py-28">
      <section className="max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-blue-700">
          USAR faculty workspace
        </p>
        <h1 className="my-2 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Smart Classroom Attendance
        </h1>
        <p className="mb-8 text-lg text-slate-600">
          Review provisional AI recognition evidence before finalizing attendance.
        </p>
        <a
          className="inline-block rounded-lg bg-blue-700 px-4 py-3 font-medium text-white hover:bg-blue-800"
          href="/attendance"
        >
          Open attendance workflow
        </a>
      </section>
    </main>
  );
}

function AttendancePage() {
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [observations, setObservations] = useState<AttendanceObservation[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [videoPath, setVideoPath] = useState('C:\\demo\\classroom.mp4');
  const [enrollmentDir, setEnrollmentDir] = useState('C:\\demo\\enrollment');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewStatus, setReviewStatus] = useState<Record<string, RecordStatus>>({});

  const grouped = useMemo(
    () => ({
      confirmed: observations.filter((item) => item.status === 'confirmed'),
      uncertain: observations.filter((item) => item.status === 'uncertain'),
      unknown: observations.filter((item) => item.status === 'unknown'),
    }),
    [observations],
  );

  const loadEvidence = async (id: string) => {
    const [observationResponse, recordResponse] = await Promise.all([
      getAttendanceObservations(id),
      getAttendanceRecords(id),
    ]);
    setObservations(observationResponse.observations);
    setRecords(recordResponse.records);
  };

  useEffect(() => {
    if (!session || session.status !== 'processing') return;
    const timer = window.setInterval(async () => {
      try {
        const current = await getAttendanceSessionStatus(session.id);
        setSession(current);
        if (current.status === 'completed') {
          await loadEvidence(current.id);
          window.clearInterval(timer);
        }
        if (current.status === 'failed') window.clearInterval(timer);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to read processing status');
        window.clearInterval(timer);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [session]);

  const createSession = async () => {
    setBusy(true);
    setError('');
    try {
      setSession(await createAttendanceSession(CLASS_SESSION_ID));
      setObservations([]);
      setRecords([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create session');
    } finally {
      setBusy(false);
    }
  };

  const processVideo = async () => {
    if (!session) return;
    setBusy(true);
    setError('');
    setSession({ ...session, status: 'processing', error: null });
    try {
      const result = await processAttendanceSession(
        session.id,
        videoPath,
        enrollmentDir,
        DEMO_IDENTITY_STUDENT_IDS,
      );
      setSession(result.session);
      await loadEvidence(session.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'AI processing failed');
      try {
        setSession(await getAttendanceSessionStatus(session.id));
      } catch {
        // Keep the original processing error visible.
      }
    } finally {
      setBusy(false);
    }
  };

  const finalize = async (record: AttendanceRecord) => {
    if (!session) return;
    setBusy(true);
    setError('');
    try {
      const status = reviewStatus[record.id] ?? record.status;
      const result = await finalizeAttendance(session.id, record.id, status);
      setRecords((current) =>
        current.map((item) => (item.id === result.record.id ? result.record : item)),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Finalization failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-5xl px-5 py-8 text-slate-900 sm:py-10">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-blue-700">
            Faculty attendance
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Smart Automation Foundations</h1>
        </div>
        <a className="text-blue-700 hover:underline" href="/">Home</a>
      </header>

      <section className="my-4 flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="mb-2 text-lg font-semibold">Current class</h2>
          <p><strong>Course:</strong> SAR-DEMO-101 · Smart Automation Foundations</p>
          <p><strong>Classroom:</strong> USAR Demo Classroom</p>
          <p><strong>Scheduled:</strong> 24 Aug 2026, 09:00–10:00 UTC</p>
        </div>
        <div className="grid justify-items-start gap-2 sm:justify-items-end">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${
            session?.status === 'failed'
              ? 'bg-red-100 text-red-800'
              : session?.status === 'completed'
                ? 'bg-emerald-100 text-emerald-800'
                : session?.status === 'processing'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-amber-100 text-amber-800'
          }`}>
            {session ? statusLabels[session.status] : 'No session created'}
          </span>
          <button
            className="rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={createSession}
            disabled={busy}
          >
            {session ? 'Use attendance session' : 'Create attendance session'}
          </button>
          {session && <small className="text-xs text-slate-500">{session.id}</small>}
        </div>
      </section>

      {error && <div className="my-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</div>}
      {session?.error && (
        <div className="my-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
          Processing failed: {session.error}
        </div>
      )}

      <section className="my-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Process classroom video</h2>
            <p className="text-slate-600">Local paths are used for this MVP; no browser upload is performed.</p>
          </div>
          <span className="text-sm text-slate-500">CPU InsightFace · provisional evidence</span>
        </div>
        <label className="mb-3 grid gap-1 text-sm font-semibold">
          Video path
          <input className="rounded-lg border border-slate-300 px-3 py-2 font-normal focus:border-blue-600 focus:outline-none" value={videoPath} onChange={(event) => setVideoPath(event.target.value)} />
        </label>
        <label className="mb-4 grid gap-1 text-sm font-semibold">
          Enrollment directory
          <input className="rounded-lg border border-slate-300 px-3 py-2 font-normal focus:border-blue-600 focus:outline-none" value={enrollmentDir} onChange={(event) => setEnrollmentDir(event.target.value)} />
        </label>
        <button
          className="rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={processVideo}
          disabled={!session || busy || session.status === 'processing'}
        >
          {session?.status === 'processing' || busy ? 'Processing…' : 'Run AI recognition'}
        </button>
      </section>

      {session?.status === 'completed' && (
        <>
          <section className="my-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Recognition evidence</h2>
              <p className="text-slate-600">Similarity is not a probability or confidence percentage.</p>
            </div>
            {(['confirmed', 'uncertain', 'unknown'] as const).map((status) => (
              <div key={status}>
                <h3 className="mb-2 mt-5 font-semibold">
                  {status[0].toUpperCase() + status.slice(1)} ({grouped[status].length})
                </h3>
                {grouped[status].length === 0 ? (
                  <p className="italic text-slate-500">No observations in this category.</p>
                ) : (
                  grouped[status].map((observation) => (
                    <ObservationCard key={observation.id} observation={observation} />
                  ))
                )}
              </div>
            ))}
          </section>

          <section className="my-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Provisional attendance</h2>
              <p className="text-slate-600">Nothing is final until faculty reviews and submits each record.</p>
            </div>
            {records.length === 0 ? (
              <p className="italic text-slate-500">No enrolled student records were produced.</p>
            ) : (
              records.map((record) => (
                <div className="flex flex-col gap-3 border-t border-slate-200 py-3 sm:flex-row sm:items-center" key={record.id}>
                  <div className="flex-1">
                    <strong>{studentName(record.studentId)}</strong>
                    <span className="ml-2 text-sm text-slate-500">
                      {record.finalizedAt ? 'Finalized' : 'Provisional'} · AI evidence
                    </span>
                  </div>
                  <select
                    className="rounded-lg border border-slate-300 px-3 py-2"
                    value={reviewStatus[record.id] ?? record.status}
                    onChange={(event) =>
                      setReviewStatus((current) => ({
                        ...current,
                        [record.id]: event.target.value as RecordStatus,
                      }))
                    }
                    disabled={Boolean(record.finalizedAt)}
                  >
                    <option value="present">Present</option>
                    <option value="absent">Absent</option>
                    <option value="uncertain">Uncertain - review</option>
                  </select>
                  <button
                    className="rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => finalize(record)}
                    disabled={busy || Boolean(record.finalizedAt)}
                  >
                    {record.finalizedAt ? 'Finalized' : 'Finalize review'}
                  </button>
                </div>
              ))
            )}
          </section>
        </>
      )}
    </main>
  );
}

export default App;
