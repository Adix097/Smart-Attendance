import { useCallback, useEffect, useState } from 'react';
import {
  createAttendanceSession,
  finalizeAttendance,
  getAttendanceObservations,
  getAttendanceRecords,
  getAttendanceSessionStatus,
  processAttendanceSession,
} from '../api/attendance';
import type {
  AttendanceObservation,
  AttendanceRecord,
  AttendanceSession,
  RecordStatus,
} from '../api/types';

export function useAttendance(selectedClassId: string) {
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [observations, setObservations] = useState<AttendanceObservation[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [videoPath, setVideoPath] = useState('C:\\demo\\classroom.mp4');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewStatus, setReviewStatus] = useState<Record<string, RecordStatus>>({});

  const loadEvidence = useCallback(async (id: string) => {
    const [observationResponse, recordResponse] = await Promise.all([
      getAttendanceObservations(id),
      getAttendanceRecords(id),
    ]);
    setObservations(observationResponse.observations);
    setRecords(recordResponse.records);
  }, []);

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
  }, [loadEvidence, session]);

  const resetEvidence = () => {
    setSession(null);
    setObservations([]);
    setRecords([]);
    setReviewStatus({});
  };

  const createSession = async () => {
    setBusy(true);
    setError('');
    if (!selectedClassId) {
      setError('Select a scheduled class before creating an attendance session.');
      setBusy(false);
      return;
    }
    try {
      setSession(await createAttendanceSession(selectedClassId));
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
      const result = await processAttendanceSession(session.id, videoPath);
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

  return {
    session,
    observations,
    records,
    videoPath,
    setVideoPath,
    busy,
    error,
    setError,
    reviewStatus,
    setReviewStatus,
    createSession,
    processVideo,
    finalize,
    resetEvidence,
  };
}
