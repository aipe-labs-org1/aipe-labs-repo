"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import {
  ANSWER_OPTIONS,
  CATEGORIES,
  PRODUCT_TYPES,
  VERDICTS,
  getApplicableItems,
  getCategory,
  getItemById,
} from "@/lib/launch-checklist/catalogue";
import { buildShareUrl } from "@/lib/launch-checklist/share";
import type {
  AssessmentInput,
  CategoryKey,
  ChecklistAnswer,
  ChecklistGap,
  LaunchReadinessResult,
  Verdict,
} from "@/lib/launch-checklist/types";
import { cn } from "@/lib/utils";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * "own"    — the visitor's own result on the checklist page. Can be stale, and
 *            offers "Copy share link".
 * "shared" — a read-only report opened from a share link. Never stale, shows
 *            the self-assessment disclaimer, and lists every answer.
 */
export type SummaryVariant = "own" | "shared";

interface ChecklistSummaryProps {
  result: LaunchReadinessResult | null;
  /**
   * The exact input that produced `result` — used for the report header, the
   * copied report, and the share link.
   */
  input: AssessmentInput | null;
  variant?: SummaryVariant;
  isStale?: boolean;
  headingRef?: RefObject<HTMLHeadingElement | null>;
}

type CopyStatus = "idle" | "copied" | "error";

export const SELF_ASSESSMENT_DISCLAIMER =
  "Self-assessment — this report has not been reviewed or verified by AIPE Labs.";

const SHARE_DISCLOSURE =
  "Anyone with this link can see your product name, description and every answer. Nothing is uploaded — the report lives in the link.";

/**
 * Per-verdict visual treatment, using the AI Idea Validator's band colours
 * (emerald → sky → amber → rose, most to least ready).
 *
 * Colour reinforces the verdict; the verdict label is always visible text.
 */
const VERDICT_STYLES: Record<Verdict, { card: string; eyebrow: string; badge: string }> = {
  READY: {
    card: "border-emerald-300 bg-emerald-50",
    eyebrow: "text-emerald-800",
    badge: "bg-emerald-700 text-white",
  },
  LAUNCH_WITH_CAVEATS: {
    card: "border-sky-300 bg-sky-50",
    eyebrow: "text-sky-800",
    badge: "bg-sky-700 text-white",
  },
  NOT_READY: {
    card: "border-amber-300 bg-amber-50",
    eyebrow: "text-amber-900",
    badge: "bg-amber-700 text-white",
  },
  PROTOTYPE: {
    card: "border-rose-300 bg-rose-50",
    eyebrow: "text-rose-900",
    badge: "bg-rose-700 text-white",
  },
};

// -----------------------------------------------------------------------------
// Formatting helpers — presentation only, never scoring
// -----------------------------------------------------------------------------

function answerLabel(answer: ChecklistAnswer): string {
  return ANSWER_OPTIONS.find((o) => o.value === answer)?.label ?? answer;
}

function productTypeLabels(input: AssessmentInput): string {
  return input.product.productTypes
    .map((t) => PRODUCT_TYPES.find((p) => p.key === t)?.label ?? t)
    .join(", ");
}

/** 15 → "15", 16.666… → "16.7". */
function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(1);
}

function excludedReason(input: AssessmentInput, variant: SummaryVariant): string {
  if (input.paymentsApplicable) return "every item marked Not applicable";
  return variant === "shared"
    ? "no money changes hands through the product"
    : "no money changes hands through your product";
}

// -----------------------------------------------------------------------------
// Report builder
// -----------------------------------------------------------------------------

/**
 * Build the plain-text launch report copied to the clipboard.
 * Derived exclusively from the scoring result and the input that produced it —
 * never reads live form state, never re-scores, never touches the network.
 */
