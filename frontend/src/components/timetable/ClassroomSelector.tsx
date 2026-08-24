import type { Classroom } from '../../api/types';

export default function ClassroomSelector({
  classrooms,
  selectedClassroomId,
  onSelect,
}: {
  classrooms: Classroom[];
  selectedClassroomId: string;
  onSelect: (classroomId: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
      Classroom
      <select
        className="min-w-40 rounded-md border border-slate-300 bg-white px-3 py-2 text-base font-semibold text-slate-900 disabled:bg-slate-100"
        value={selectedClassroomId}
        disabled={classrooms.length === 0}
        onChange={(event) => onSelect(event.target.value)}
      >
        {classrooms.length === 0 ? (
          <option value="">No classrooms available</option>
        ) : (
          classrooms.map((classroom) => (
            <option key={classroom.id} value={classroom.id}>
              {classroom.name}
            </option>
          ))
        )}
      </select>
    </label>
  );
}
