import type {
  ApplicabilityContext,
  CategoryKey,
  ChecklistAnswer,
  ChecklistCategory,
  ChecklistItem,
  ItemScore,
  ProductType,
  ProductTypeMeta,
  ScoredAnswer,
  Verdict,
  VerdictMeta,
} from "./types";

/**
 * Founder Launch Checklist catalogue — the single source of truth for product
 * types, categories, category weights, answer points, and checklist items.
 *
 * Scoring logic and UI read from here; they must not duplicate labels,
 * weights, or applicability rules.
 */

// -----------------------------------------------------------------------------
// Versioning
// -----------------------------------------------------------------------------

/**
 * Version of the checklist's scoring meaning. Shared report links record the
 * version they were created with, and a link whose version differs is shown
 * as "outdated" instead of being re-scored under different rules.
 *
 * MUST be incremented for any scoring-relevant change, including:
 *   - adding, removing, or re-purposing checklist items
 *   - item weights or hard-blocker definitions
 *   - item applicability (product types, `requires` conditions)
 *   - category weights or which categories may be not applicable
 *   - answer points
 *   - category, verdict, or gap-ranking thresholds and rules in `calculate.ts`
 *   - any other scoring logic that changes what an assessment means
 *
 * Do NOT increment it for cosmetic or UI-only changes: rewording labels,
 * descriptions, "why it matters", or action text without changing meaning;
 * reordering how items are displayed; styling.
 *
 * Adding an item also requires appending its id to `SHARE_ITEM_TABLE` in
 * `share.ts` — a test fails until you do.
 *
 * History:
 *   1 — initial 69-item checklist.
 *   2 — per-item `allowNotApplicable` (hard blockers can no longer be
 *       excluded as N/A, except backups); `pb-live-payment-tested` redefined
 *       so in-app purchases can be tested pre-release, metered billing counts,
 *       and no refund is required; `pb-marketplace-payouts` applies only when
 *       the marketplace pays sellers (`paysOutSellers`); the payments question
 *       now covers any money changing hands, including commissions and fees.
 *   3 — account applicability: a `hasUserAccounts` setup answer ("Do people
 *       sign in to use your product?") now controls the six account items
 *       (sign-up, proven auth, account deletion, team invites, roles, data
 *       export) instead of founders marking them N/A. Proven auth and account
 *       deletion no longer allow N/A once they apply. The authorization
 *       blocker deliberately stays on every product.
 *   4 — per-item `allowPartial`. Mobile store approval (`lg-mobile-store-approved`)
 *       no longer has a Partial state: approval is required for a public
 *       launch, so submitted, in review, TestFlight, and internal testing are
 *       all Missing. Previously Partial let a not-yet-approved app reach
 *       "Ready to launch", because a blocker only caps at score 0.
 *   5 — a hard blocker answered Partial now caps the verdict at NOT_READY.
 *       Before, Partial on any blocker never capped: with all ten Partial-able
 *       blockers answered Partial (including exposed secrets and missing
 *       authorization) the result was "Ready to launch". Partial blockers do
 *       not count towards the PROTOTYPE rule, which stays missing-only.
 *       Backups wording now defines Done as automated backups (restore
 *       practice moved to the action).
 */
export const CHECKLIST_VERSION = 5;

/** Maximum lengths for the free-text product fields. */
export const PRODUCT_NAME_MAX_LENGTH = 80;
export const ONE_LINER_MAX_LENGTH = 200;

// -----------------------------------------------------------------------------
// Product types
// -----------------------------------------------------------------------------

export const PRODUCT_TYPES: readonly ProductTypeMeta[] = [
  {
    key: "web",
    label: "Web app",
    description: "A browser-based product or website people sign in to.",
  },
  {
    key: "mobile",
    label: "Mobile app",
    description: "An iOS and/or Android app distributed through the app stores.",
  },
  {
    key: "api",
    label: "API",
    description: "A developer-facing API or SDK.",
  },
  {
    key: "ai",
    label: "AI product",
    description: "A product whose core value comes from an AI model's output.",
  },
  {
    key: "marketplace",
    label: "Marketplace",
    description: "A two-sided product connecting buyers and sellers or providers.",
  },
  {
    key: "saas",
    label: "SaaS",
    description: "A subscription business tool, often used by teams.",
  },
] as const;

// Applicability sets. Kept private so every item's audience reads clearly in
// one place, and a new product type only needs adding here and above.
const ALL: readonly ProductType[] = ["web", "mobile", "api", "ai", "marketplace", "saas"];
/** Products with an end-user interface (everything except a bare API). */
const WITH_UI: readonly ProductType[] = ["web", "mobile", "ai", "marketplace", "saas"];
/** Products delivered in a browser. */
const BROWSER: readonly ProductType[] = ["web", "ai", "marketplace", "saas"];
const MOBILE: readonly ProductType[] = ["mobile"];
const API: readonly ProductType[] = ["api"];
const AI: readonly ProductType[] = ["ai"];
const MARKETPLACE: readonly ProductType[] = ["marketplace"];
const SAAS: readonly ProductType[] = ["saas"];

// -----------------------------------------------------------------------------
// Answers
// -----------------------------------------------------------------------------

/** Points per scored answer. "notApplicable" removes the item from scoring. */
export const ANSWER_SCORES: Readonly<Record<ScoredAnswer, ItemScore>> = {
  missing: 0,
  partial: 1,
  done: 2,
};

/** Highest points a single item can earn. */
export const MAX_ITEM_SCORE: ItemScore = 2;

/** Answer choices in display order, with their user-facing labels. */
export const ANSWER_OPTIONS: readonly {
  readonly value: ChecklistAnswer;
  readonly label: string;
}[] = [
  { value: "missing", label: "Missing" },
  { value: "partial", label: "Partial" },
  { value: "done", label: "Done" },
  { value: "notApplicable", label: "Not applicable" },
] as const;

