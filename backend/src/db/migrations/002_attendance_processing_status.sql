ALTER TABLE attendance_sessions
  ADD COLUMN IF NOT EXISTS processing_error text;

ALTER TABLE attendance_sessions
  DROP CONSTRAINT IF EXISTS attendance_sessions_status_check;

ALTER TABLE attendance_sessions
  ADD CONSTRAINT attendance_sessions_status_check
  CHECK (
    status IN ('open', 'processing', 'ready_for_review', 'finalized', 'failed')
  );
