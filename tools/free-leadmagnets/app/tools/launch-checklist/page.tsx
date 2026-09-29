import type { Metadata } from "next";
import LaunchChecklistApp from "./LaunchChecklistApp";

export const metadata: Metadata = {
  title: "Founder Launch Checklist | AIPE Labs",
  description:
    "Check whether your product is ready to launch with the AIPE Labs Founder Launch Checklist.",
};

export default function LaunchChecklistPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="border-b border-slate-200 pb-8">
        <p className="text-sm font-medium uppercase tracking-wider text-sky-700">
          AIPE Labs · Free Tool
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Founder Launch Checklist
        </h1>
        <p className="mt-4 text-lg text-slate-700">
          Find out what&apos;s actually missing before you launch.
        </p>
        <p className="mt-3 text-slate-600">
          Work through a checklist tailored to your product across eight areas —
          product, onboarding, reliability, security, privacy, payments,
          analytics, and launch readiness. The tool scores your answers out of
          100, flags hard blockers that rule out launching, and lists the gaps
          worth closing first. The result reflects your own answers — it is not
          an audit.
        </p>
        <p className="mt-3 text-sm text-slate-500">
          Nothing you type here is sent anywhere. Your answers are saved only in
          this browser so you can pick up where you left off — Start again
          clears them. Scoring runs entirely in your browser.
        </p>
      </header>

      <LaunchChecklistApp />
    </main>
  );
}
