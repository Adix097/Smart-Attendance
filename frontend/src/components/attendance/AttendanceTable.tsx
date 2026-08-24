import type { AttendanceRecord, EnrolledStudent, RecordStatus } from '../../api/types';
import AttendanceRow from './AttendanceRow';

export default function AttendanceTable({
  records,
  students,
  busy,
  reviewStatus,
  onStatusChange,
  onFinalize,
}: {
  records: AttendanceRecord[];
  students: EnrolledStudent[];
  busy: boolean;
  reviewStatus: Record<string, RecordStatus>;
  onStatusChange: (id: string, status: RecordStatus) => void;
  onFinalize: (record: AttendanceRecord) => void;
}) {
  return (
    <section className="my-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Provisional attendance</h2>
        <p className="text-slate-600">
          Nothing is final until faculty reviews and submits each record.
        </p>
      </div>
      {records.length === 0 ? (
        <p className="italic text-slate-500">
          No enrolled student records were produced.
        </p>
      ) : (
        records.map((record) => (
          <AttendanceRow
            key={record.id}
            record={record}
            students={students}
            busy={busy}
            selectedStatus={reviewStatus[record.id] ?? record.status}
            onStatusChange={(status) => onStatusChange(record.id, status)}
            onFinalize={() => onFinalize(record)}
          />
        ))
      )}
    </section>
  );
}
