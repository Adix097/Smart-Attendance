import type { ClassroomOccurrence, TimetableEntry } from '../../api/types';
import { displayTimeZone, formatTime, formatWeekday } from '../../timezone';

function isSameDay(isoTimestamp: string, reference: Date): boolean {
  const asDay = new Intl.DateTimeFormat('en-CA', { timeZone: displayTimeZone });
  return asDay.format(new Date(isoTimestamp)) === asDay.format(reference);
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

export default function CurrentClassCard({
  occurrence,
  entry,
  roomName,
}: {
  occurrence: ClassroomOccurrence | null;
  entry: TimetableEntry | null;
  roomName: string;
}) {
  if (!occurrence || !entry) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Current Class
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {roomName
            ? `No classes are scheduled for ${roomName}.`
            : 'Select a classroom to see its current class.'}
        </p>
      </section>
    );
  }

  const active = occurrence.status === 'active';
  const today = isSameDay(occurrence.scheduledStart, new Date());

  return (
    <section
      className={`rounded-lg border bg-white p-5 ${
        active ? 'border-emerald-300 ring-1 ring-emerald-200' : 'border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {active ? 'Current Class' : 'Upcoming Class'}
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            active ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {active ? 'In progress' : 'Scheduled'}
        </span>
      </div>

      {!active && !today && (
        <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
          No more classes in this room today. The next one is on{' '}
          {formatWeekday(occurrence.scheduledStart)}.
        </p>
      )}

      <p className="mt-3 text-xl font-bold text-slate-900">{entry.courseName}</p>
      {entry.courseName !== entry.courseCode && (
        <p className="font-mono text-sm text-slate-500">{entry.courseCode}</p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Detail label="Faculty" value={entry.facultyName} />
        <Detail label="Class" value={entry.className ?? '—'} />
        <Detail label="Batch" value={entry.batch} />
        <Detail label="Room" value={entry.room} />
        <Detail label="Weekday" value={entry.weekday} />
        <Detail
          label="Time"
          value={`${formatTime(occurrence.scheduledStart)} - ${formatTime(occurrence.scheduledEnd)}`}
        />
      </dl>
    </section>
  );
}
