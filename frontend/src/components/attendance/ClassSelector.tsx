import type { ClassSessionOption } from '../../api/types';

interface Props {
  classes: ClassSessionOption[];
  selectedClassId: string;
  selectedClass: ClassSessionOption | null;
  busy: boolean;
  onSelect: (id: string) => void;
}

export function ClassSelector({ classes, selectedClassId, selectedClass, busy, onSelect }: Props) {
  return (
    <section className="my-4 flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="mb-2 text-lg font-semibold">Scheduled class</h2>
        {classes.length === 0 ? (
          <p className="text-slate-600">No concrete class sessions are available in PostgreSQL.</p>
        ) : (
          <select className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2" value={selectedClassId} onChange={(event) => onSelect(event.target.value)} disabled={busy}>
            {classes.map((item) => <option key={item.id} value={item.id}>{item.courseCode} — {item.courseTitle} · {new Date(item.scheduledStart).toLocaleString()}</option>)}
          </select>
        )}
        {selectedClass && (
          <>
            <p><strong>Course:</strong> {selectedClass.courseCode} · {selectedClass.courseTitle}</p>
            <p><strong>Faculty:</strong> {selectedClass.facultyName}</p>
            <p><strong>Classroom:</strong> {selectedClass.classroomName}</p>
            <p><strong>Scheduled:</strong> {new Date(selectedClass.scheduledStart).toLocaleString()}–{new Date(selectedClass.scheduledEnd).toLocaleTimeString()}</p>
            <p><strong>Enrolled students:</strong> {selectedClass.students.length}</p>
          </>
        )}
      </div>
    </section>
  );
}
