CREATE UNIQUE INDEX IF NOT EXISTS attendance_sightings_occurrence_key
  ON attendance_sightings (attendance_session_id, tracker_id, observed_at);

CREATE UNIQUE INDEX IF NOT EXISTS occupancy_snapshots_occurrence_key
  ON occupancy_snapshots (attendance_session_id, observed_at);
