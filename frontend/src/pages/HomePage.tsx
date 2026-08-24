export default function HomePage() {
  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:py-28">
      <section className="max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-blue-700">
          USAR faculty workspace
        </p>
        <h1 className="my-2 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Smart Classroom Attendance
        </h1>
        <p className="mb-8 text-lg text-slate-600">
          Review provisional AI recognition evidence before finalizing attendance.
        </p>
        <a
          className="inline-block rounded-lg bg-blue-700 px-4 py-3 font-medium text-white hover:bg-blue-800"
          href="/attendance"
        >
          Open attendance workflow
        </a>
      </section>
    </main>
  );
}
