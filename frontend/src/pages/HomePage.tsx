import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:py-28">
      <section className="max-w-2xl">
        <h1 className="my-2 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Smart Classroom Attendance
        </h1>
        <p className="mb-8 text-lg text-slate-600">
          Review provisional AI recognition before finalizing attendance.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            className="inline-block rounded-lg bg-blue-700 px-4 py-3 font-medium text-white hover:bg-blue-800"
            to="/attendance"
          >
            Open Attendance Page
          </Link>
          <Link
            className="inline-block rounded-lg border border-slate-300 bg-white px-4 py-3 font-medium text-slate-900 hover:bg-slate-50"
            to="/timetable"
          >
            Browse classroom timetables
          </Link>
        </div>
      </section>
    </main>
  );
}
