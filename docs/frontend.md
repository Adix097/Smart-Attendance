# Frontend

Location: `frontend/`

## Stack

- React 19
- Vite
- Tailwind CSS
- React Router (`react-router-dom`)

## Entry and routing

- `src/main.tsx` mounts the app.
- `src/App.tsx` sets up `BrowserRouter` and routes:

| Path | Page |
| --- | --- |
| `/` | Home |
| `/attendance` | Attendance flow |
| `/timetable` | Classroom timetable |
| anything else | redirect to `/` |

Navigation uses React Router `Link` / `BackLink`, not `window.location`.

Refresh and direct URLs still work because Vercel rewrites unknown paths to `index.html` (SPA fallback in `vercel.json`).

## Main pages

### Home (`HomePage.tsx`)

Links to Attendance and Timetable.

### Attendance (`AttendancePage.tsx`)

Full processing flow:

1. Pick a classroom (`ClassroomSelector`).
2. See current/next (or ended, if test flag is on) class (`ClassSelector`).
3. Create an attendance session (`SessionHeader`).
4. Upload video or use webcam (`ReviewActions` → `AttendanceInput`).
5. Run recognition.
6. See status / errors (`SessionStatus`).
7. After success, review evidence (`EvidenceSummary`) and finalize rows (`AttendanceTable`).

Back link: **Back to home**.

### Timetable (`ClassroomTimetablePage.tsx`)

Pick a room, see the weekly grid and the active/next occurrence. Link to take attendance.

Back link: **Back to home**.

## Important hooks

- `useClassSessions` — loads `/api/attendance-classes` for the selected room.
- `useAttendance` — create session, process video, poll status while `processing`, load observations/records, finalize.
- `useClassroomTimetable` — classrooms list + one room’s timetable.

## API calls

`src/api/client.ts` prefixes requests with `VITE_API_URL` or `/api`.

Locally, Vite proxies `/api` to `http://127.0.0.1:3001`.

In production, Vercel rewrites `/api/*` to the Render backend.

Helpers:

- `api/attendance.ts` — classes, sessions, process, status, observations, records, finalize
- `api/timetable.ts` — classrooms and room timetable

Process body sends base64 video:

```json
{
  "video_filename": "classroom.mp4",
  "video_data_base64": "...."
}
```

There is a ~48 MB client-side size limit on uploads.

## Session status on the UI

Backend DB statuses are mapped for the UI:

| Database | UI |
| --- | --- |
| `open` | `pending` |
| `processing` | `processing` |
| `ready_for_review` / `finalized` | `completed` |
| `failed` | `failed` |

Class occurrence status (`upcoming` / `active` / `ended`) comes from scheduled start/end vs now in `APP_TIMEZONE`.

- **upcoming** — upload/process controls are disabled; message shows when processing opens.
- **active** / **ended** — processing allowed (ended only appears in the class list when `ALLOW_ENDED_SESSION_TEST=true` on the backend).

## Navigation summary

- Home → Attendance / Timetable (`Link`)
- Attendance / Timetable → Home (`BackLink`)
- Attendance ↔ Timetable cross links (`Link`)
