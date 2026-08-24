import { Link } from 'react-router-dom';

import BackLink from '../components/BackLink';
import ClassroomSelector from '../components/timetable/ClassroomSelector';
import CurrentClassCard from '../components/timetable/CurrentClassCard';
import LiveClock from '../components/timetable/LiveClock';
import TimetableView from '../components/timetable/TimetableView';
import useClassroomTimetable from '../hooks/useClassroomTimetable';

export default function ClassroomTimetablePage() {
  const {
    classrooms,
    selectedClassroomId,
    setSelectedClassroomId,
    selectedClassroom,
    timetable,
    loading,
    error,
  } = useClassroomTimetable();

  const entries = timetable?.timetable ?? [];
  const occurrence = timetable?.occurrence ?? null;
  const currentEntry = entries.find((entry) => entry.id === occurrence?.entryId) ?? null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <BackLink to="/" label="Back to home" />
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">Classroom timetable</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
            {selectedClassroom?.name ?? 'Select a classroom'}
          </h1>
          <div className="mt-2">
            <LiveClock />
          </div>
        </div>
        <div className="flex items-end gap-3">
          <ClassroomSelector
            classrooms={classrooms}
            selectedClassroomId={selectedClassroomId}
            onSelect={setSelectedClassroomId}
          />
          <Link
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            to="/attendance"
          >
            Take attendance
          </Link>
        </div>
      </header>

      {error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading && !error ? (
        <p className="text-sm text-slate-600">Loading timetable…</p>
      ) : (
        <div className="grid gap-5">
          <CurrentClassCard
            occurrence={occurrence}
            entry={currentEntry}
            roomName={selectedClassroom?.name ?? ''}
          />
          <TimetableView entries={entries} occurrence={occurrence} />
        </div>
      )}
    </main>
  );
}
