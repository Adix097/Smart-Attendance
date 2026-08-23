import { AttendanceTable } from '../components/attendance/AttendanceTable';
import { ClassSelector } from '../components/attendance/ClassSelector';
import { EvidenceSummary } from '../components/attendance/EvidenceSummary';
import { ReviewActions } from '../components/attendance/ReviewActions';
import { SessionHeader } from '../components/attendance/SessionHeader';
import { SessionStatus } from '../components/attendance/SessionStatus';
import { useAttendance } from '../hooks/useAttendance';
import { useClassSessions } from '../hooks/useClassSessions';

export function AttendancePage() {
  const classSessions = useClassSessions();
  const attendance = useAttendance(classSessions.selectedClassId);
  const selectClass = (id: string) => {
    classSessions.setSelectedClassId(id);
    attendance.resetEvidence();
  };

  return (
    <main className="mx-auto max-w-5xl px-5 py-8 text-slate-900 sm:py-10">
      <SessionHeader selectedClass={classSessions.selectedClass} session={attendance.session} busy={attendance.busy} onCreate={attendance.createSession} />
      <ClassSelector classes={classSessions.classes} selectedClassId={classSessions.selectedClassId} selectedClass={classSessions.selectedClass} busy={attendance.busy} onSelect={selectClass} />
      <SessionStatus error={classSessions.error || attendance.error} session={attendance.session} />
      <ReviewActions session={attendance.session} source={attendance.source} busy={attendance.busy} onSourceChange={attendance.setSource} onProcess={attendance.processVideo} />
      {attendance.session?.status === 'completed' && (
        <>
          <EvidenceSummary observations={attendance.observations} students={classSessions.selectedClass?.students ?? []} />
          <AttendanceTable
            records={attendance.records}
            students={classSessions.selectedClass?.students ?? []}
            busy={attendance.busy}
            reviewStatus={attendance.reviewStatus}
            onStatusChange={(id, status) => attendance.setReviewStatus((current) => ({ ...current, [id]: status }))}
            onFinalize={attendance.finalize}
          />
        </>
      )}
    </main>
  );
}
