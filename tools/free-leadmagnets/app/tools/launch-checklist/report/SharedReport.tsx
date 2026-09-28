"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { calculateLaunchReadiness } from "@/lib/launch-checklist/calculate";
import { parseShareFragment } from "@/lib/launch-checklist/share";
import type { AssessmentInput, LaunchReadinessResult } from "@/lib/launch-checklist/types";

import ChecklistSummary from "../ChecklistSummary";

type ReportState =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "outdated" }
  | { kind: "valid"; input: AssessmentInput; result: LaunchReadinessResult };

const CHECKLIST_PATH = "/tools/launch-checklist";

/**
 * Renders a report from the `#r=` fragment of the current URL.
 *
 * The fragment is read only after mount (the server never sees it), so the
 * prerendered HTML is always the loading state and hydration matches. The
 * verdict is recomputed with the scoring engine — nothing in the link is
 * trusted as a result. This component never reads or writes localStorage, so
 * opening a shared report cannot touch the visitor's own saved checklist.
 */
export default function SharedReport() {
  const [state, setState] = useState<ReportState>({ kind: "loading" });

  useEffect(() => {
    function read() {
      const parsed = parseShareFragment(window.location.hash);
      if (parsed.status === "valid") {
        try {
          const result = calculateLaunchReadiness(parsed.input);
          setState({ kind: "valid", input: parsed.input, result });
        } catch {
          setState({ kind: "invalid" });
        }
      } else if (parsed.status === "outdated") {
        setState({ kind: "outdated" });
      } else {
        // "missing" and "invalid" look the same to a visitor.
        setState({ kind: "invalid" });
      }
    }
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  if (state.kind === "loading") {
    return (
      <p role="status" className="mt-10 text-sm text-slate-500">
        Loading the shared report…
      </p>
    );
  }

  if (state.kind === "invalid") {
    return (
      <Notice title="This report link isn't valid">
        The link is invalid or incomplete — it may have been cut off when it was
        copied or changed after it was created. Ask the person who shared it for
        a fresh link, or run the checklist for your own product.
      </Notice>
    );
  }

  if (state.kind === "outdated") {
    return (
      <Notice title="This report is out of date">
        The Founder Launch Checklist has changed since this report was created,
        so its score can&apos;t be shown accurately under the current rules. Ask
        the person who shared it to run the current checklist, or run it for your
        own product.
      </Notice>
    );
  }

  return (
    <>
      <ChecklistSummary variant="shared" result={state.result} input={state.input} />
      <div className="mt-8 flex justify-center">
        <RunChecklistLink />
      </div>
    </>
  );
}

function RunChecklistLink() {
  return (
    <Link
      href={CHECKLIST_PATH}
      className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
    >
      Run the checklist for your product
    </Link>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby="report-notice"
      className="mt-10 rounded-xl border border-amber-200 bg-amber-50 p-6"
    >
      <h2 id="report-notice" className="text-lg font-semibold text-amber-900">
        {title}
      </h2>
      <p className="mt-2 text-sm text-amber-900">{children}</p>
      <div className="mt-5">
        <RunChecklistLink />
      </div>
    </section>
  );
}