function buildReport(
  result: LaunchReadinessResult,
  input: AssessmentInput,
  variant: SummaryVariant,
): string {
  const lines: string[] = [];
  lines.push("Founder Launch Checklist");
  lines.push("");
  lines.push(`Product: ${input.product.name}`);
  lines.push(`Description: ${input.product.oneLiner}`);
  lines.push(`Product type: ${productTypeLabels(input)}`);
  lines.push(`Users sign in: ${input.hasUserAccounts ? "Yes" : "No"}`);
  lines.push(`Money changes hands: ${input.paymentsApplicable ? "Yes" : "No"}`);
  if (input.paymentsApplicable && input.product.productTypes.includes("marketplace")) {
    lines.push(`Pays sellers or providers: ${input.paysOutSellers ? "Yes" : "No"}`);
  }
  lines.push("");
  lines.push(`Launch readiness: ${result.displayScore} / 100`);
  lines.push(`Verdict: ${VERDICTS[result.verdict].label}`);

  lines.push("");
  lines.push("Category scores:");
  for (const c of result.categoryScores) {
    lines.push(`- ${c.label}: ${c.displayPercent}%`);
  }
  for (const key of result.excludedCategories) {
    lines.push(`- ${getCategory(key).label}: not scored (${excludedReason(input, variant)})`);
  }

  lines.push("");
  lines.push("Hard blockers:");
  if (result.hardBlockers.length === 0) {
    lines.push("- None");
  } else {
    for (const b of result.hardBlockers) {
      lines.push(`- ${b.label} (${getCategory(b.category).label})`);
    }
  }

  lines.push("");
  lines.push("Hard blockers not fully done:");
  if (result.partialBlockers.length === 0) {
    lines.push("- None");
  } else {
    for (const b of result.partialBlockers) {
      lines.push(`- ${b.label} (Partial · ${getCategory(b.category).label})`);
    }
  }

  lines.push("");
  lines.push("Top gaps:");
  if (result.topGaps.length === 0) {
    lines.push("- None");
  } else {
    result.topGaps.forEach((g, i) => {
      lines.push(`${i + 1}. ${g.label} (${answerLabel(g.answer)} · ${getCategory(g.category).label})`);
    });
  }

  lines.push("");
  lines.push("Next actions:");
  if (result.nextActions.length === 0) {
    lines.push("- None");
  } else {
    result.nextActions.forEach((a, i) => {
      lines.push(`${i + 1}. ${a}`);
    });
  }

  lines.push("");
  if (variant === "shared") {
    lines.push(SELF_ASSESSMENT_DISCLAIMER);
  }
  lines.push("— Checked with the AIPE Labs Founder Launch Checklist");

  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// Clipboard — the AI Idea Validator's pattern, shared by both copy buttons
// -----------------------------------------------------------------------------

/**
 * Copy text with `navigator.clipboard`, reporting "copied" for two seconds or
 * "error" so the caller can show a select-and-copy fallback. Feedback resets
 * whenever `resetKey` changes, and the timeout never fires after unmount.
 */
function useClipboard(resetKey: unknown) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setStatus("idle");
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [resetKey]);

  async function copy(text: string) {
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(text);
        setStatus("copied");
        if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setStatus("idle"), 2000);
      } else {
        setStatus("error");
      }
    } catch {
      // Clipboard write can reject on permission denial, insecure context, or
      // browsers without the API. Fall back to the manual-select textarea.
      setStatus("error");
    }
  }

  return { status, copy };
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------

