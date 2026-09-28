/**
 * Pure scoring engine for the Founder Launch Checklist.
 *
 * This file MUST NOT import React, Next.js, browser APIs, storage, network
 * clients, or any AI SDK. It runs in a Node test environment (Vitest) with
 * zero setup.
 *
 * Every function here is deterministic: the same input always produces the
 * same output. Randomness, wall-clock time, and network I/O are forbidden.
 */

import {
  ANSWER_SCORES,
  CATEGORIES,
  CHECKLIST_ITEMS,
  MAX_ITEM_SCORE,
  PRODUCT_TYPES,
  answerOptionsFor,
  getApplicableItems,
  isAnswerAllowed,
} from "./catalogue";
import type {
  ApplicabilityContext,
  AssessmentInput,
  CategoryKey,
  CategoryScore,
  ChecklistAnswer,
  ChecklistGap,
  ChecklistItem,
  ItemScore,
  LaunchReadinessResult,
  ProductType,
  Verdict,
} from "./types";

// -----------------------------------------------------------------------------
// Thresholds
// -----------------------------------------------------------------------------

/**
 * Verdict thresholds. Every comparison uses the full-precision scores, never
 * the rounded display values — 84.6 displays as 85 but is not ≥ 85.
 */
export const THRESHOLDS = {
  /** Overall below this → PROTOTYPE. */
  prototypeBelow: 50,
  /** Overall below this → at best NOT_READY. */
  notReadyBelow: 70,
  /** Overall at or above this (plus the category rule) → READY. */
  readyAtOrAbove: 85,
  /** A category below this counts as weak. Two weak → NOT_READY. */
  weakCategoryBelow: 60,
  /** READY requires every category at or above this. */
  readyCategoryAtOrAbove: 70,
} as const;

/** Maximum number of gaps (and next actions) returned. */
export const TOP_GAP_LIMIT = 5;

const VALID_ANSWERS: readonly ChecklistAnswer[] = [
  "missing",
  "partial",
  "done",
  "notApplicable",
];

const VALID_PRODUCT_TYPES: readonly ProductType[] = PRODUCT_TYPES.map(
  (t) => t.key,
);

/**
 * Decimal places kept on full-precision scores. Enough to keep 84.99 distinct
 * from 85, while stripping floating-point noise such as 49.99999999999999
 * that would otherwise flip a verdict at an exact boundary.
 */
const SCORE_PRECISION = 1e6;

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

/**
 * Thrown for any input the UI should have prevented. `category` is set when
 * the problem is a whole category marked not applicable.
 */
export class AssessmentValidationError extends Error {
  readonly category?: CategoryKey;

  constructor(message: string, category?: CategoryKey) {
    super(`calculateLaunchReadiness: ${message}`);
    this.name = "AssessmentValidationError";
    this.category = category;
  }
}

function isChecklistAnswer(v: unknown): v is ChecklistAnswer {
  return VALID_ANSWERS.includes(v as ChecklistAnswer);
}

/**
 * Throw a specific error if the input is malformed. The UI must prevent every
 * one of these states before calling `calculateLaunchReadiness`.
 */
function assertValidInput(input: AssessmentInput): void {
  if (!input || typeof input !== "object") {
    throw new AssessmentValidationError("missing input");
  }
  if (!input.product || typeof input.product !== "object") {
    throw new AssessmentValidationError("missing input.product");
  }
  const types: unknown = input.product.productTypes;
  if (!Array.isArray(types) || types.length === 0) {
    throw new AssessmentValidationError(
      "input.product.productTypes must list at least one product type",
    );
  }
  for (const t of types) {
    if (!VALID_PRODUCT_TYPES.includes(t as ProductType)) {
      throw new AssessmentValidationError(`unknown product type "${String(t)}"`);
    }
  }
  if (typeof input.hasUserAccounts !== "boolean") {
    throw new AssessmentValidationError(
      "input.hasUserAccounts must be a boolean",
    );
  }
  if (typeof input.paymentsApplicable !== "boolean") {
    throw new AssessmentValidationError(
      "input.paymentsApplicable must be a boolean",
    );
  }
  if (typeof input.sellsDigitalGoodsInApp !== "boolean") {
    throw new AssessmentValidationError(
      "input.sellsDigitalGoodsInApp must be a boolean",
    );
  }
  if (typeof input.paysOutSellers !== "boolean") {
    throw new AssessmentValidationError(
      "input.paysOutSellers must be a boolean",
    );
  }
  if (
    !input.answers ||
    typeof input.answers !== "object" ||
    Array.isArray(input.answers)
  ) {
    throw new AssessmentValidationError("input.answers must be an object");
  }
}

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

