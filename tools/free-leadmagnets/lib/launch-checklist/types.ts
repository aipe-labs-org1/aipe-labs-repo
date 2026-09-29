/**
 * Type definitions for the Founder Launch Checklist domain model.
 *
 * Shared between the checklist catalogue, the (upcoming) pure scoring engine,
 * and the React UI. Nothing in this file imports React or any browser API —
 * it must remain safe to consume in Node.
 */

// -----------------------------------------------------------------------------
// Product profile
// -----------------------------------------------------------------------------

/** The kind of product being assessed. Drives which checklist items apply. */
export type ProductType =
  | "web"
  | "mobile"
  | "api"
  | "ai"
  | "marketplace"
  | "saas";

/** Display metadata for a product type option. */
export interface ProductTypeMeta {
  readonly key: ProductType;
  readonly label: string;
  readonly description: string;
}

/** Free-text details plus product types, entered before the checklist. */
export interface ProductProfile {
  name: string;
  oneLiner: string;
  /**
   * Every type that describes the product (for example AI + SaaS). An item is
   * applicable when any selected type matches it. At least one is required;
   * the scoring engine rejects an empty list.
   */
  productTypes: readonly ProductType[];
}

// -----------------------------------------------------------------------------
// Categories
// -----------------------------------------------------------------------------

/** Stable identifier for each assessment category, in brief order. */
export type CategoryKey =
  | "productPositioning"
  | "onboardingActivation"
  | "reliabilityQuality"
  | "securityAuth"
  | "dataPrivacy"
  | "paymentsBilling"
  | "analyticsFeedback"
  | "launchGtm";

/** Metadata for one assessment category. */
export interface ChecklistCategory {
  readonly key: CategoryKey;
  readonly label: string;
  readonly description: string;
  /**
   * Share of the overall score, out of 100 across all categories. When a
   * category is not applicable its weight is redistributed across the rest.
   */
  readonly weight: number;
  /** Zero-based position in the brief; the deterministic tie-break axis. */
  readonly order: number;
  /** True only for categories the user can mark as not applicable as a whole. */
  readonly canBeNotApplicable: boolean;
}

// -----------------------------------------------------------------------------
// Items and answers
// -----------------------------------------------------------------------------

/** Importance of a single checklist item. Weight 3 means hard blocker. */
export type ItemWeight = 1 | 2 | 3;

/** Points an answered, applicable item earns: missing 0, partial 1, done 2. */
export type ItemScore = 0 | 1 | 2;

/** The four answers a user can give for a checklist item. */
export type ChecklistAnswer = "missing" | "partial" | "done" | "notApplicable";

/** Answers that carry points — everything except "notApplicable". */
export type ScoredAnswer = Exclude<ChecklistAnswer, "notApplicable">;

/**
 * Extra yes/no facts about the product that narrow applicability beyond
 * product type. Each value names a boolean flag on `ApplicabilityContext`.
 */
export type ApplicabilityCondition =
  | "sellsDigitalGoodsInApp"
  | "paysOutSellers"
  | "hasUserAccounts";

interface ChecklistItemBase {
  /** Stable, kebab-case id prefixed by category. Used as the answers key. */
  readonly id: string;
  readonly category: CategoryKey;
  /** Short statement of the launch-ready state, phrased so "Done" reads naturally. */
  readonly label: string;
  /** What "done" looks like in practice. */
  readonly description: string;
  /** Why skipping this hurts a launch. */
  readonly whyItMatters: string;
  /** Imperative next step shown when the item is missing or partial. */
  readonly action: string;
  /**
   * Product types that see this item. The item appears when at least one of
   * the product's selected types is listed here.
   */
  readonly applicableProductTypes: readonly ProductType[];
  /** Optional extra condition that must also be true for the item to apply. */
  readonly requires?: ApplicabilityCondition;
  /**
   * Whether an applicable item may be answered "Not applicable".
   *
   * Applicability decides whether an item appears at all; this decides
   * whether, once it appears, a founder may still exclude it. False for items
   * that apply to every product that sees them (every hard blocker except
   * backups, for example) — the UI does not offer N/A and the scoring engine
   * rejects it.
   */
  readonly allowNotApplicable: boolean;
  /**
   * Whether the item may be answered "Partial". True for every item except
   * genuinely yes-or-no states — a store either has approved the app or it
   * has not — where a Partial answer would bypass the hard-blocker cap
   * (blockers cap only at score 0). When false, the UI does not offer Partial
   * and the scoring engine rejects it.
   */
  readonly allowPartial: boolean;
}

/**
 * A single checklist item.
 *
 * Weight 3 and `hardBlocker: true` always travel together — the union makes a
 * weight-3 item without the flag (or a flagged lower-weight item) a type error.
 */
export type ChecklistItem = ChecklistItemBase &
  (
    | { readonly weight: 3; readonly hardBlocker: true }
    | { readonly weight: 1 | 2; readonly hardBlocker?: false }
  );

// -----------------------------------------------------------------------------
// Assessment input
// -----------------------------------------------------------------------------

