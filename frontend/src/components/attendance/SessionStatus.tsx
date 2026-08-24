import type { AttendanceSession } from '../../api/types';

function isSessionNotStarted(message: string): boolean {
  return /has not started yet/i.test(message);
}

export default function SessionStatus({
  error,
  session,
}: {
  error: string;
  session: AttendanceSession | null;
}) {
  const items: Array<{ text: string; warning: boolean }> = [];
  if (error) {
    items.push({ text: error, warning: isSessionNotStarted(error) });
  }
  if (session?.error && session.error !== error) {
    items.push({
      text: `Processing failed: ${session.error}`,
      warning: isSessionNotStarted(session.error),
    });
  }

  return (
    <>
      {items.map((item) => (
        <div
          key={item.text}
          className={
            item.warning
              ? 'my-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900'
              : 'my-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800'
          }
        >
          {item.text}
        </div>
      ))}
    </>
  );
}
