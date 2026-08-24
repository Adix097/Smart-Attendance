# Ended-session test flag

## Variable

```text
ALLOW_ENDED_SESSION_TEST=true
```

Set this on the **backend** only (Render env or local `.env`).

Anything other than the exact string `true` leaves normal behavior.

## What it does

Normally the attendance class picker only shows:

- the class that is **active** now, or else
- the **next upcoming** class

So if the next real class is tomorrow morning, the UI only offers that upcoming slot — and processing is blocked until it starts.

With the flag enabled, the backend also:

1. Ensures a `class_sessions` row exists for the **most recent ended** timetable occurrence (per room).
2. Lists that ended class in `/api/attendance-classes` (usually first), still marked `ended`.

The process route already allows ended classes. The flag only makes them **selectable** without editing timetable CSVs or weakening upcoming/active rules.

## What it does not do

- Does not change timetable CSV data
- Does not disable upcoming protection
- Does not mock AI or fake students
- Does not lower recognition thresholds
- Does not make Storage public

## How to use it safely

1. Deploy backend with the flag.
2. Confirm `GET /api/health` shows `"ended_session_test": true`.
3. On `/attendance`, pick the room and the class labeled `ended`.
4. Upload a real recording and run recognition through the deployed AI service.
5. When done, **remove** the variable (or set it to something other than `true`) and restart.

Leaving it on in everyday production is unnecessary: faculty would see old classes in the picker.
