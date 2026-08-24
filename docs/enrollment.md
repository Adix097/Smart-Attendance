# Students and enrollment photos

## students.csv

Path (local import): `backend/data/students.csv`

Columns:

```text
student_id,first_name,last_name,batch,group
```

Rules enforced by the importer:

- `student_id` is a digit string (leading zeros matter and are kept as text).
- `group` is `A` or `B`.
- IDs must be unique.

Example shape (not a claim about who is enrolled in which class):

```text
14119051925,aditya,vishwakarma,B2,B
```

## Local enrollment directory

For local AI / import validation:

```text
backend/data/enrollment/
  <student_id>/
    photo.jpg
```

Each student id needs a folder with at least one image (`.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`).

`backend/data/` is gitignored so real photos are not committed.

## Production: private Supabase Storage

Bucket name (config): `enrollment` (`SUPABASE_STORAGE_BUCKET`).

Object layout matches the local folders:

```text
enrollment/<student_id>/photo.jpg
```

The bucket is **private**. Photos must not be public URLs and must not be committed to Git.

### Why private

Enrollment images are biometric identity data. Only a trusted server should read them.

### Who can read them

- **Frontend: never.** No Supabase service-role key in the browser.
- **Backend: does not serve the photos to the UI.**
- **AI service:** when `ENROLLMENT_SOURCE=supabase`, uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` server-side to list/download into a cache directory, then builds the InsightFace gallery.

Local AI can keep `ENROLLMENT_SOURCE=local` and use the `enrollment_dir` path the backend sends (`ENROLLMENT_ROOT`, default `backend/data/enrollment`).

## How IDs connect to faces

1. Student number / folder name = identity label in the gallery (example `14119051925`).
2. InsightFace matches video faces to those labels via embedding similarity.
3. Backend maps that label through the student table / identity map to a DB student row.
4. Then it checks whether that student is **expected for this class**.

If a face matches a campus student who is not expected for the class, they are tagged unexpected — not silently marked present for that class.