/**
 * Categories the user has marked entirely "notApplicable" that are not
 * allowed to be (every category except Payments & billing). Lets the UI
 * validate before scoring with the same rule `calculateLaunchReadiness`
 * enforces. Unanswered items do not count as N/A.
 */
export function findFullyNotApplicableCategories(
  applicableItems: readonly ChecklistItem[],
  answers: Readonly<Record<string, ChecklistAnswer | undefined>>,
): CategoryKey[] {
  return CATEGORIES.filter((category) => {
    if (category.canBeNotApplicable) return false;
    const items = applicableItems.filter((i) => i.category === category.key);
    return (
      items.length > 0 && items.every((i) => answers[i.id] === "notApplicable")
    );
  }).map((c) => c.key);
}

/** Build the applicability context from a full assessment input. */
export function toApplicabilityContext(
  input: AssessmentInput,
): ApplicabilityContext {
  return {
    productTypes: input.product.productTypes,
    hasUserAccounts: input.hasUserAccounts,
    paymentsApplicable: input.paymentsApplicable,
    sellsDigitalGoodsInApp: input.sellsDigitalGoodsInApp,
    paysOutSellers: input.paysOutSellers,
  };
}

/** Strip floating-point noise while keeping sub-integer precision. */
function normalise(value: number): number {
  return Math.round(value * SCORE_PRECISION) / SCORE_PRECISION;
}

/** Points for an answer, or null when the item is excluded as N/A. */
export function scoreAnswer(answer: ChecklistAnswer): ItemScore | null {
  return answer === "notApplicable" ? null : ANSWER_SCORES[answer];
}

const CATALOGUE_INDEX: ReadonlyMap<string, number> = new Map(
  CHECKLIST_ITEMS.map((item, i) => [item.id, i]),
);

const CATEGORY_ORDER: ReadonlyMap<CategoryKey, number> = new Map(
  CATEGORIES.map((c) => [c.key, c.order]),
);

/** An applicable item with its validated answer. */
export interface AnsweredItem {
  item: ChecklistItem;
  answer: ChecklistAnswer;
  score: ItemScore | null;
}

// -----------------------------------------------------------------------------
// Category scoring
// -----------------------------------------------------------------------------

/**
 * Score every category.
 *
 *   category percent = Σ(points × weight) / Σ(2 × weight) × 100
 *
 * Only Payments & billing (`canBeNotApplicable`) may end up with no scored
 * items — because the product is free, or every payment item is marked N/A.
 * It is then excluded and its weight redistributed proportionally:
 *
 *   effectiveWeight = baseWeight × 100 / Σ(baseWeight of scored categories)
 *
 * Any other category with no scored items is a validation error: marking a
 * whole core category N/A would silently inflate the score.
 */
