import type { ObservationStatus } from '../../api/types';

export function VerificationBadge({ status }: { status: ObservationStatus }) {
  return <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold uppercase">{status}</span>;
}
