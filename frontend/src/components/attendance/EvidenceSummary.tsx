import type { AttendanceObservation, EnrolledStudent } from '../../api/types';
import { VerificationBadge } from './VerificationBadge';

function similarity(value: number | null) { return value === null ? '—' : value.toFixed(3); }
function evidenceValue(observation: AttendanceObservation, key: string): string | null {
  const value = observation.evidence[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function studentName(observation: AttendanceObservation, students: EnrolledStudent[]) {
  if (observation.studentId) {
    return students.find((student) => student.id === observation.studentId)?.name
      ?? evidenceValue(observation, 'global_student_name')
      ?? 'Unknown Person';
  }
  return evidenceValue(observation, 'global_student_name') ?? 'Unknown Person';
}

export function EvidenceSummary({ observations, students }: { observations: AttendanceObservation[]; students: EnrolledStudent[] }) {
  return (
    <section className="my-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4"><h2 className="text-lg font-semibold">Recognition evidence</h2><p className="text-slate-600">Similarity is not a probability or confidence percentage.</p></div>
      {(['confirmed', 'uncertain', 'unknown'] as const).map((status) => {
        const items = observations.filter((item) => item.status === status);
        return <div key={status}><h3 className="mb-2 mt-5 font-semibold">{status[0].toUpperCase() + status.slice(1)} ({items.length})</h3>
          {items.length === 0 ? <p className="italic text-slate-500">No observations in this category.</p> : items.map((observation) => (
            <article key={observation.id} className={`my-2 rounded-lg border-l-4 p-4 ${status === 'confirmed' ? 'border-emerald-500 bg-emerald-50' : status === 'uncertain' ? 'border-amber-500 bg-amber-50' : 'border-slate-400 bg-slate-50'}`}>
              <div className="flex flex-wrap items-center justify-between gap-4"><strong>{studentName(observation, students)}</strong><VerificationBadge status={observation.status} /></div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                <span>Verification: {typeof observation.evidence.verification_result === 'string' ? observation.evidence.verification_result : 'FACULTY_REVIEW_REQUIRED'}</span>
                {evidenceValue(observation, 'global_student_number') && <span>Student ID: {evidenceValue(observation, 'global_student_number')}</span>}
                {observation.evidence.verification_result === 'UNEXPECTED_STUDENT' && <span className="font-bold text-red-700">NOT IN THIS CLASS</span>}
                {observation.evidence.verification_result === 'UNKNOWN' && <span className="font-bold text-slate-700">NOT FOUND IN CAMPUS DATABASE</span>}
                <span>Similarity: {similarity(observation.similarity)}</span><span>Observations: {observation.observationCount}</span><span>Margin: {similarity(observation.identityMargin)}</span><span>Camera/track: Not provided</span><span>Model: {observation.modelName} {observation.modelVersion ?? ''}</span>
              </div>
            </article>
          ))}
        </div>;
      })}
    </section>
  );
}
