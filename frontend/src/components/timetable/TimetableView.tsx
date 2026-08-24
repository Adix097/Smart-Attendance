import type { ClassroomOccurrence, TimetableEntry } from '../../api/types';

const weekdayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export default function TimetableView({
  entries,
  occurrence,
}: {
  entries: TimetableEntry[];
  occurrence: ClassroomOccurrence | null;
}) {
  if (entries.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Weekly Timetable
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          This room has no timetable entries.
        </p>
      </section>
    );
  }

  const days = weekdayOrder.filter((day) =>
    entries.some((entry) => entry.weekday === day),
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white">
      <h2 className="border-b border-slate-200 px-5 py-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Weekly Timetable
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-4 py-2 font-medium">Course</th>
              <th className="px-4 py-2 font-medium">Faculty</th>
              <th className="px-4 py-2 font-medium">Class</th>
              <th className="px-4 py-2 font-medium">Batch</th>
              <th className="px-4 py-2 font-medium">Room</th>
            </tr>
          </thead>
          {days.map((day) => (
            <tbody key={day} className="border-t border-slate-200">
              <tr className="bg-slate-100/70">
                <th
                  colSpan={6}
                  className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600"
                >
                  {day}
                </th>
              </tr>
              {entries
                .filter((entry) => entry.weekday === day)
                .map((entry) => {
                  const highlighted = entry.id === occurrence?.entryId;
                  return (
                    <tr
                      key={entry.id}
                      className={
                        highlighted ? 'bg-emerald-50 font-semibold' : 'odd:bg-white'
                      }
                    >
                      <td className="whitespace-nowrap px-4 py-2 font-mono text-slate-700">
                        {entry.startTime} - {entry.endTime}
                        {highlighted && (
                          <span className="ml-2 rounded bg-emerald-200 px-1.5 py-0.5 text-[10px] uppercase text-emerald-900">
                            {occurrence?.status === 'active' ? 'Now' : 'Next'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-900">
                        {entry.courseName}
                        {entry.courseName !== entry.courseCode && (
                          <span className="ml-1 font-mono text-xs text-slate-500">
                            {entry.courseCode}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-700">{entry.facultyName}</td>
                      <td className="px-4 py-2 text-slate-700">{entry.className ?? '—'}</td>
                      <td className="px-4 py-2 text-slate-700">{entry.batch}</td>
                      <td className="px-4 py-2 font-mono text-slate-600">{entry.room}</td>
                    </tr>
                  );
                })}
            </tbody>
          ))}
        </table>
      </div>
    </section>
  );
}