/**
 * True when this answer may be given for this item. "Not applicable" and
 * "Partial" can each be switched off per item; "Missing" and "Done" are
 * always available.
 */
export function isAnswerAllowed(item: ChecklistItem, answer: ChecklistAnswer): boolean {
  if (answer === "notApplicable") return item.allowNotApplicable;
  if (answer === "partial") return item.allowPartial;
  return true;
}

/**
 * The answer choices to offer for an item, in display order. Omits
 * "Not applicable" or "Partial" when the item does not allow it.
 */
export function answerOptionsFor(item: ChecklistItem): typeof ANSWER_OPTIONS {
  return ANSWER_OPTIONS.filter((o) => isAnswerAllowed(item, o.value));
}

// -----------------------------------------------------------------------------
// Verdicts
// -----------------------------------------------------------------------------

/** Display copy per verdict. Thresholds live in `calculate.ts`. */
export const VERDICTS: Readonly<Record<Verdict, VerdictMeta>> = {
  PROTOTYPE: {
    key: "PROTOTYPE",
    label: "Prototype",
    summary:
      "Core launch foundations are missing. Treat this as a prototype and close the hard blockers first.",
  },
  NOT_READY: {
    key: "NOT_READY",
    label: "Not ready",
    summary:
      "Real progress, but there is a hard blocker or several weak areas to fix before a public launch.",
  },
  LAUNCH_WITH_CAVEATS: {
    key: "LAUNCH_WITH_CAVEATS",
    label: "Launch with caveats",
    summary:
      "No hard blockers. You can launch to a small audience while you close the remaining gaps.",
  },
  READY: {
    key: "READY",
    label: "Ready to launch",
    summary:
      "No hard blockers and every area is in good shape. Pick your launch date.",
  },
};

// -----------------------------------------------------------------------------
// Categories
// -----------------------------------------------------------------------------

/**
 * The eight assessment categories, in brief order.
 * Weights sum to exactly 100.
 */
export const CATEGORIES: readonly ChecklistCategory[] = [
  {
    key: "productPositioning",
    label: "Product & positioning",
    description: "Is it clear who this is for, what it does, and does the core job work?",
    weight: 15,
    order: 0,
    canBeNotApplicable: false,
  },
  {
    key: "onboardingActivation",
    label: "Onboarding & activation",
    description: "Can a new user get from sign-up to real value without help?",
    weight: 15,
    order: 1,
    canBeNotApplicable: false,
  },
  {
    key: "reliabilityQuality",
    label: "Reliability & quality",
    description: "Will it stay up, and will you know quickly when it does not?",
    weight: 15,
    order: 2,
    canBeNotApplicable: false,
  },
  {
    key: "securityAuth",
    label: "Security & auth",
    description: "Are accounts, secrets, and user data protected from the obvious attacks?",
    weight: 15,
    order: 3,
    canBeNotApplicable: false,
  },
  {
    key: "dataPrivacy",
    label: "Data & privacy",
    description: "Do users know what you collect, and can they control it?",
    weight: 10,
    order: 4,
    canBeNotApplicable: false,
  },
  {
    key: "paymentsBilling",
    label: "Payments & billing",
    description: "Can people pay you, and does billing behave correctly when things go wrong?",
    weight: 10,
    order: 5,
    canBeNotApplicable: true,
  },
  {
    key: "analyticsFeedback",
    label: "Analytics & feedback",
    description: "Will you be able to tell whether the launch worked?",
    weight: 10,
    order: 6,
    canBeNotApplicable: false,
  },
  {
    key: "launchGtm",
    label: "Launch readiness & GTM",
    description: "Do you know where the first users come from and who handles launch day?",
    weight: 10,
    order: 7,
    canBeNotApplicable: false,
  },
] as const;

/** Sum of all category weights. Must equal 100. */
export const TOTAL_CATEGORY_WEIGHT: number = CATEGORIES.reduce(
  (sum, c) => sum + c.weight,
  0,
);

// -----------------------------------------------------------------------------
// Checklist items
// -----------------------------------------------------------------------------

/**
 * Every checklist item, grouped by category in brief order.
 *
 * Weight guide:
 *   3 — hard blocker: launching publicly without it exposes users' data or
 *       money, breaks the law, or cannot happen at all (store rejection).
 *       Scoring it "missing" rules out "Ready to launch".
 *   2 — expected for a real launch; missing it costs users or trust.
 *   1 — good practice; worth doing but will not sink the launch.
 */
