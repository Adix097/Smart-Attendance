import { useEffect, useState } from 'react';

import AttendanceTable from '../components/attendance/AttendanceTable';
import ClassSelector from '../components/attendance/ClassSelector';
import EvidenceSummary from '../components/attendance/EvidenceSummary';
import ReviewActions from '../components/attendance/ReviewActions';
import SessionHeader from '../components/attendance/SessionHeader';
import SessionStatus from '../components/attendance/SessionStatus';
import ClassroomSelector from '../components/timetable/ClassroomSelector';
import { getClassrooms } from '../api/timetable';
import type { Classroom } from '../api/types';
import useAttendance from '../hooks/useAttendance';
import useClassSessions from '../hooks/useClassSessions';

export default function AttendancePage() {
  const [classrooms, setClassrooms] = useState<Classroom[]>([]);
  const [classroomId, setClassroomId] = useState('');
  const [classroomError, setClassroomError] = useState('');

  const classSessions = useClassSessions(classroomId || undefined);
  const attendance = useAttendance(classSessions.selectedClassId);
  const students = classSessions.selectedClass?.students ?? [];

  useEffect(() => {
    getClassrooms()
      .then(({ classrooms: rooms }) => setClassrooms(rooms))
      .catch((cause) =>
        setClassroomError(
          cause instanceof Error ? cause.message : 'Unable to load classrooms',
        ),
      );
  }, []);

  const selectClass = (id: string) => {
    classSessions.setSelectedClassId(id);
    attendance.resetEvidence();
  };

  const selectClassroom = (id: string) => {
    setClassroomId(id);
    attendance.resetEvidence();
  };

  return (
    <main className="mx-auto max-w-5xl px-5 py-8 text-slate-900 sm:py-10">
      <SessionHeader
        selectedClass={classSessions.selectedClass}
        session={attendance.session}
        busy={attendance.busy}
        onCreate={attendance.createSession}
      />
      <section className="my-4 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <ClassroomSelector
          classrooms={classrooms}
          selectedClassroomId={classroomId}
          onSelect={selectClassroom}
        />
        <a className="text-sm font-semibold text-blue-700 hover:underline" href="/timetable">
          View room timetable
        </a>
      </section>
      <ClassSelector
        classes={classSessions.classes}
        selectedClassId={classSessions.selectedClassId}
        selectedClass={classSessions.selectedClass}
        busy={attendance.busy}
        onSelect={selectClass}
      />
      <SessionStatus
        error={classroomError || classSessions.error || attendance.error}
        session={attendance.session}
      />
      <ReviewActions
        session={attendance.session}
        selectedClass={classSessions.selectedClass}
        source={attendance.source}
        busy={attendance.busy}
        onSourceChange={attendance.setSource}
        onProcess={attendance.processVideo}
      />

      {attendance.session?.status === 'completed' && (
        <>
          <EvidenceSummary
            observations={attendance.observations}
            students={students}
          />
          <AttendanceTable
            records={attendance.records}
            students={students}
            busy={attendance.busy}
            reviewStatus={attendance.reviewStatus}
            onStatusChange={(id, status) =>
              attendance.setReviewStatus((current) => ({ ...current, [id]: status }))
            }
            onFinalize={attendance.finalize}
          />
        </>
      )}
    </main>
  );
}
