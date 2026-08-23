import type { AttendanceSession } from '../../api/types';

export function ReviewActions({ session, videoPath, busy, onVideoPathChange, onProcess }: { session: AttendanceSession | null; videoPath: string; busy: boolean; onVideoPathChange: (value: string) => void; onProcess: () => void }) {
  return <section className="my-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-lg font-semibold">Process classroom video</h2><p className="text-slate-600">Local paths are used for this MVP; no browser upload is performed.</p></div><span className="text-sm text-slate-500">CPU InsightFace · provisional evidence</span></div>
    <label className="mb-3 grid gap-1 text-sm font-semibold">Video path<input className="rounded-lg border border-slate-300 px-3 py-2 font-normal focus:border-blue-600 focus:outline-none" value={videoPath} onChange={(event) => onVideoPathChange(event.target.value)} /></label>
    <p className="mb-4 text-sm text-slate-600">Enrollment images are resolved by Express from the imported student directories.</p>
    <button className="rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50" onClick={onProcess} disabled={!session || busy || session.status === 'processing'}>{session?.status === 'processing' || busy ? 'Processing…' : 'Run AI recognition'}</button>
  </section>;
}
