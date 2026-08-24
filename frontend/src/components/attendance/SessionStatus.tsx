import type { AttendanceSession } from '../../api/types';

export default function SessionStatus({
  error,
  session,
}: {
  error: string;
  session: AttendanceSession | null;
}) {
  const messages = [error, session?.error && `Processing failed: ${session.error}`];

  return (
    <>
      {messages.filter(Boolean).map((message) => (
        <div
          key={message}
          className="my-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800"
        >
          {message}
        </div>
      ))}
    </>
  );
}