export function scoreCategories(answered: readonly AnsweredItem[]): {
  categoryScores: CategoryScore[];
  excludedCategories: CategoryKey[];
} {
  const partial = CATEGORIES.map((category) => {
    let earned = 0;
    let possible = 0;
    let scoredItemCount = 0;
    for (const a of answered) {
      if (a.item.category !== category.key || a.score === null) continue;
      earned += a.score * a.item.weight;
      possible += MAX_ITEM_SCORE * a.item.weight;
      scoredItemCount++;
    }
    return { category, earned, possible, scoredItemCount };
  });

  for (const p of partial) {
    if (p.possible === 0 && !p.category.canBeNotApplicable) {
      throw new AssessmentValidationError(
        `every item in "${p.category.label}" is marked not applicable — at least one item in this category must be answered`,
        p.category.key,
      );
    }
  }

  const scored = partial.filter((p) => p.possible > 0);
  const excludedCategories = partial
    .filter((p) => p.possible === 0)
    .map((p) => p.category.key);
  const scoredWeight = scored.reduce((s, p) => s + p.category.weight, 0);

  const categoryScores: CategoryScore[] = scored.map((p) => {
    const percent = normalise((p.earned * 100) / p.possible);
    return {
      key: p.category.key,
      label: p.category.label,
      baseWeight: p.category.weight,
      effectiveWeight: (p.category.weight * 100) / scoredWeight,
      earned: p.earned,
      possible: p.possible,
      percent,
      displayPercent: Math.round(percent),
      scoredItemCount: p.scoredItemCount,
    };
  });

  return { categoryScores, excludedCategories };
}

/**
 * Weighted overall score, 0..100 at full precision.
 *
 *   overall = Σ(baseWeight × earned / possible) × 100 / Σ(baseWeight)
 *
 * Equivalent to Σ(percent × effectiveWeight) / 100, but computed from the
 * integer base weights to keep floating-point error to a minimum.
 */
export function computeOverallScore(categoryScores: readonly CategoryScore[]): number {
  const weightTotal = categoryScores.reduce((s, c) => s + c.baseWeight, 0);
  const weighted = categoryScores.reduce(
    (sum, c) => sum + (c.baseWeight * c.earned) / c.possible,
    0,
  );
  return normalise((weighted * 100) / weightTotal);
}

// -----------------------------------------------------------------------------
// Verdict
// -----------------------------------------------------------------------------

/**
 * Map the overall score, category percents, and hard-blocker counts to a
 * verdict. Pass full-precision scores, not display values.
 * Rules are evaluated in this fixed order; the first match wins.
 *
 *   1. PROTOTYPE            score < 50, OR 2+ hard blockers (missing)
 *   2. NOT_READY            score 50–69, OR 2+ categories < 60,
 *                           OR 1 hard blocker (missing),
 *                           OR any hard blocker answered partial
 *   3. LAUNCH_WITH_CAVEATS  score 70–84 (no blockers, ≤1 category < 60)
 *   4. READY                score ≥ 85, no blockers, every category ≥ 70
 *
 * `partialBlockerCount` (checklist v5) caps the verdict at NOT_READY — a
 * launch-stopping requirement that is only partly met is still unmet — but
 * never counts towards the PROTOTYPE rule, which stays missing-only.
 *
 * A score of 85+ with any category below 70 does not meet READY, so it falls
 * back to LAUNCH_WITH_CAVEATS.
 */
export function deriveVerdict(
  overallScore: number,
  categoryPercents: readonly number[],
  hardBlockerCount: number,
  partialBlockerCount = 0,
): Verdict {
  if (overallScore < THRESHOLDS.prototypeBelow || hardBlockerCount >= 2) {
    return "PROTOTYPE";
  }
  const weakCategories = categoryPercents.filter(
    (p) => p < THRESHOLDS.weakCategoryBelow,
  ).length;
  if (
    overallScore < THRESHOLDS.notReadyBelow ||
    weakCategories >= 2 ||
    hardBlockerCount === 1 ||
    partialBlockerCount > 0
  ) {
    return "NOT_READY";
  }
  const everyCategoryReady = categoryPercents.every(
    (p) => p >= THRESHOLDS.readyCategoryAtOrAbove,
  );
  if (overallScore < THRESHOLDS.readyAtOrAbove || !everyCategoryReady) {
    return "LAUNCH_WITH_CAVEATS";
  }
  return "READY";
}

// -----------------------------------------------------------------------------
// Gaps and next actions
// -----------------------------------------------------------------------------

