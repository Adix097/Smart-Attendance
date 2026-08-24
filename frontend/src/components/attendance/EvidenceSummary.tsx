import type { AttendanceObservation, EnrolledStudent } from '../../api/types';

const observationStatuses = ['confirmed', 'uncertain', 'unknown'] as const;

const statusStyles: Record<(typeof observationStatuses)[number], string> = {
  confirmed: 'border-emerald-500 bg-emerald-50',
  uncertain: 'border-amber-500 bg-amber-50',
  unknown: 'border-slate-400 bg-slate-50',
};

function formatSimilarity(value: number | null) {
  return value === null ? '—' : value.toFixed(3);
}

function evidenceText(observation: AttendanceObservation, key: string): string | null {
  const value = observation.evidence[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function studentName(observation: AttendanceObservation, students: EnrolledStudent[]) {
  const enrolledName = observation.studentId
    ? students.find((student) => student.id === observation.studentId)?.name
    : undefined;
  return (
    enrolledName ?? evidenceText(observation, 'global_student_name') ?? 'Unknown Person'
  );
}

export default function EvidenceSummary({
  observations,
  students,
}: {
  observations: AttendanceObservation[];
  students: EnrolledStudent[];
}) {
  return (
    <section className="my-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Recognition evidence</h2>
      </div>

      {observationStatuses.map((status) => {
        const items = observations.filter((item) => item.status === status);
        return (
          <div key={status}>
            <h3 className="mb-2 mt-5 font-semibold">
              {status[0].toUpperCase() + status.slice(1)} ({items.length})
            </h3>
            {items.length === 0 ? (<p className="italic text-slate-500">No observations in this category.</p>) : (
              items.map((observation) => {
                const verification = evidenceText(observation, 'verification_result');
                const studentNumber = evidenceText(
                  observation,
                  'global_student_number',
                );
                return (
                  <article
                    key={observation.id}
                    className={`my-2 rounded-lg border-l-4 p-4 ${statusStyles[status]}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <strong>{studentName(observation, students)}</strong>
                      <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold uppercase">
                        {observation.status}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                      <span>
                        Verification: {verification ?? 'FACULTY_REVIEW_REQUIRED'}
                      </span>
                      {studentNumber && <span>Student ID: {studentNumber}</span>}
                      {verification === 'UNEXPECTED_STUDENT' && (
                        <span className="font-bold text-red-700">NOT IN THIS CLASS</span>
                      )}
                      {verification === 'UNKNOWN' && (
                        <span className="font-bold text-slate-700">
                          NOT FOUND IN CAMPUS DATABASE
                        </span>
                      )}
                      <span>Similarity: {formatSimilarity(observation.similarity)}</span>
                      <span>Observations: {observation.observationCount}</span>
                      <span>Margin: {formatSimilarity(observation.identityMargin)}</span>
                      <span>
                        Model: {observation.modelName} {observation.modelVersion ?? ''}
                      </span>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        );
      })}
    </section>
  );
}
