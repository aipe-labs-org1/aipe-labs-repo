import type { AssessmentInput } from "./types";

/**
 * A ready-to-score example assessment for the "Try an example" control.
 *
 * Holds answers only — never a score. The UI always scores samples through
 * `calculateLaunchReadiness`, and `samples.test.ts` checks the fixture stays
 * complete and lands where its summary says it does.
 */
export interface SampleAssessment {
  readonly slug: string;
  readonly label: string;
  readonly summary: string;
  readonly input: AssessmentInput;
}

/**
 * Threadloom — an AI + SaaS product that charges users.
 *
 * A realistic "almost there" founder: strong positioning, but gaps in
 * onboarding, reliability, privacy (no privacy policy yet — a hard blocker),
 * payments, analytics, and go-to-market.
 */
export const THREADLOOM: SampleAssessment = {
  slug: "threadloom",
  label: "Threadloom — AI + SaaS",
  summary:
    "An AI writing SaaS with strong positioning but no privacy policy yet, plus onboarding, reliability, payment, analytics, and launch gaps.",
  input: {
    product: {
      name: "Threadloom",
      oneLiner: "Turn long-form blog posts into ready-to-publish social threads.",
      productTypes: ["ai", "saas"],
    },
    hasUserAccounts: true, // creators sign in
    paymentsApplicable: true,
    sellsDigitalGoodsInApp: false,
    paysOutSellers: false, // not a marketplace
    answers: {
      // Product & positioning — strong
      "pp-core-job-works": "done",
      "pp-value-proposition": "done",
      "pp-public-page": "done",
      "pp-scope-trimmed": "done",
      "pp-ai-limits-stated": "partial",

      // Onboarding & activation — gaps
      "oa-signup-fast": "done",
      "oa-first-run-guided": "missing",
      "oa-help-contact": "partial",
      "oa-ai-example-inputs": "partial",
      "oa-saas-team-invites": "notApplicable", // solo creators for v1

      // Reliability & quality — gaps
      "rq-backups-enabled": "done",
      "rq-separate-environments": "partial",
      "rq-monitoring-alerts": "missing",
      "rq-critical-path-tests": "partial",
      "rq-rollback-ready": "done",
      "rq-core-screens-fast": "done",
      "rq-ai-failure-handling": "missing",
      "rq-ai-output-evaluated": "partial",

      // Security & auth — mostly solid
      "sa-https-everywhere": "done",
      "sa-no-exposed-secrets": "done",
      "sa-authorization-enforced": "done",
      "sa-proven-auth": "done",
      "sa-rate-limiting": "partial",
      "sa-dependency-scanning": "missing",
      "sa-ai-prompt-injection": "partial",
      "sa-ai-usage-limits": "done",
      "sa-saas-roles": "notApplicable", // no team workspaces yet

      // Data & privacy — the hard blocker lives here
      "dp-privacy-policy": "missing",
      "dp-terms-of-service": "partial",
      "dp-data-inventory": "partial",
      "dp-account-deletion": "partial",
      "dp-cookie-consent": "done",
      "dp-ai-data-use-disclosed": "partial",
      "dp-saas-data-export": "done",

      // Payments & billing — gaps
      "pb-live-payment-tested": "done",
      "pb-webhooks-verified": "done",
      "pb-failed-payments-handled": "missing",
      "pb-receipts-tax-refunds": "partial",
      "pb-saas-self-serve-plans": "partial",

      // Analytics & feedback — gaps
      "af-activation-tracked": "partial",
      "af-traffic-sources": "missing",
      "af-feedback-channel": "done",
      "af-metrics-review": "missing",
      "af-ai-output-rating": "missing",

      // Launch readiness & GTM — gaps
      "lg-launch-channels-chosen": "done",
      "lg-launch-assets-ready": "partial",
      "lg-external-users-tried": "partial",
      "lg-launch-day-owner": "missing",
      "lg-contact-early-users": "done",
      "lg-name-trademark-checked": "missing",
      "lg-seo-social-previews": "done",
      "lg-changelog-status-page": "missing",
    },
  },
};

/** All shipped samples. */
export const SAMPLES: readonly SampleAssessment[] = [THREADLOOM] as const;
