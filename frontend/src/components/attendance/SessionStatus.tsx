import type { AttendanceSession } from '../../api/types';

export function SessionStatus({ error, session }: { error: string; session: AttendanceSession | null }) {
  return (
    <>
      {error && <div className="my-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{error}</div>}
      {session?.error && <div className="my-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">Processing failed: {session.error}</div>}
    </>
  );
}
