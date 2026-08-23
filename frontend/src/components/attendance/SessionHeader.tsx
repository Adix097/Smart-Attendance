import type { AttendanceSession, ClassSessionOption } from '../../api/types';

export function SessionHeader({ selectedClass, session, busy, onCreate }: {
  selectedClass: ClassSessionOption | null;
  session: AttendanceSession | null;
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-blue-700">Faculty attendance</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Smart Automation Foundations</h1>
      </div>
      <div className="grid justify-items-start gap-2 sm:justify-items-end">
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${session?.status === 'failed' ? 'bg-red-100 text-red-800' : session?.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : session?.status === 'processing' ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'}`}>
          {session ? ({ pending: 'Pending', processing: 'Processing', completed: 'Completed - review required', failed: 'Failed' }[session.status]) : 'No session created'}
        </span>
        <button className="rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50" onClick={onCreate} disabled={busy || !selectedClass}>
          {session ? 'Use attendance session' : 'Create attendance session'}
        </button>
        {session && <small className="text-xs text-slate-500">{session.id}</small>}
      </div>
    </header>
  );
}
