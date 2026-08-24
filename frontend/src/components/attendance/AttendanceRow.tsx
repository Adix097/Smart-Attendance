import type { AttendanceRecord, EnrolledStudent, RecordStatus } from '../../api/types';

function time(value: string | null) {
  return value ? new Date(value).toLocaleTimeString() : 'Not available';
}

export default function AttendanceRow({
  record,
  students,
  busy,
  selectedStatus,
  onStatusChange,
  onFinalize,
}: {
  record: AttendanceRecord;
  students: EnrolledStudent[];
  busy: boolean;
  selectedStatus: RecordStatus;
  onStatusChange: (status: RecordStatus) => void;
  onFinalize: () => void;
}) {
  const name =
    students.find((student) => student.id === record.studentId)?.name ?? record.studentId;
  const finalized = Boolean(record.finalizedAt);

  return (
    <div className="flex flex-col gap-3 border-t border-slate-200 py-3 sm:flex-row sm:items-center">
      <div className="flex-1">
        <strong>{name}</strong>
        <span className="ml-2 text-sm text-slate-500">
          {finalized ? 'Finalized' : 'Provisional'} · AI evidence
        </span>
        <div className="mt-1 text-sm text-slate-600">
          {record.verificationResult ?? 'FACULTY_REVIEW_REQUIRED'} · Sightings:{' '}
          {record.totalSightings}
          {record.lateEntry ? ' · Late entry' : ''}
        </div>
        <div className="text-xs text-slate-500">
          First seen: {time(record.firstSeen)} · Last seen: {time(record.lastSeen)}
        </div>
      </div>

      <select
        className="rounded-lg border border-slate-300 px-3 py-2"
        value={selectedStatus}
        onChange={(event) => onStatusChange(event.target.value as RecordStatus)}
        disabled={finalized}
      >
        <option value="present">Present</option>
        <option value="absent">Absent</option>
        <option value="uncertain">Uncertain - review</option>
      </select>

      <button
        className="rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={onFinalize}
        disabled={busy || finalized}
      >
        {finalized ? 'Finalized' : 'Finalize review'}
      </button>
    </div>
  );
}
