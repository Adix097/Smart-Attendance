# Overview

## What this project does

Smart-attendance helps faculty take classroom attendance from a short video instead of calling out every name.

The system:

1. Knows which class is running in which room (from room timetable CSVs).
2. Knows which students belong to that class.
3. Runs face recognition on a recorded video (or a short webcam clip).
4. Produces **provisional** attendance: present / uncertain / unknown, plus evidence.
5. Lets a human review and finalize records.

It does **not** silently mark the official register without review.

## Problem it solves

Manual roll call is slow. CCTV-style video already exists in many classrooms. This project turns that video into recognition evidence tied to the real timetable and student list, while keeping a faculty review step.

## Overall flow

```text
Faculty opens the site (Vercel)
  → picks a classroom and class
  → creates an attendance session
  → uploads a video (or captures webcam)
  → frontend POSTs to backend /api/...
  → backend checks the class timing and expected students
  → backend sends the video bytes to the AI service on Render
  → AI service loads enrollment faces (Supabase Storage in production)
  → InsightFace detects faces, matches embeddings, returns results
  → backend stores observations, sightings, provisional records
  → frontend shows evidence and lets faculty finalize
```

Local development is the same idea, except:

- frontend talks to Express on your machine
- AI service is local
- enrollment photos can come from `backend/data/enrollment/` instead of Supabase Storage
