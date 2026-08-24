import type { ClassSessionOption } from '../../api/types';
import { formatTime, formatWeekday } from '../../timezone';

export default function ClassSelector({
  classes,
  selectedClassId,
  selectedClass,
  busy,
  onSelect,
}: {
  classes: ClassSessionOption[];
  selectedClassId: string;
  selectedClass: ClassSessionOption | null;
  busy: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="my-4 flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">
            {selectedClass?.status === 'active'
              ? 'Current Class'
              : selectedClass?.status === 'ended'
                ? 'Ended Class'
                : 'Next Class'}
          </h2>
          {selectedClass?.status && (
            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold uppercase text-blue-800">
              {selectedClass.status}
            </span>
          )}
        </div>

        {classes.length === 0 ? (
          <p className="text-slate-600">No scheduled class sessions are available.</p>
        ) : (
          <select
            className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2"
            value={selectedClassId}
            onChange={(event) => onSelect(event.target.value)}
            disabled={busy}
          >
            {classes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.courseCode} — {item.courseTitle} · {formatWeekday(item.scheduledStart)}{' '}
                {formatTime(item.scheduledStart)}
              </option>
            ))}
          </select>
        )}

        {selectedClass && (
          <>
            <p>
              <strong>Course:</strong> {selectedClass.courseCode} ·{' '}
              {selectedClass.courseTitle}
            </p>
            <p>
              <strong>Faculty:</strong> {selectedClass.facultyName}
            </p>
            <p>
              <strong>Classroom:</strong> {selectedClass.classroomName}
            </p>
            {selectedClass.className && (
              <p>
                <strong>Class:</strong> {selectedClass.className}
              </p>
            )}
            {selectedClass.batch && (
              <p>
                <strong>Batch:</strong> {selectedClass.batch}
              </p>
            )}
            <p>
              <strong>Scheduled:</strong> {formatWeekday(selectedClass.scheduledStart)}{' '}
              {formatTime(selectedClass.scheduledStart)}–
              {formatTime(selectedClass.scheduledEnd)}
            </p>
            <p>
              <strong>Enrolled students:</strong> {selectedClass.students.length}
            </p>
          </>
        )}
      </div>
    </section>
  );
}
