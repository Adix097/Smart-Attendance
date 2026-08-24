import type { AttendanceSession } from '../../api/types';
import type { AttendanceInputSource } from '../../types/attendance';
import AttendanceInput from './AttendanceInput';

export default function ReviewActions({
  session,
  source,
  busy,
  onSourceChange,
  onProcess,
}: {
  session: AttendanceSession | null;
  source: AttendanceInputSource | null;
  busy: boolean;
  onSourceChange: (source: AttendanceInputSource | null) => void;
  onProcess: () => void;
}) {
  const processing = session?.status === 'processing';

  return (
    <section className="my-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Process classroom video</h2>
          <p className="text-slate-600">
            Video is processed by the backend; audio is not captured.
          </p>
        </div>
        <span className="text-sm text-slate-500">
          CPU InsightFace · provisional evidence
        </span>
      </div>

      <AttendanceInput
        source={source}
        disabled={busy || processing}
        onChange={onSourceChange}
      />

      <p className="mb-4 text-sm text-slate-600">
        Enrollment images are resolved by the backend from the imported student
        directories.
      </p>

      <button
        className="rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={onProcess}
        disabled={!session || !source || busy || processing}
      >
        {processing || busy ? 'Processing…' : 'Run AI recognition'}
      </button>
    </section>
  );
}
