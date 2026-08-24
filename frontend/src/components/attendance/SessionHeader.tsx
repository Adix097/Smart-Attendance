import type { AttendanceSession, ClassSessionOption } from '../../api/types';
import LiveClock from '../timetable/LiveClock';

const statusLabels = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Completed - review required',
  failed: 'Failed',
};

const statusStyles = {
  pending: 'bg-amber-100 text-amber-800',
  processing: 'bg-blue-100 text-blue-800',
  completed: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
};

export default function SessionHeader({
  selectedClass,
  session,
  busy,
  onCreate,
}: {
  selectedClass: ClassSessionOption | null;
  session: AttendanceSession | null;
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          {selectedClass?.courseTitle ?? 'Smart Classroom Attendance'}
        </h1>
        <div className="mt-2">
          <LiveClock />
        </div>
      </div>

      <div className="grid justify-items-start gap-2 sm:justify-items-end">
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${session ? statusStyles[session.status] : 'bg-amber-100 text-amber-800'
            }`}
        >
          {session ? statusLabels[session.status] : 'No session created'}
        </span>
        <button
          className="rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onCreate}
          disabled={busy || !selectedClass}
        >
          {session ? 'Use attendance session' : 'Create attendance session'}
        </button>
        {session && <small className="text-xs text-slate-500">{session.id}</small>}
      </div>
    </header>
  );
}
