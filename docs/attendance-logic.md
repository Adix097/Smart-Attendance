# Attendance logic

This is the backend’s job after the AI returns faces.

## People categories

| Category | Meaning |
| --- | --- |
| Expected | Student is supposed to be in this class (from timetable batch/group / enrollments logic) |
| Recognized | Gallery identity matched in the video |
| Unexpected | Matched a real campus student who is **not** expected for this class |
| Unknown | Face did not match anyone strongly enough, or identity not in DB |

Identity resolution: `resolveRecognizedIdentity` in `verification.ts`.

## Evidence vs attendance

- **Sightings / observations** = recognition evidence.
- **Attendance records** = provisional then finalized decisions.

AI does not finalize the register by itself.

## Provisional records

For expected students with enough confirmed sightings evidence, the backend runs `verifyStudent`:

Defaults:

- at least 2 sightings
- at least 30s between first and last sighting
- last sighting within 60s of class end
- late if first seen more than 15 minutes after start

Outcomes:

| Result | Proposed status |
| --- | --- |
| `AUTO_VERIFIED_PRESENT` | `present` |
| `LATE_ENTRY` / insufficient evidence | `uncertain` (faculty review) |
| unexpected / unknown tagged on observations | not treated as normal class present |

Faculty can finalize with present/absent/uncertain/unknown via `/finalize`.

## Session states

| DB status | Meaning |
| --- | --- |
| `open` | Created, not processed (UI: pending) |
| `processing` | AI call in progress |
| `ready_for_review` | Evidence stored (UI: completed) |
| `finalized` | Review finished for the workflow |
| `failed` | Processing error stored in `processing_error` |

## Class timing

Using `occurrenceStatus(start, end, now)`:

### Upcoming

- Backend process returns `409 SESSION_NOT_STARTED`.
- No AI call.
- Session stays open.
- Frontend disables upload/process.

### Active

- Processing allowed.
- Normal pipeline.

### Ended

- Processing is still allowed by the process route (recording of a finished class).
- The class **list** only includes ended classes when `ALLOW_ENDED_SESSION_TEST=true`.
- Otherwise the UI only offers active or next upcoming.

## When AI fails

- Session → `failed`
- Error message stored and shown
- No provisional success records from that failed run
- Client may see timeout / unreachable / gateway-startup messages depending on the failure mode

## When recognition is uncertain

Uncertain identities stay in evidence for review. They are not treated like solid auto-present without the verification rules and faculty step.
