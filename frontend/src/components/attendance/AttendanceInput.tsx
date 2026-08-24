import { useEffect, useState } from 'react';
import type { AttendanceInputSource } from '../../types/attendance';
import VideoUploader from './VideoUploader';
import WebcamCapture from './WebcamCapture';

function stopWebcam(source: AttendanceInputSource | null) {
  if (source?.type === 'webcam') source.stream.getTracks().forEach((track) => track.stop());
}

export default function AttendanceInput({
  source,
  disabled,
  onChange,
}: {
  source: AttendanceInputSource | null;
  disabled: boolean;
  onChange: (source: AttendanceInputSource | null) => void;
}) {
  const [mode, setMode] = useState<'recorded-video' | 'webcam'>('recorded-video');

  useEffect(() => () => stopWebcam(source), [source]);

  const selectMode = (next: 'recorded-video' | 'webcam') => {
    setMode(next);
    if (next === 'recorded-video' && source?.type === 'webcam') {
      stopWebcam(source);
      onChange(null);
    }
    if (next === 'webcam' && source?.type === 'recorded-video') onChange(null);
  };

  const tabClass = (tab: typeof mode) =>
    `rounded-lg px-3 py-2 text-sm font-medium ${
      mode === tab ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-700'
    }`;

  return (
    <section className="my-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Input source</h2>
        <p className="text-slate-600">
          Choose a local recording or the laptop camera. Audio is never captured.
        </p>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          className={tabClass('recorded-video')}
          onClick={() => selectMode('recorded-video')}
        >
          Recorded Video
        </button>
        <button
          type="button"
          className={tabClass('webcam')}
          onClick={() => selectMode('webcam')}
        >
          Live Camera
        </button>
      </div>

      {mode === 'recorded-video' ? (
        <VideoUploader source={source} disabled={disabled} onChange={onChange} />
      ) : (
        <WebcamCapture source={source} disabled={disabled} onChange={onChange} />
      )}

      <p className="mt-3 text-sm text-slate-600">
        {source ? 'Ready to process.' : 'Select a source before processing.'}
      </p>
    </section>
  );
}
