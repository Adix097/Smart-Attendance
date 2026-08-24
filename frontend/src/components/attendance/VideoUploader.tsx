import { useEffect, useMemo, useRef, useState } from 'react';
import type { AttendanceInputSource } from '../../types/attendance';

const acceptedTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
const acceptedExtensions = /\.(mp4|webm|mov|avi)$/i;
const maxFileSize = 48 * 1024 * 1024;

export default function VideoUploader({
  source,
  disabled,
  onChange,
}: {
  source: AttendanceInputSource | null;
  disabled: boolean;
  onChange: (source: AttendanceInputSource | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const file = source?.type === 'recorded-video' ? source.file : null;

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const select = (candidate: File | undefined) => {
    setError('');
    if (!candidate) return;
    if (candidate.size === 0) {
      setError('The selected video file is empty.');
      return;
    }
    if (candidate.size > maxFileSize) {
      setError('Video files must be smaller than 48 MB');
      return;
    }
    if (
      !acceptedTypes.includes(candidate.type) &&
      !acceptedExtensions.test(candidate.name)
    ) {
      setError('Unsupported video format. Choose MP4, WebM, MOV, or AVI.');
      return;
    }
    onChange({ type: 'recorded-video', file: candidate });
  };

  return (
    <div className="grid gap-3">
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/x-msvideo,.mov,.avi"
        onChange={(event) => select(event.target.files?.[0])}
        disabled={disabled}
      />

      {!file ? (
        <button
          type="button"
          className={`rounded-xl border-2 border-dashed p-8 text-center ${dragging ? 'border-blue-600 bg-blue-50' : 'border-slate-300 bg-slate-50'
            } ${disabled ? 'cursor-not-allowed opacity-50' : 'hover:border-blue-500'}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            select(event.dataTransfer.files[0]);
          }}
          disabled={disabled}
        >
          <strong className="block">Drag video here</strong>
          <span className="text-sm text-slate-600">
            or click to choose a recorded video
          </span>
        </button>
      ) : (
        <div className="grid gap-3">
          <video
            className="max-h-72 w-full rounded-lg bg-slate-950"
            controls
            src={previewUrl ?? undefined}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <strong>{file.name}</strong> · {(file.size / 1024 / 1024).toFixed(2)} MB
            </span>
            <button
              type="button"
              className="text-red-700 hover:underline"
              onClick={() => onChange(null)}
              disabled={disabled}
            >
              Remove video
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