export const CHECKLIST_ITEMS: readonly ChecklistItem[] = [
  // ---------------------------------------------------------------------------
  // 1. Product & positioning
  // ---------------------------------------------------------------------------
  {
    id: "pp-core-job-works",
    category: "productPositioning",
    label: "The core job works end to end",
    description:
      "A new user can complete the main thing the product promises, in production, without help or workarounds.",
    whyItMatters:
      "Launch traffic arrives once. If the core flow breaks, those first users rarely come back.",
    action:
      "Run the core flow in production as a brand-new user and fix anything that needs help or a workaround.",
    weight: 3,
    hardBlocker: true,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "pp-value-proposition",
    category: "productPositioning",
    label: "Who it is for and what it does fits in one sentence",
    description:
      "You have named one specific target user (not \"everyone\") and can say what the product does for them in one plain sentence.",
    whyItMatters:
      "Visitors decide in seconds, and a specific audience tells you which channels to launch in.",
    action:
      "Write one sentence naming your target user and what the product does for them, and put it above the fold.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "pp-public-page",
    category: "productPositioning",
    label: "A public page explains the product and its price",
    description:
      "A landing page or docs home on your own domain says what it does, who it is for, what it costs (or that it is free), and how to start.",
    whyItMatters:
      "Every launch post needs somewhere to send people, and hidden pricing stalls sign-ups.",
    action:
      "Publish a page on your own domain that says what the product does, who it is for, what it costs, and how to start.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "pp-scope-trimmed",
    category: "productPositioning",
    label: "Unfinished features are hidden or removed",
    description:
      "Half-built screens, dead links, and \"coming soon\" placeholders are out of the launch build.",
    whyItMatters:
      "Broken edges make the whole product feel unreliable, even when the core works.",
    action:
      "Hide or remove half-built screens, dead links, and \"coming soon\" placeholders from the launch build.",
    weight: 1,
    applicableProductTypes: WITH_UI,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "pp-store-listing-complete",
    category: "productPositioning",
    label: "The app store listing is complete",
    description:
      "Name, subtitle, description, keywords, screenshots for required device sizes, and support URL are filled in for each store.",
    whyItMatters:
      "The listing is the landing page for mobile. Incomplete listings convert poorly and can block submission.",
    action:
      "Fill in every store listing field, including screenshots for each required device size and a support URL.",
    weight: 2,
    applicableProductTypes: MOBILE,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "pp-ai-limits-stated",
    category: "productPositioning",
    label: "What the AI can and cannot do is stated",
    description:
      "The product explains what the AI is good at, where it can be wrong, and that outputs should be checked.",
    whyItMatters:
      "Clear limits set expectations and reduce churn and complaints when the model gets something wrong.",
    action:
      "Add a short note in the product on what the AI does well, where it can be wrong, and that outputs need checking.",
    weight: 2,
    applicableProductTypes: AI,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "pp-marketplace-both-sides",
    category: "productPositioning",
    label: "The value is clear for both sides",
    description:
      "Buyers and sellers each have a clear reason to join, with messaging aimed at each side.",
    whyItMatters:
      "A marketplace only works if both sides show up; positioning for one side alone stalls the other.",
    action:
      "Write a separate value message for buyers and for sellers, and show each side its own.",
    weight: 2,
    applicableProductTypes: MARKETPLACE,
    allowNotApplicable: false,
    allowPartial: true,
  },

  // ---------------------------------------------------------------------------
  // 2. Onboarding & activation
  // ---------------------------------------------------------------------------
  {
    id: "oa-signup-fast",
    category: "onboardingActivation",
    label: "Sign-up takes under two minutes",
    description:
      "A new user can create an account and reach the product in under two minutes, with no manual approval.",
    whyItMatters:
      "Every extra step in sign-up loses a share of launch-day visitors you will not get back.",
    action:
      "Time a fresh sign-up and cut steps until it takes under two minutes with no manual approval.",
    weight: 2,
    applicableProductTypes: WITH_UI,
    requires: "hasUserAccounts",
    allowNotApplicable: true,
    allowPartial: true,
  },
  {
    id: "oa-first-run-guided",
    category: "onboardingActivation",
    label: "The first run leads new users to value",
    description:
      "A new user is guided towards the activation moment on their first visit, and empty screens explain what goes there and how to fill them.",
    whyItMatters:
      "Users who do not reach value in the first session mostly never return, and blank screens look broken.",
    action:
      "Guide new users to the activation moment and give every empty screen a clear next step.",
    weight: 2,
    applicableProductTypes: WITH_UI,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "oa-help-contact",
    category: "onboardingActivation",
    label: "Users can reach you for help",
    description:
      "A visible support email, chat, or community link is available from inside the product or docs.",
    whyItMatters:
      "Stuck early users who cannot ask for help simply leave — and you never learn why.",
    action:
      "Add a visible support email, chat, or community link inside the product or docs.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "oa-api-reference-docs",
    category: "onboardingActivation",
    label: "API reference documentation is published",
    description:
      "Every public endpoint is documented with parameters, responses, errors, and authentication.",
    whyItMatters:
      "For an API the docs are the only interface. Without them no outside developer can integrate, so there is nothing to launch.",
    action:
      "Publish reference docs for every public endpoint, covering parameters, responses, errors, and authentication.",
    weight: 3,
    hardBlocker: true,
    applicableProductTypes: API,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "oa-api-quickstart",
    category: "onboardingActivation",
    label: "A quickstart gets to a first successful call",
    description:
      "A copy-paste quickstart takes a developer from sign-up to a working request in under ten minutes.",
    whyItMatters:
      "Time to first successful call is the API equivalent of activation.",
    action:
      "Write a copy-paste quickstart that gets a new developer to a working request in under ten minutes.",
    weight: 2,
    applicableProductTypes: API,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "oa-mobile-permission-priming",
    category: "onboardingActivation",
    label: "Permission prompts are explained first",
    description:
      "Before the system asks for notifications, location, camera, or contacts, the app explains why it needs them.",
    whyItMatters:
      "Unexplained permission prompts get denied, and a denied permission is hard to win back.",
    action:
      "Add a short explanation screen before each system permission prompt.",
    weight: 1,
    applicableProductTypes: MOBILE,
    allowNotApplicable: true,
    allowPartial: true,
  },
  {
    id: "oa-ai-example-inputs",
    category: "onboardingActivation",
    label: "Example inputs show users what to try",
    description:
      "Suggested prompts, templates, or sample files let a new user see a good result on the first try.",
    whyItMatters:
      "A blank prompt box is intimidating; a good first output is what converts a visitor.",
    action:
      "Add example prompts, templates, or sample files that produce a good result on the first try.",
    weight: 1,
    applicableProductTypes: AI,
    allowNotApplicable: true,
    allowPartial: true,
  },
  {
    id: "oa-marketplace-supply-seeded",
    category: "onboardingActivation",
    label: "Enough supply is live before buyers arrive",
    description:
      "The supply side (listings, sellers, providers) is populated so the first buyers find something worth using.",
    whyItMatters:
      "An empty marketplace fails its first visitors on both sides and is hard to relaunch.",
    action:
      "Recruit and list enough supply that the first buyers find something worth using.",
    weight: 2,
    applicableProductTypes: MARKETPLACE,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "oa-saas-team-invites",
    category: "onboardingActivation",
    label: "Users can invite teammates",
    description:
      "An account owner can invite colleagues who land in the same workspace.",
    whyItMatters:
      "Team adoption is how SaaS products stick and expand inside a company.",
    action:
      "Let account owners invite teammates into the same workspace.",
    weight: 1,
    applicableProductTypes: SAAS,
    requires: "hasUserAccounts",
    allowNotApplicable: true,
    allowPartial: true,
  },

  // ---------------------------------------------------------------------------
  // 3. Reliability & quality
  // ---------------------------------------------------------------------------
  {
    id: "rq-backups-enabled",
    category: "reliabilityQuality",
    label: "Production data is backed up",
    description:
      "Done means automated backups are enabled for your production database and stored user files. Partial means backups are manual or only cover some of your data. Answer \"Not applicable\" if you store no user data.",
    whyItMatters:
      "Without backups, one bad migration or deletion permanently destroys every user's data — a loss you cannot undo or apologise away.",
    action:
      "Turn on automated backups for your production database and stored user files, then practise one restore so you know it works.",
    weight: 3,
    hardBlocker: true,
    applicableProductTypes: ALL,
    allowNotApplicable: true,
    allowPartial: true,
  },
  {
    id: "rq-separate-environments",
    category: "reliabilityQuality",
    label: "Production is separate from development",
    description:
      "Production has its own database, keys, and deployment; you never test against real user data.",
    whyItMatters:
      "Shared environments are how test data leaks to users and experiments corrupt real users' data.",
    action:
      "Give production its own database, keys, and deployment, separate from development.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "rq-monitoring-alerts",
    category: "reliabilityQuality",
    label: "Errors, crashes, and downtime alert someone",
    description:
      "Production errors (and app crashes, for mobile) go to a monitoring tool, and an uptime check alerts a person when the product is down.",
    whyItMatters:
      "Most launch-day bugs are never reported — users just leave. You should hear about outages before they are posted publicly.",
    action:
      "Connect error monitoring and an uptime check that alerts a named person.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "rq-critical-path-tests",
    category: "reliabilityQuality",
    label: "Critical paths have automated tests",
    description:
      "The core job, plus sign-up and payment (if any), are covered by tests that run before every deploy.",
    whyItMatters:
      "Launch week brings rapid fixes; tests stop each fix from breaking the flows that matter most.",
    action:
      "Add automated tests for the core job, plus sign-up and payment if you have them, and run them before every deploy.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "rq-rollback-ready",
    category: "reliabilityQuality",
    label: "A bad deploy can be rolled back quickly",
    description:
      "You know the exact steps to return to the previous working version in minutes.",
    whyItMatters:
      "When a launch-day deploy breaks something, recovery speed matters more than the fix.",
    action:
      "Write down and rehearse the steps to roll back to the previous deploy.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "rq-core-screens-fast",
    category: "reliabilityQuality",
    label: "Core screens load quickly on a mid-range phone",
    description:
      "The landing page and core screens are usable within a few seconds on a mid-range phone and mobile network.",
    whyItMatters:
      "Much launch traffic comes from social links opened on phones; slow pages lose it.",
    action:
      "Test the landing page and core screens on a mid-range phone and fix anything slow.",
    weight: 1,
    applicableProductTypes: WITH_UI,
    allowNotApplicable: true,
    allowPartial: true,
  },
  {
    id: "rq-mobile-real-devices",
    category: "reliabilityQuality",
    label: "Tested on real iOS and Android devices",
    description:
      "The release build has been used on physical devices for each platform you ship, including an older model.",
    whyItMatters:
      "Simulators miss performance, permission, and layout problems that real devices expose.",
    action:
      "Install the release build on real iOS and Android devices, including an older model, and fix what breaks.",
    weight: 2,
    applicableProductTypes: MOBILE,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "rq-api-versioning",
    category: "reliabilityQuality",
    label: "The API is versioned",
    description:
      "Endpoints carry a version, and you have a policy for deprecating old versions.",
    whyItMatters:
      "Integrations break silently when an unversioned API changes underneath them.",
    action:
      "Add a version to your endpoints and publish a deprecation policy.",
    weight: 2,
    applicableProductTypes: API,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "rq-ai-failure-handling",
    category: "reliabilityQuality",
    label: "AI failures and timeouts are handled",
    description:
      "Provider errors, rate limits, and slow responses show a clear message and retry path instead of hanging or crashing.",
    whyItMatters:
      "Model providers have outages; your product should degrade gracefully, not break.",
    action:
      "Handle provider errors, rate limits, and timeouts with a clear message and a retry option.",
    weight: 2,
    applicableProductTypes: AI,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "rq-ai-output-evaluated",
    category: "reliabilityQuality",
    label: "AI output quality is checked against test cases",
    description:
      "A fixed set of representative inputs is run and reviewed whenever prompts or models change.",
    whyItMatters:
      "Prompt and model changes can quietly make outputs worse; test cases catch it before users do.",
    action:
      "Build a small set of representative test inputs and review the outputs whenever prompts or models change.",
    weight: 2,
    applicableProductTypes: AI,
    allowNotApplicable: false,
    allowPartial: true,
  },

  // ---------------------------------------------------------------------------
  // 4. Security & auth
  // ---------------------------------------------------------------------------
  {
    id: "sa-https-everywhere",
    category: "securityAuth",
    label: "All traffic uses HTTPS",
    description:
      "Every page, API endpoint, and callback is served over HTTPS, and HTTP redirects to HTTPS.",
    whyItMatters:
      "Plain HTTP sends passwords and session tokens readable to anyone on the network, and browsers warn users away.",
    action:
      "Serve every page, endpoint, and callback over HTTPS and redirect HTTP to HTTPS.",
    weight: 3,
    hardBlocker: true,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "sa-no-exposed-secrets",
    category: "securityAuth",
    label: "No secrets are exposed",
    description:
      "API keys, database credentials, and private tokens are not in the repository, client bundle, or app binary.",
    whyItMatters:
      "Leaked keys are found by bots within hours and give attackers direct access to your data and billing.",
    action:
      "Move every secret out of the repo, client bundle, and app binary, and rotate any that were exposed.",
    weight: 3,
    hardBlocker: true,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "sa-authorization-enforced",
    category: "securityAuth",
    label: "Users can only access their own data",
    description:
      "Data that belongs to a specific person or customer — their records, uploads, generated content, or anything reached by an ID or link — can only be read or changed by its owner. The server checks each request against who is asking (signed-in user, API key, or an unguessable owner token); hiding it in the UI is not enough. This applies even without accounts if you store anything per person. If your product stores nothing specific to anyone, answer Done.",
    whyItMatters:
      "The risk is about stored data, not whether you have accounts: without server-side checks, anyone can read or change someone else's data by editing an ID or guessing a link.",
    action:
      "Add server-side checks so every read and write of per-person data is limited to its owner — by signed-in user, API key, or an unguessable owner token.",
    weight: 3,
    hardBlocker: true,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "sa-proven-auth",
    category: "securityAuth",
    label: "Sign-in uses a proven provider or library",
    description:
      "Sign-in and account recovery use an established auth provider or library — whether you offer email and password, magic links, Google or Apple login, or SSO — rather than hand-rolled login or session code. A locked-out user can get back in through your recovery path: a password reset, a fresh magic link, or their login provider.",
    whyItMatters:
      "Custom sign-in code is where subtle vulnerabilities hide, and a broken recovery flow locks real users out.",
    action:
      "Use an established auth provider or library for sign-in, and test account recovery end to end for every sign-in method you offer.",
    weight: 2,
    applicableProductTypes: ALL,
    // The share decoder derives `hasUserAccounts` from this item's slot. Keep
    // it on every product type and controlled only by this condition — a test
    // in share.test.ts pins both.
    requires: "hasUserAccounts",
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "sa-rate-limiting",
    category: "securityAuth",
    label: "Sign-in and public endpoints are rate limited",
    description:
      "Login, sign-up, password reset, and expensive public endpoints limit repeated requests.",
    whyItMatters:
      "Launch attention also brings credential stuffing, spam sign-ups, and runaway costs.",
    action:
      "Add rate limits to login, sign-up, password reset, and expensive public endpoints.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: true,
    allowPartial: true,
  },
  {
    id: "sa-dependency-scanning",
    category: "securityAuth",
    label: "Dependencies are scanned for known vulnerabilities",
    description:
      "Automated scanning (for example, Dependabot) flags vulnerable packages, and critical ones are patched.",
    whyItMatters:
      "Most real-world breaches exploit known, already-fixed vulnerabilities.",
    action:
      "Turn on automated dependency scanning and patch critical vulnerabilities.",
    weight: 1,
    applicableProductTypes: ALL,
    allowNotApplicable: true,
    allowPartial: true,
  },
  {
    id: "sa-api-key-management",
    category: "securityAuth",
    label: "API keys can be created, rotated, and revoked",
    description:
      "Developers can manage their own keys, and a leaked key can be revoked without affecting others.",
    whyItMatters:
      "Customers will leak keys; they need a safe way to recover without contacting you.",
    action:
      "Let developers create, rotate, and revoke their own API keys.",
    weight: 2,
    applicableProductTypes: API,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "sa-ai-prompt-injection",
    category: "securityAuth",
    label: "Prompt injection and data leakage are mitigated",
    description:
      "User input cannot override system instructions to reveal other users' data or hidden prompts, or trigger unsafe tool calls.",
    whyItMatters:
      "Prompt injection is the most common way AI features leak data or get abused.",
    action:
      "Try prompt-injection attacks against the product and block any that reveal hidden prompts or other users' data, or trigger unsafe tools.",
    weight: 2,
    applicableProductTypes: AI,
    allowNotApplicable: true,
    allowPartial: true,
  },
  {
    id: "sa-ai-usage-limits",
    category: "securityAuth",
    label: "AI usage is capped per user or visitor",
    description:
      "Limits per user or plan — and, for anyone using the product without signing in, per IP address or session — stop a single person from running up unbounded model costs. Products without accounts need this most.",
    whyItMatters:
      "One abusive account or anonymous visitor can burn through your model budget in a day.",
    action:
      "Add limits on AI usage per user or plan, plus per IP address or session for anyone who isn't signed in.",
    weight: 2,
    applicableProductTypes: AI,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "sa-marketplace-report-block",
    category: "securityAuth",
    label: "Users can report and block other users",
    description:
      "Either side can report a listing or user and block contact, and reports reach someone who acts on them.",
    whyItMatters:
      "Trust and safety problems appear with the first real users and damage both sides of the market.",
    action:
      "Add report and block controls, and route reports to someone who acts on them.",
    weight: 2,
    applicableProductTypes: MARKETPLACE,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "sa-saas-roles",
    category: "securityAuth",
    label: "Team roles and permissions are enforced",
    description:
      "Workspace roles (for example: owner, admin, member) limit who can change billing, settings, and data.",
    whyItMatters:
      "Business buyers expect roles; without them one member can break things for the whole team.",
    action:
      "Add workspace roles that limit who can change billing, settings, and data.",
    weight: 2,
    applicableProductTypes: SAAS,
    requires: "hasUserAccounts",
    allowNotApplicable: true,
    allowPartial: true,
  },

  // ---------------------------------------------------------------------------
  // 5. Data & privacy
  // ---------------------------------------------------------------------------
  {
    id: "dp-privacy-policy",
    category: "dataPrivacy",
    label: "A privacy policy is published",
    description:
      "A privacy policy that matches what you actually collect, and names the kinds of third parties that receive data, is linked from the footer and from sign-up, if you have one (and the store listing, for mobile).",
    whyItMatters:
      "Collecting personal data without one breaks privacy law in most markets (UK/EU GDPR, California), and the app stores and payment providers require it.",
    action:
      "Publish a privacy policy that matches what you collect, and link it from the footer, sign-up (if you have one), and any store listing.",
    weight: 3,
    hardBlocker: true,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "dp-terms-of-service",
    category: "dataPrivacy",
    label: "Terms of service are published",
    description:
      "Terms covering acceptable use, liability, and termination are published and linked from the footer and from sign-up, if you have one.",
    whyItMatters:
      "Terms protect you when a user misuses the product or disputes a charge.",
    action:
      "Publish terms of service and link them from the footer and sign-up (if you have one).",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "dp-data-inventory",
    category: "dataPrivacy",
    label: "You know what personal data you collect and who else receives it",
    description:
      "You have a short list of the personal data you store, why, where it lives, and which third-party services (hosting, analytics, email, AI) receive it.",
    whyItMatters:
      "You cannot write an honest privacy policy, fill in store privacy forms, or answer a deletion request without it.",
    action:
      "List the personal data you store, why, where it lives, and which third parties receive it.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "dp-account-deletion",
    category: "dataPrivacy",
    label: "Users can delete their account and data",
    description:
      "A user can request or trigger deletion of their account and personal data, and it actually happens.",
    whyItMatters:
      "Privacy laws give users this right, and Apple requires in-app account deletion for apps that offer sign-up.",
    action:
      "Add a way for users to delete their account and personal data, and confirm the deletion actually happens.",
    weight: 2,
    applicableProductTypes: ALL,
    requires: "hasUserAccounts",
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "dp-cookie-consent",
    category: "dataPrivacy",
    label: "Cookie consent is handled where required",
    description:
      "Non-essential cookies and trackers load only after consent for visitors in regions that require it.",
    whyItMatters:
      "Loading trackers without consent breaks UK/EU rules and undermines trust.",
    action:
      "Load non-essential cookies and trackers only after consent where the law requires it.",
    weight: 1,
    applicableProductTypes: BROWSER,
    allowNotApplicable: true,
    allowPartial: true,
  },
  {
    id: "dp-mobile-privacy-labels",
    category: "dataPrivacy",
    label: "App store privacy labels are accurate",
    description:
      "App Store privacy details and Google Play data safety forms match what the app and its SDKs collect.",
    whyItMatters:
      "Inaccurate labels can get the app pulled after launch and damage trust with privacy-conscious users.",
    action:
      "Update the App Store privacy details and Google Play data safety form to match the app and its SDKs.",
    weight: 2,
    applicableProductTypes: MOBILE,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "dp-ai-data-use-disclosed",
    category: "dataPrivacy",
    label: "Users know how their data is used with AI",
    description:
      "You state which AI providers receive user input and whether it is stored or used for training.",
    whyItMatters:
      "\"Is my data used to train the model?\" is the first question careful users and businesses ask.",
    action:
      "State which AI providers receive user input and whether it is stored or used for training.",
    weight: 2,
    applicableProductTypes: AI,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "dp-saas-data-export",
    category: "dataPrivacy",
    label: "Users can export their data",
    description:
      "An account owner can export their workspace data in a standard format such as CSV or JSON.",
    whyItMatters:
      "Business buyers check for export before committing, and some privacy laws require portability.",
    action:
      "Add a CSV or JSON export of workspace data.",
    weight: 1,
    applicableProductTypes: SAAS,
    requires: "hasUserAccounts",
    allowNotApplicable: true,
    allowPartial: true,
  },

  // ---------------------------------------------------------------------------
  // 6. Payments & billing (whole category excluded when the product is free)
  // ---------------------------------------------------------------------------
  {
    id: "pb-live-payment-tested",
    category: "paymentsBilling",
    label: "Paying works end to end with your real payment setup",
    description:
      "A payment has gone through the same payment setup your customers will use, and it correctly gave access to what was paid for. What counts depends on how you charge: for card or subscription checkout, one successful payment in live mode (not test mode); for in-app purchases, one purchase through TestFlight or Google Play internal testing — you don't need to be publicly released yet; for usage-based or invoiced billing, one real charge or invoice created from actual usage.",
    whyItMatters:
      "If the payment flow you launch with is broken, you either can't take money at all or you charge people without giving them what they paid for. Test setups can hide problems that only show up with your real configuration.",
    action:
      "Make one payment through the flow your customers will use — live-mode checkout, a TestFlight or internal-testing in-app purchase, or a real usage charge or invoice — and check it unlocks access. If you paid with your own money, refund it afterwards.",
    weight: 3,
    hardBlocker: true,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "pb-webhooks-verified",
    category: "paymentsBilling",
    label: "Payment webhooks are verified and safe to retry",
    description:
      "Webhook signatures are checked, and repeated events do not grant access or charge twice.",
    whyItMatters:
      "Unverified webhooks let attackers fake payments; non-idempotent handlers double-process events.",
    action:
      "Verify webhook signatures and make handlers safe to receive the same event twice.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: true,
    allowPartial: true,
  },
  {
    id: "pb-failed-payments-handled",
    category: "paymentsBilling",
    label: "Failed payments and cancellations are handled",
    description:
      "Declined cards, expired cards, and cancellations update access correctly and notify the user.",
    whyItMatters:
      "Unhandled failures either give away the product for free or lock out paying customers.",
    action:
      "Handle declined cards, expired cards, and cancellations so access and notifications update correctly.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: true,
    allowPartial: true,
  },
  {
    id: "pb-receipts-tax-refunds",
    category: "paymentsBilling",
    label: "Receipts, sales tax, and refunds are handled",
    description:
      "Customers get receipts or invoices, VAT or sales tax is collected where required, and a refund policy is published before purchase.",
    whyItMatters:
      "Missing tax handling becomes a liability that grows with every sale, and an unclear refund policy invites chargebacks.",
    action:
      "Send receipts, collect VAT or sales tax where required, and publish a refund policy.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "pb-mobile-in-app-purchase",
    category: "paymentsBilling",
    label: "In-app purchases follow store rules",
    description:
      "Digital goods and subscriptions sold in the app use the store's in-app purchase system where required, and restore purchases works. Only shown when the app sells digital goods or subscriptions — physical goods and real-world services are exempt.",
    whyItMatters:
      "Apple and Google reject apps that sell digital goods outside their billing rules, so the app cannot be released.",
    action:
      "Sell in-app digital goods and subscriptions through the store's billing system, and add restore purchases.",
    weight: 3,
    hardBlocker: true,
    applicableProductTypes: MOBILE,
    allowNotApplicable: false,
    allowPartial: true,
    requires: "sellsDigitalGoodsInApp",
  },
  {
    id: "pb-api-usage-metering",
    category: "paymentsBilling",
    label: "Usage is metered and matches what you bill",
    description:
      "Request or unit counts per key are recorded and reconcile with invoices, and customers can see their usage.",
    whyItMatters:
      "Billing that customers cannot verify leads to disputes and churn.",
    action:
      "Record usage per key, reconcile it with invoices, and show customers their usage.",
    weight: 2,
    applicableProductTypes: API,
    allowNotApplicable: true,
    allowPartial: true,
  },
  {
    id: "pb-marketplace-payouts",
    category: "paymentsBilling",
    label: "Seller payouts are set up and tested",
    description:
      "Sellers are onboarded to a payout provider that handles identity checks, and a real payout has reached a seller's account. Only shown when your marketplace pays sellers or providers — not for listing-fee, subscription, or lead-generation marketplaces.",
    whyItMatters:
      "Taking buyers' money without a working, compliant way to pay sellers means holding other people's funds — a legal and trust failure.",
    action:
      "Onboard sellers to a payout provider with identity checks and complete one real payout.",
    weight: 3,
    hardBlocker: true,
    applicableProductTypes: MARKETPLACE,
    allowNotApplicable: false,
    allowPartial: true,
    requires: "paysOutSellers",
  },
  {
    id: "pb-saas-self-serve-plans",
    category: "paymentsBilling",
    label: "Customers can change or cancel plans themselves",
    description:
      "Upgrades, downgrades, and cancellations work from a billing page without contacting you.",
    whyItMatters:
      "Hard cancellation causes chargebacks and complaints; hard upgrades lose revenue.",
    action:
      "Add a billing page where customers can upgrade, downgrade, and cancel themselves.",
    weight: 2,
    applicableProductTypes: SAAS,
    allowNotApplicable: true,
    allowPartial: true,
  },

  // ---------------------------------------------------------------------------
  // 7. Analytics & feedback
  // ---------------------------------------------------------------------------
  {
    id: "af-activation-tracked",
    category: "analyticsFeedback",
    label: "Activation is defined and key events are tracked",
    description:
      "You have named the action that means a new user got value, and the key events — first visit or sign-up (if you have one), activation, and core-job completion — are recorded so you can see the activation rate.",
    whyItMatters:
      "Activation rate is the clearest early signal of whether launch visitors became real users.",
    action:
      "Define your activation moment and track first-visit or sign-up, activation, and core-job events.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "af-traffic-sources",
    category: "analyticsFeedback",
    label: "Traffic sources are tracked",
    description:
      "Launch links carry UTM tags or equivalent, so you can see which channel brought which users.",
    whyItMatters:
      "You need to know which launch channel worked before you invest in it again.",
    action:
      "Add UTM tags to every launch link.",
    weight: 1,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "af-feedback-channel",
    category: "analyticsFeedback",
    label: "Users can send feedback from the product",
    description:
      "A feedback link, form, or widget is one click away inside the product or docs.",
    whyItMatters:
      "Launch week is when users are most willing to tell you what is wrong.",
    action:
      "Add a one-click feedback link or form inside the product or docs.",
    weight: 1,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "af-metrics-review",
    category: "analyticsFeedback",
    label: "A post-launch metrics review is scheduled",
    description:
      "A date is booked to review new users (or sign-ups, if you have accounts), activation, and feedback after launch, with named attendees.",
    whyItMatters:
      "Without a scheduled review, launch data gets collected and never acted on.",
    action:
      "Book a post-launch review of new users or sign-ups, activation, and feedback with named attendees.",
    weight: 1,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "af-ai-output-rating",
    category: "analyticsFeedback",
    label: "Users can rate AI outputs",
    description:
      "A thumbs up/down or similar control on AI output records quality signals you review.",
    whyItMatters:
      "Output ratings are the cheapest way to find where the model fails real users.",
    action:
      "Add a thumbs up/down control on AI outputs and review the results weekly.",
    weight: 1,
    applicableProductTypes: AI,
    allowNotApplicable: true,
    allowPartial: true,
  },
  {
    id: "af-api-usage-visibility",
    category: "analyticsFeedback",
    label: "API usage and errors per customer are visible",
    description:
      "You can see request volume and error rate per API key or customer.",
    whyItMatters:
      "Rising errors for one customer usually mean a broken integration you can fix before they churn.",
    action:
      "Build a view of request volume and error rate per API key or customer.",
    weight: 1,
    applicableProductTypes: API,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "af-mobile-store-reviews",
    category: "analyticsFeedback",
    label: "Store ratings and reviews are monitored",
    description:
      "Someone checks and replies to App Store and Google Play reviews during launch week.",
    whyItMatters:
      "Early reviews set the store rating that every later visitor sees.",
    action:
      "Assign someone to check and reply to store reviews during launch week.",
    weight: 1,
    applicableProductTypes: MOBILE,
    allowNotApplicable: false,
    allowPartial: true,
  },

  // ---------------------------------------------------------------------------
  // 8. Launch readiness & GTM
  // ---------------------------------------------------------------------------
  {
    id: "lg-launch-channels-chosen",
    category: "launchGtm",
    label: "Launch channels are chosen",
    description:
      "You have picked the two or three places your target users already gather and planned what to post in each.",
    whyItMatters:
      "Launching everywhere at once spreads effort thin; focused channels bring the right first users.",
    action:
      "Pick two or three channels where your target users gather and plan a post for each.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "lg-launch-assets-ready",
    category: "launchGtm",
    label: "Launch assets are ready",
    description:
      "The launch post, screenshots or demo video, and a short product description are written and reviewed.",
    whyItMatters:
      "Scrambling for assets on launch day delays the launch and weakens every post.",
    action:
      "Write and review the launch post, screenshots or demo video, and a short product description.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "lg-external-users-tried",
    category: "launchGtm",
    label: "People outside the team have used it",
    description:
      "At least five people from the target audience have used the product unaided, and their feedback is addressed.",
    whyItMatters:
      "Outside users find the confusing steps and bugs the team no longer notices.",
    action:
      "Get five people from your target audience to use the product unaided, and fix what they trip on.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "lg-launch-day-owner",
    category: "launchGtm",
    label: "Someone owns launch-day support and incidents",
    description:
      "A named person watches support, errors, and social replies on launch day and can ship a fix.",
    whyItMatters:
      "Fast responses on launch day turn problems into goodwill instead of public complaints.",
    action:
      "Name the person who watches support, errors, and social replies on launch day.",
    weight: 2,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "lg-contact-early-users",
    category: "launchGtm",
    label: "You can email early users and your waitlist",
    description:
      "Sign-ups and waitlist contacts are collected with consent in a tool you can send from.",
    whyItMatters:
      "Your earliest supporters are the easiest people to bring back after each improvement.",
    action:
      "Collect sign-ups and waitlist contacts with consent in a tool you can email from.",
    weight: 1,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "lg-name-trademark-checked",
    category: "launchGtm",
    label: "The product name is checked for conflicts",
    description:
      "A basic trademark and app-store search shows no established product in your space with the same name.",
    whyItMatters:
      "A forced rename after launch throws away the attention the launch earned.",
    action:
      "Search trademarks and app stores for products in your space with the same name.",
    weight: 1,
    applicableProductTypes: ALL,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "lg-seo-social-previews",
    category: "launchGtm",
    label: "Page titles, descriptions, and social previews are set",
    description:
      "Public pages have unique titles and meta descriptions, and shared links show a proper preview image.",
    whyItMatters:
      "Launch links are shared on social media; a blank preview gets far fewer clicks.",
    action:
      "Set unique titles, meta descriptions, and social preview images for public pages.",
    weight: 1,
    applicableProductTypes: BROWSER,
    allowNotApplicable: false,
    allowPartial: true,
  },
  {
    id: "lg-mobile-store-approved",
    category: "launchGtm",
    label: "The app has passed store review",
    description:
      "Done means the launch build is approved on each public store you are launching on and is ready to release. Anything short of that is Missing: not yet submitted, submitted and waiting, in review, or available only through TestFlight or internal testing.",
    whyItMatters:
      "Until the store approves the app, the public cannot install it — so there is nothing to launch yet, however finished the build is.",
    action:
      "Submit the launch build for store review early enough to be approved before launch day.",
    weight: 3,
    hardBlocker: true,
    applicableProductTypes: MOBILE,
    allowNotApplicable: false,
    allowPartial: false,
  },
  {
    id: "lg-changelog-status-page",
    category: "launchGtm",
    label: "A public changelog or status page exists",
    description:
      "Customers can see recent changes and current service status without asking you.",
    whyItMatters:
      "Developers and business customers check this before trusting you with their workflows.",
    action:
      "Publish a public changelog or status page.",
    weight: 1,
    applicableProductTypes: ["api", "saas"],
    allowNotApplicable: false,
    allowPartial: true,
  },
] as const;