export default function ChecklistSummary({
  result,
  input,
  variant = "own",
  isStale = false,
  headingRef,
}: ChecklistSummaryProps) {
  const report = useClipboard(result);
  const shareLink = useClipboard(result);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareBuildFailed, setShareBuildFailed] = useState(false);

  // A shared report is a fixed snapshot and is never stale.
  const stale = variant === "own" && isStale;

  // Forget any previously built link when the result changes.
  useEffect(() => {
    setShareUrl(null);
    setShareBuildFailed(false);
  }, [result]);

  async function handleCopyReport() {
    if (!result || !input) return;
    await report.copy(buildReport(result, input, variant));
  }

  async function handleCopyShareLink() {
    if (!result || !input || stale) return;
    // Built from the exact input that produced this result, never live form
    // state. The origin is read at click time, so no server config is needed.
    let url: string;
    try {
      url = buildShareUrl(window.location.origin, input);
    } catch {
      // The form validates the same text rules first, so this should be
      // unreachable; never crash or copy a link that would open as invalid.
      setShareUrl(null);
      setShareBuildFailed(true);
      return;
    }
    setShareBuildFailed(false);
    setShareUrl(url);
    await shareLink.copy(url);
  }

  if (result === null || input === null) {
    return <PlaceholderPanel headingRef={headingRef} />;
  }

  const style = VERDICT_STYLES[result.verdict];
  const verdict = VERDICTS[result.verdict];

  return (
    <section
      aria-labelledby="result-heading"
      className="mt-12 rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      {variant === "shared" && (
        <p className="mb-6 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800">
          {SELF_ASSESSMENT_DISCLAIMER}
        </p>
      )}

      {stale && (
        <p
          role="status"
          className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          Your assessment changed after this result was calculated. Recalculate
          to update it — the score below reflects your previous answers.
        </p>
      )}

      <h2
        id="result-heading"
        ref={headingRef}
        tabIndex={-1}
        className="break-words text-2xl font-bold tracking-tight text-slate-900 focus:outline-none"
      >
        Launch readiness for {input.product.name}
      </h2>
      <p className="mt-1 break-words text-sm text-slate-700">{input.product.oneLiner}</p>
      <p className="mt-1 text-sm text-slate-600">
        {variant === "shared"
          ? `Self-assessed answers for: ${productTypeLabels(input)}.`
          : `Based on the answers you provided for: ${productTypeLabels(input)}.`}
      </p>

      {/* Score + verdict */}
      <div aria-live="polite" aria-atomic="true" className="mt-6 grid gap-4 sm:grid-cols-5">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 sm:col-span-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Readiness score
          </div>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-5xl font-bold tabular-nums text-slate-900">
              {result.displayScore}
            </span>
            <span className="text-2xl font-semibold text-slate-400"> / 100</span>
          </div>
          <div className="mt-4">
            <ProgressBar value={result.overallScore} label="Readiness score" className="h-3" />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Rounded for display. The verdict is decided by the exact score, hard
            blockers, and category scores together.
          </p>
        </div>

        <div className={cn("rounded-lg border-2 p-5 sm:col-span-3", style.card)}>
          <div className={cn("text-xs font-semibold uppercase tracking-wider", style.eyebrow)}>
            Verdict
          </div>
          <div className="mt-2">
            <span
              className={cn(
                "inline-block rounded-md px-3 py-1.5 text-base font-semibold shadow-sm sm:text-lg",
                style.badge,
              )}
            >
              {verdict.label}
            </span>
          </div>
          <p className="mt-3 text-sm text-slate-700">{verdict.summary}</p>
        </div>
      </div>

      {/* Hard blockers */}
      {result.hardBlockers.length > 0 && (
        <div className="mt-10 rounded-lg border-2 border-rose-300 bg-rose-50 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-rose-900">
            Hard blockers ({result.hardBlockers.length})
          </h3>
          <p className="mt-1 text-sm text-rose-900">
            {result.hardBlockers.length === 1
              ? "This item is missing and rules out “Ready to launch” until it is fixed."
              : "These items are missing and rule out “Ready to launch” until they are fixed."}
          </p>
          <BlockerList blockers={result.hardBlockers} borderClass="border-rose-200" />
        </div>
      )}

      {/* Hard blockers answered Partial (checklist v5) */}
      {result.partialBlockers.length > 0 && (
        <div className="mt-6 rounded-lg border-2 border-amber-300 bg-amber-50 p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-amber-900">
            Hard blockers not fully done ({result.partialBlockers.length})
          </h3>
          <p className="mt-1 text-sm text-amber-900">
            {result.partialBlockers.length === 1
              ? "This launch-stopping item is only partly done. The best possible verdict is “Not ready” until it is Done."
              : "These launch-stopping items are only partly done. The best possible verdict is “Not ready” until they are Done."}
          </p>
          <BlockerList blockers={result.partialBlockers} borderClass="border-amber-200" showAnswer />
        </div>
      )}

      {/* Category breakdown */}
      <div className="mt-10">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
          Category breakdown
        </h3>
        <ul className="mt-4 space-y-4">
          {result.categoryScores.map((c) => (
            <li key={c.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-sm font-medium text-slate-900">{c.label}</span>
                <span className="text-xs tabular-nums text-slate-500">
                  {c.displayPercent}%
                  <span className="mx-1.5 text-slate-300" aria-hidden="true">
                    ·
                  </span>
                  weight {formatWeight(c.effectiveWeight)}%
                </span>
              </div>
              <div className="mt-2">
                <ProgressBar value={c.percent} label={c.label} />
              </div>
            </li>
          ))}
          {result.excludedCategories.map((key: CategoryKey) => (
            <li key={key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="text-sm font-medium text-slate-500">{getCategory(key).label}</span>
              <span className="text-xs text-slate-500">
                Not scored — {excludedReason(input, variant)}. Its weight is shared
                across the other areas.
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Top gaps */}
      {result.topGaps.length > 0 && (
        <div className="mt-10">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Top {result.topGaps.length === 1 ? "gap" : `${result.topGaps.length} gaps`}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Ranked by impact: hard blockers first, then the items costing the most points.
          </p>
          <ol className="mt-4 space-y-3">
            {result.topGaps.map((g, i) => (
              <li key={g.itemId} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700"
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">
                    <span className="sr-only">Gap {i + 1}: </span>
                    {g.label}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span>{getCategory(g.category).label}</span>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span>Answered {answerLabel(g.answer)}</span>
                    {g.hardBlocker && (
                      <span className="rounded bg-rose-50 px-1.5 py-0.5 font-medium text-rose-800 ring-1 ring-inset ring-rose-200">
                        Hard blocker
                      </span>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Next actions */}
      {result.nextActions.length > 0 && (
        <div className="mt-10">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Next actions
          </h3>
          <ol className="mt-4 space-y-3">
            {result.nextActions.map((action, i) => (
              <li key={`${i}-${action}`} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white"
                >
                  {i + 1}
                </span>
                <span className="text-sm text-slate-700">
                  <span className="sr-only">Action {i + 1}: </span>
                  {action}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* All missing items */}
      {result.missingItems.length > 0 && (
        <details className="mt-10 rounded-lg border border-slate-200 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2">
            All items answered Missing ({result.missingItems.length})
          </summary>
          <ul className="mt-3 space-y-1.5">
            {result.missingItems.map((m) => (
              <li key={m.itemId} className="text-sm text-slate-700">
                {m.label}
                <span className="text-xs text-slate-500"> — {getCategory(m.category).label}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Every answer — shared reports only, so readers can see what was claimed */}
      {variant === "shared" && <AllAnswers input={input} />}

      {/* Copy report + share link */}
      <div className="mt-10 space-y-6 border-t border-slate-200 pt-6">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="primary" onClick={handleCopyReport} disabled={stale}>
              {report.status === "copied" ? "Copied!" : "Copy launch report"}
            </Button>
            {report.status === "copied" && (
              <span role="status" className="text-sm text-emerald-700">
                Launch report copied to your clipboard.
              </span>
            )}
          </div>
          {report.status === "error" && (
            <ManualCopyFallback
              value={buildReport(result, input, variant)}
              label="Launch report — select and copy manually"
              className="min-h-[320px]"
            />
          )}
          <p className="mt-3 text-xs text-slate-500">
            {stale
              ? "Recalculate before copying so the report matches your current answers."
              : "Copies the score, verdict, category scores, hard blockers, top gaps, and next actions as plain text."}
          </p>
        </div>

        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="secondary" onClick={handleCopyShareLink} disabled={stale}>
              {shareLink.status === "copied" ? "Link copied!" : "Copy share link"}
            </Button>
            {shareLink.status === "copied" && (
              <span role="status" className="text-sm text-emerald-700">
                Share link copied to your clipboard.
              </span>
            )}
          </div>
          {shareLink.status === "error" && shareUrl !== null && (
            <ManualCopyFallback
              value={shareUrl}
              label="Share link — select and copy manually"
              className="min-h-[96px] break-all"
            />
          )}
          {shareBuildFailed && (
            <p role="alert" className="mt-3 text-sm text-amber-800">
              This report can&apos;t be shared as a link because the product name
              or description contains hidden formatting characters. Edit them and
              recalculate.
            </p>
          )}
          <p className="mt-3 text-xs text-slate-500">
            {stale
              ? "Recalculate before sharing so the link matches your current answers."
              : variant === "shared"
                ? "Copies the link to this report. Anyone with it can see the product name, description and every answer."
                : SHARE_DISCLOSURE}
          </p>
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------------

/** Hard-blocker cards: label, category, why it blocks launch, and the action. */
function BlockerList({
  blockers,
  borderClass,
  showAnswer = false,
}: {
  blockers: readonly ChecklistGap[];
  borderClass: string;
  showAnswer?: boolean;
}) {
  return (
    <ul className="mt-4 space-y-4">
      {blockers.map((b) => (
        <li key={b.itemId} className={cn("rounded-md border bg-white p-4", borderClass)}>
          <p className="text-sm font-semibold text-slate-900">{b.label}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {getCategory(b.category).label}
            {showAnswer && ` · Answered ${answerLabel(b.answer)}`}
          </p>
          <p className="mt-2 text-sm text-slate-700">
            <span className="font-medium text-slate-900">Why it blocks launch: </span>
            {getItemById(b.itemId)?.whyItMatters}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            <span className="font-medium text-slate-900">Action: </span>
            {b.action}
          </p>
        </li>
      ))}
    </ul>
  );
}

function ManualCopyFallback({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  return (
    <div role="alert" className="mt-3">
      <p className="text-sm text-amber-800">
        Your browser did not allow copying automatically. Select the text below
        and copy it manually.
      </p>
      <textarea
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className={cn(
          "mt-2 w-full rounded-md border border-slate-300 bg-white p-3 font-mono text-xs text-slate-700 focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500",
          className,
        )}
        aria-label={label}
      />
    </div>
  );
}

/** Every applicable item and its answer, grouped by category, from the catalogue. */
function AllAnswers({ input }: { input: AssessmentInput }) {
  const items = getApplicableItems({
    productTypes: input.product.productTypes,
    hasUserAccounts: input.hasUserAccounts,
    paymentsApplicable: input.paymentsApplicable,
    sellsDigitalGoodsInApp: input.sellsDigitalGoodsInApp,
    paysOutSellers: input.paysOutSellers,
  });
  const groups = CATEGORIES.map((category) => ({
    category,
    items: items.filter((i) => i.category === category.key),
  })).filter((g) => g.items.length > 0);

  return (
    <details className="mt-4 rounded-lg border border-slate-200 p-4">
      <summary className="cursor-pointer text-sm font-medium text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2">
        All answers ({items.length})
      </summary>
      <div className="mt-4 space-y-5">
        {groups.map(({ category, items: categoryItems }) => (
          <div key={category.key}>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              {category.label}
            </h4>
            <ul className="mt-2 space-y-1.5">
              {categoryItems.map((item) => {
                const answer = input.answers[item.id];
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm text-slate-700"
                  >
                    <span>{item.label}</span>
                    <span className="text-xs font-medium text-slate-900">
                      {answer ? answerLabel(answer) : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}

// -----------------------------------------------------------------------------
// Placeholder (no result yet)
// -----------------------------------------------------------------------------

function PlaceholderPanel({
  headingRef,
}: {
  headingRef?: RefObject<HTMLHeadingElement | null>;
}) {
  return (
    <section
      aria-labelledby="result-heading"
      className="mt-12 rounded-xl border border-dashed border-slate-300 bg-white p-6 shadow-sm"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2
          id="result-heading"
          ref={headingRef}
          tabIndex={-1}
          className="text-xl font-semibold text-slate-900 focus:outline-none"
        >
          Your launch readiness
        </h2>
        <span className="flex-none rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          Awaiting assessment
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Complete the checklist and click Calculate launch readiness. You will
        get a score out of 100, a verdict, a score for each area, any hard
        blockers, your top five gaps with next actions, a launch report you can
        copy, and a link you can share.
      </p>

      <div className="mt-6 flex flex-col gap-4 rounded-lg bg-slate-50 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Readiness score
          </div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-4xl font-bold text-slate-400">—</span>
            <span className="text-xl text-slate-400"> / 100</span>
          </div>
        </div>
        <div className="rounded-md bg-slate-200 px-3 py-2 text-sm font-medium text-slate-500">
          Verdict will appear here
        </div>
      </div>
    </section>
  );
}
