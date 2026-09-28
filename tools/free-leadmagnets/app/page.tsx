import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-wider text-sky-700">
        AIPE Labs
      </p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">
        Free Tools
      </h1>
      <p className="mt-4 text-slate-600">
        Practical tools that help builders move from AI demos to launched, production-grade software.
      </p>

      <ul className="mt-10 space-y-4">
        <li>
          <Link
            href="/tools/idea-validator"
            className="block rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow"
          >
            <h2 className="text-lg font-semibold text-slate-900">
              AI Idea Validator
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Score your idea out of 100 and decide whether to build an MVP, validate with a landing page or interviews, research more, or pause and reshape.
            </p>
            <p className="mt-3 text-sm font-medium text-sky-700">
              Open the tool →
            </p>
          </Link>
        </li>
        <li>
          <Link
            href="/tools/launch-checklist"
            className="block rounded-lg border border-slate-200 bg-white p-6 shadow-sm transition hover:border-slate-300 hover:shadow"
          >
            <h2 className="text-lg font-semibold text-slate-900">
              Founder Launch Checklist
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Check your product across eight launch areas, see the hard blockers that rule out launching, and get your top gaps and next actions.
            </p>
            <p className="mt-3 text-sm font-medium text-sky-700">
              Open the tool →
            </p>
          </Link>
        </li>
      </ul>
    </main>
  );
}