// -----------------------------------------------------------------------------
// Lookups
// -----------------------------------------------------------------------------

/** Look up a category by key. Throws if the key is unknown. */
export function getCategory(key: CategoryKey): ChecklistCategory {
  const found = CATEGORIES.find((c) => c.key === key);
  if (!found) {
    throw new Error(`getCategory: unknown category key "${key}"`);
  }
  return found;
}

/** Look up a checklist item by id. Returns undefined for unknown ids. */
export function getItemById(id: string): ChecklistItem | undefined {
  return CHECKLIST_ITEMS.find((item) => item.id === id);
}

/**
 * True when the item belongs in the checklist for this product: at least one
 * selected product type matches, its category is not switched off, and any
 * extra `requires` condition holds. An empty `productTypes` list matches nothing.
 */
export function isItemApplicable(
  item: ChecklistItem,
  context: ApplicabilityContext,
): boolean {
  if (!context.paymentsApplicable && item.category === "paymentsBilling") {
    return false;
  }
  if (item.requires !== undefined && context[item.requires] !== true) {
    return false;
  }
  return context.productTypes.some((t) =>
    item.applicableProductTypes.includes(t),
  );
}

/**
 * Items shown for a product, in catalogue order. Individual items can still
 * be answered "notApplicable" by the user after this filter.
 */
export function getApplicableItems(
  context: ApplicabilityContext,
): ChecklistItem[] {
  return CHECKLIST_ITEMS.filter((item) => isItemApplicable(item, context));
}