/** Everything that decides which checklist items a product sees. */
export interface ApplicabilityContext {
  productTypes: readonly ProductType[];
  /**
   * Answer to "Do people sign in to use your product?". Any sign-in counts —
   * password, magic link, social login, SSO, invite-only, or a developer
   * sign-up to get an API key. False for products used without signing in,
   * API-key-only APIs, and products where only the founder signs in to an
   * admin area. Controls the account items (sign-up, auth, account deletion,
   * team invites, roles, data export) — never the authorization blocker.
   */
  hasUserAccounts: boolean;
  /**
   * Answer to "Does money change hands through your product?" — purchases,
   * subscriptions, usage billing, fees, or commissions, whoever pays. False
   * removes the Payments & billing category from the checklist and from
   * scoring, and its weight is redistributed across the remaining categories.
   */
  paymentsApplicable: boolean;
  /**
   * Answer to "Do you sell digital goods or subscriptions inside the mobile
   * app?". Only affects mobile products where money changes hands.
   */
  sellsDigitalGoodsInApp: boolean;
  /**
   * Answer to "Does your marketplace pay sellers or providers?". Only affects
   * marketplaces where money changes hands. False for listing-fee,
   * subscription, or lead-generation marketplaces that never pass money on.
   */
  paysOutSellers: boolean;
}

/** Complete input to the scoring engine. */
export interface AssessmentInput {
  product: ProductProfile;
  hasUserAccounts: ApplicabilityContext["hasUserAccounts"];
  paymentsApplicable: ApplicabilityContext["paymentsApplicable"];
  sellsDigitalGoodsInApp: ApplicabilityContext["sellsDigitalGoodsInApp"];
  paysOutSellers: ApplicabilityContext["paysOutSellers"];
  /**
   * Answers keyed by `ChecklistItem.id`. Every applicable item must have an
   * answer; keys for items that do not apply are ignored.
   */
  answers: Readonly<Record<string, ChecklistAnswer>>;
}

// -----------------------------------------------------------------------------
// Result
// -----------------------------------------------------------------------------

/** The four verdicts, from least to most launch-ready. */
export type Verdict =
  | "PROTOTYPE"
  | "NOT_READY"
  | "LAUNCH_WITH_CAVEATS"
  | "READY";

/** Display copy for a verdict. */
export interface VerdictMeta {
  readonly key: Verdict;
  readonly label: string;
  readonly summary: string;
}

/** Score for one category that has at least one scored item. */
export interface CategoryScore {
  key: CategoryKey;
  label: string;
  /** Weight from the catalogue (sums to 100 across all categories). */
  baseWeight: number;
  /** Weight after redistributing excluded categories (sums to 100). */
  effectiveWeight: number;
  /** Sum of answer points × item weight. */
  earned: number;
  /** Sum of 2 × item weight over scored items. */
  possible: number;
  /**
   * earned / possible × 100 at full precision (normalised to six decimal
   * places to strip floating-point noise). Verdict rules use this value.
   */
  percent: number;
  /** `percent` rounded to a whole number. Display only — never compare it. */
  displayPercent: number;
  /** Items that counted — applicable and not answered "notApplicable". */
  scoredItemCount: number;
}

/** An applicable item answered "missing" or "partial". */
export interface ChecklistGap {
  itemId: string;
  label: string;
  category: CategoryKey;
  weight: ItemWeight;
  answer: "missing" | "partial";
  score: 0 | 1;
  /** weight × (2 − score). Larger is a bigger gap. */
  gapPoints: number;
  /** The item is a hard blocker in the catalogue. */
  hardBlocker: boolean;
  /**
   * Hard blocker answered "missing" — counts towards the PROTOTYPE rule and
   * ranks first in the gaps. (A hard blocker answered "partial" is not
   * `blocking`, but still caps the verdict at NOT_READY; see `partialBlockers`.)
   */
  blocking: boolean;
  action: string;
}

/** Complete output of the scoring engine. */
export interface LaunchReadinessResult {
  /**
   * 0..100 at full precision (normalised to six decimal places to strip
   * floating-point noise). Verdict rules use this value.
   */
  overallScore: number;
  /** `overallScore` rounded to a whole number. Display only — never compare it. */
  displayScore: number;
  verdict: Verdict;
  /** Scored categories, in catalogue order. */
  categoryScores: CategoryScore[];
  /**
   * Categories left out of scoring. Only Payments & billing can appear here:
   * when the product is free, or every payment item is marked N/A.
   */
  excludedCategories: CategoryKey[];
  /** Every blocking gap — hard blockers answered "missing" — in catalogue order. */
  hardBlockers: ChecklistGap[];
  /**
   * Hard blockers answered "partial", in catalogue order. Any of these caps the
   * verdict at NOT_READY, but they do not count towards the "2+ hard blockers →
   * PROTOTYPE" rule, which stays missing-only.
   */
  partialBlockers: ChecklistGap[];
  /** Every item answered "missing", in catalogue order. */
  missingItems: ChecklistGap[];
  /** Up to five gaps: blocking first, then by gap points. */
  topGaps: ChecklistGap[];
  /** One action per top gap, in the same order. */
  nextActions: string[];
}
