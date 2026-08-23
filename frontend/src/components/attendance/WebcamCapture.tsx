import { useEffect, useRef, useState } from 'react';
import type { AttendanceInputSource } from '../../types/attendance';

export function WebcamCapture({ source, disabled, onChange }: {
  source: AttendanceInputSource | null;
  disabled: boolean;
  onChange: (source: AttendanceInputSource | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (source?.type !== 'webcam' || !videoRef.current) return;
    videoRef.current.srcObject = source.stream;
    return () => { videoRef.current?.srcObject === source.stream && (videoRef.current.srcObject = null); };
  }, [source]);

  const start = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) return setError('Camera access is not supported by this browser.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      onChange({ type: 'webcam', stream });
    } catch {
      setError('Camera permission was denied or the camera is unavailable.');
    }
  };

  const stop = () => {
    if (source?.type === 'webcam') source.stream.getTracks().forEach((track) => track.stop());
    onChange(null);
  };

  return <div className="grid gap-3">
    {source?.type === 'webcam' ? <>
      <video ref={videoRef} autoPlay muted playsInline className="max-h-72 w-full rounded-lg bg-slate-950" />
      <button type="button" className="w-fit rounded-lg border border-slate-300 px-4 py-2 hover:bg-slate-50" onClick={stop} disabled={disabled}>Stop camera</button>
    </> : <button type="button" className="w-fit rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800 disabled:opacity-50" onClick={start} disabled={disabled}>Start camera</button>}
    {error && <p className="text-sm text-red-700">{error}</p>}
  </div>;
}
