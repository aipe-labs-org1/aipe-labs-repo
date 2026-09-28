import type { Metadata } from "next";
import SharedReport from "./SharedReport";

// Static, generic metadata only. The shared assessment lives in the URL
// fragment, which never reaches the server, and product text must never be
// placed in metadata.
export const metadata: Metadata = {
  title: "Launch readiness report | AIPE Labs",
  description:
    "A launch readiness self-assessment shared from the AIPE Labs Founder Launch Checklist.",
  robots: { index: false, follow: false },
};

export default function LaunchReadinessReportPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="border-b border-slate-200 pb-8">
        <p className="text-sm font-medium uppercase tracking-wider text-sky-700">
          AIPE Labs · Founder Launch Checklist
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Launch readiness report
        </h1>
        <p className="mt-4 text-slate-600">
          Someone shared their Founder Launch Checklist result with you. The score
          and verdict are calculated in your browser from the answers in this link
          — nothing is stored on our servers.
        </p>
      </header>

      <SharedReport />
    </main>
  );
}