/** Build the gap record for an item answered "missing" or "partial". */
function toGap(a: AnsweredItem): ChecklistGap | null {
  if (a.answer !== "missing" && a.answer !== "partial") return null;
  const score = a.answer === "missing" ? 0 : 1;
  return {
    itemId: a.item.id,
    label: a.item.label,
    category: a.item.category,
    weight: a.item.weight,
    answer: a.answer,
    score,
    gapPoints: a.item.weight * (MAX_ITEM_SCORE - score),
    hardBlocker: a.item.hardBlocker === true,
    blocking: a.item.hardBlocker === true && score === 0,
    action: a.item.action,
  };
}

/**
 * Deterministic gap ranking:
 *   1. blocking hard blockers first
 *   2. then gap points, largest first (weight × (2 − score))
 *   3. ties by category order, then by catalogue position
 */
export function rankGaps(gaps: readonly ChecklistGap[]): ChecklistGap[] {
  return [...gaps].sort(
    (a, b) =>
      Number(b.blocking) - Number(a.blocking) ||
      b.gapPoints - a.gapPoints ||
      (CATEGORY_ORDER.get(a.category) ?? 0) -
        (CATEGORY_ORDER.get(b.category) ?? 0) ||
      (CATALOGUE_INDEX.get(a.itemId) ?? 0) - (CATALOGUE_INDEX.get(b.itemId) ?? 0),
  );
}

/** One action per gap, in the same order. Never generated dynamically. */
export function deriveNextActions(topGaps: readonly ChecklistGap[]): string[] {
  return topGaps.map((g) => g.action);
}

// -----------------------------------------------------------------------------
// Top-level scoring
// -----------------------------------------------------------------------------

/**
 * Score a complete launch-readiness assessment.
 *
 * Throws `AssessmentValidationError` if the input is malformed, if any
 * applicable item has no valid answer, or if every item in a category other
 * than Payments & billing is marked N/A. Answers for items that do not apply
 * are ignored.
 */
export function calculateLaunchReadiness(
  input: AssessmentInput,
): LaunchReadinessResult {
  assertValidInput(input);

  const applicable = getApplicableItems(toApplicabilityContext(input));
  const answered: AnsweredItem[] = applicable.map((item) => {
    const answer: unknown = input.answers[item.id];
    if (!isChecklistAnswer(answer)) {
      throw new AssessmentValidationError(
        `invalid or missing answer for ${item.id}: got ${String(answer)}`,
      );
    }
    // Enforced here as well as in the UI, so a caller cannot bypass it.
    if (!isAnswerAllowed(item, answer)) {
      const choices = answerOptionsFor(item).map((o) => o.label.toLowerCase());
      const list =
        choices.length > 1
          ? `${choices.slice(0, -1).join(", ")}${choices.length > 2 ? "," : ""} or ${choices.at(-1)}`
          : choices[0];
      throw new AssessmentValidationError(
        answer === "partial"
          ? `"Partial" is not available for ${item.id} — answer ${list}`
          : `"Not applicable" is not allowed for ${item.id} — answer ${list}`,
      );
    }
    return { item, answer, score: scoreAnswer(answer) };
  });

  const { categoryScores, excludedCategories } = scoreCategories(answered);
  const overallScore = computeOverallScore(categoryScores);
  const gaps = answered
    .map(toGap)
    .filter((g): g is ChecklistGap => g !== null);
  const hardBlockers = gaps.filter((g) => g.blocking);
  const partialBlockers = gaps.filter((g) => g.hardBlocker && g.answer === "partial");
  const missingItems = gaps.filter((g) => g.answer === "missing");
  const topGaps = rankGaps(gaps).slice(0, TOP_GAP_LIMIT);

  const verdict = deriveVerdict(
    overallScore,
    categoryScores.map((c) => c.percent),
    hardBlockers.length,
    partialBlockers.length,
  );

  return {
    overallScore,
    displayScore: Math.round(overallScore),
    verdict,
    categoryScores,
    excludedCategories,
    hardBlockers,
    partialBlockers,
    missingItems,
    topGaps,
    nextActions: deriveNextActions(topGaps),
  };
}
