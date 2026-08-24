import type { AttendanceSession, ClassSessionOption } from '../../api/types';
import type { AttendanceInputSource } from '../../types/attendance';
import { displayTimeZone, formatTime, formatWeekday } from '../../timezone';
import AttendanceInput from './AttendanceInput';

export default function ReviewActions({
  session,
  selectedClass,
  source,
  busy,
  onSourceChange,
  onProcess,
}: {
  session: AttendanceSession | null;
  selectedClass: ClassSessionOption | null;
  source: AttendanceInputSource | null;
  busy: boolean;
  onSourceChange: (source: AttendanceInputSource | null) => void;
  onProcess: () => void;
}) {
  const processing = session?.status === 'processing';
  // Recognition needs footage of the class, so it stays closed until it starts.
  const notStarted = selectedClass?.status === 'upcoming';

  return (
    <section className="my-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="text-lg font-semibold">Process classroom video</h2>
      </div>

      {notStarted && selectedClass && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
          This class has not started yet. Processing opens at{' '}
          <strong>
            {formatWeekday(selectedClass.scheduledStart)}{' '}
            {formatTime(selectedClass.scheduledStart)}
          </strong>{' '}
          ({displayTimeZone}).
        </p>
      )}

      <AttendanceInput
        source={source}
        disabled={busy || processing || notStarted}
        onChange={onSourceChange}
      />
      <button
        className="rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={onProcess}
        disabled={!session || !source || busy || processing || notStarted}
      >
        {processing || busy
          ? 'Processing…'
          : notStarted
            ? 'Class has not started'
            : 'Run AI recognition'}
      </button>
    </section>
  );
}
