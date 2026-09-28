import { describe, expect, it } from "vitest";

import {
  AssessmentValidationError,
  TOP_GAP_LIMIT,
  calculateLaunchReadiness,
  deriveVerdict,
  rankGaps,
} from "./calculate";
import {
  CATEGORIES,
  CHECKLIST_ITEMS,
  PRODUCT_TYPES,
  TOTAL_CATEGORY_WEIGHT,
  answerOptionsFor,
  getApplicableItems,
  getItemById,
  isAnswerAllowed,
} from "./catalogue";
import type {
  AssessmentInput,
  CategoryKey,
  ChecklistAnswer,
  ChecklistGap,
  ProductType,
  Verdict,
} from "./types";

// -----------------------------------------------------------------------------
// Fixtures / helpers
// -----------------------------------------------------------------------------

interface BuildOptions {
  types?: readonly ProductType[];
  paid?: boolean;
  digitalInApp?: boolean;
  payouts?: boolean;
  /** Users sign in. Defaults to true, which reproduces the v2 checklist. */
  accounts?: boolean;
  fill?: ChecklistAnswer;
  /** Answer every applicable item in these categories with the given answer. */
  categories?: Partial<Record<CategoryKey, ChecklistAnswer>>;
  /** Per-item overrides, applied last. */
  overrides?: Record<string, ChecklistAnswer>;
}

/**
 * Build a complete, valid input: every applicable item answered `fill`
 * (default "done"), then category-wide answers, then per-item overrides.
 * Defaults to a free web product so Payments is excluded.
 */
function build({
  types = ["web"],
  paid = false,
  digitalInApp = false,
  payouts = false,
  accounts = true,
  fill = "done",
  categories = {},
  overrides = {},
}: BuildOptions = {}): AssessmentInput {
  const items = getApplicableItems({
    productTypes: types,
    hasUserAccounts: accounts,
    paymentsApplicable: paid,
    sellsDigitalGoodsInApp: digitalInApp,
    paysOutSellers: payouts,
  });
  const answers: Record<string, ChecklistAnswer> = {};
  for (const item of items) {
    answers[item.id] = categories[item.category] ?? fill;
  }
  for (const [id, answer] of Object.entries(overrides)) {
    if (id in answers) answers[id] = answer;
    else throw new Error(`test fixture: override for non-applicable item ${id}`);
  }
  return {
    product: { name: "Test product", oneLiner: "A test product.", productTypes: types },
    hasUserAccounts: accounts,
    paymentsApplicable: paid,
    sellsDigitalGoodsInApp: digitalInApp,
    paysOutSellers: payouts,
    answers,
  };
}

/** Applicable items for a product; payouts default off, accounts default on. */
function itemsFor(
  types: readonly ProductType[],
  paid: boolean,
  digital = false,
  payouts = false,
  accounts = true,
) {
  return getApplicableItems({
    productTypes: types,
    hasUserAccounts: accounts,
    paymentsApplicable: paid,
    sellsDigitalGoodsInApp: digital,
    paysOutSellers: payouts,
  });
}

function categoryPercent(
  result: ReturnType<typeof calculateLaunchReadiness>,
  key: CategoryKey,
): number | undefined {
  return result.categoryScores.find((c) => c.key === key)?.percent;
}

/** Eight categories all at the same percent. */
function flat(p: number): number[] {
  return CATEGORIES.map(() => p);
}

// -----------------------------------------------------------------------------
// Catalogue invariants the engine relies on
// -----------------------------------------------------------------------------

describe("catalogue invariants", () => {
  it("has category weights that sum to exactly 100", () => {
    expect(TOTAL_CATEGORY_WEIGHT).toBe(100);
    expect(CATEGORIES.map((c) => c.weight)).toEqual([15, 15, 15, 15, 10, 10, 10, 10]);
  });

  it("has unique item ids", () => {
    const ids = CHECKLIST_ITEMS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks exactly the weight-3 items as hard blockers", () => {
    for (const item of CHECKLIST_ITEMS) {
      expect(item.hardBlocker === true).toBe(item.weight === 3);
    }
  });

  it("gives every item a non-empty action", () => {
    for (const item of CHECKLIST_ITEMS) {
      expect(item.action.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(PRODUCT_TYPES.map((t) => [t.key] as const))(
    "gives %s at least one item in every category when paid",
    (type) => {
      const items = itemsFor([type], true);
      for (const c of CATEGORIES) {
        expect(items.some((i) => i.category === c.key)).toBe(true);
      }
    },
  );
});

// -----------------------------------------------------------------------------
// Product-type filtering
// -----------------------------------------------------------------------------

describe("product-type filtering", () => {
  it("shows mobile-only items only when mobile is selected", () => {
    const mobileOnly = CHECKLIST_ITEMS.filter(
      (i) => i.applicableProductTypes.length === 1 && i.applicableProductTypes[0] === "mobile",
    );
    expect(mobileOnly.length).toBeGreaterThan(0);
    const web = itemsFor(["web", "saas"], true, true);
    const withMobile = itemsFor(["web", "mobile"], true, true);
    for (const item of mobileOnly) {
      expect(web).not.toContain(item);
      expect(withMobile).toContain(item);
    }
  });

  it("includes an item when any selected product type matches (AI + SaaS)", () => {
    const ids = itemsFor(["ai", "saas"], true).map((i) => i.id);
    expect(ids).toContain("sa-ai-prompt-injection"); // AI only
    expect(ids).toContain("sa-saas-roles"); // SaaS only
    expect(ids).toContain("sa-https-everywhere"); // every type
    expect(ids).not.toContain("oa-api-quickstart"); // API only
  });

  it("returns no items for an empty product-type list", () => {
    expect(itemsFor([], true, true, true)).toEqual([]);
  });

  it("drops the whole Payments category when payments are not applicable", () => {
    const items = itemsFor(["web", "mobile", "api", "ai", "marketplace", "saas"], false, true, true);
    expect(items.some((i) => i.category === "paymentsBilling")).toBe(false);
  });

  describe("in-app purchase blocker", () => {
    const iap = "pb-mobile-in-app-purchase";
    const has = (types: ProductType[], paid: boolean, digital: boolean) =>
      itemsFor(types, paid, digital).some((i) => i.id === iap);

    it("applies to a paid mobile app selling digital goods in the app", () => {
      expect(has(["mobile"], true, true)).toBe(true);
    });
    it("does not apply to a paid mobile app that sells no digital goods in the app", () => {
      expect(has(["mobile"], true, false)).toBe(false);
    });
    it("does not apply to a free mobile app", () => {
      expect(has(["mobile"], false, true)).toBe(false);
    });
    it("does not apply to non-mobile products even when the flag is set", () => {
      expect(has(["web", "saas"], true, true)).toBe(false);
    });
    it("becomes a hard blocker when applicable and missing", () => {
      const r = calculateLaunchReadiness(
        build({ types: ["mobile"], paid: true, digitalInApp: true, overrides: { [iap]: "missing" } }),
      );
      expect(r.hardBlockers.map((b) => b.itemId)).toEqual([iap]);
      expect(r.verdict).toBe("NOT_READY");
    });
    it("ignores an answer for it when it does not apply", () => {
      const input = build({ types: ["mobile"], paid: true, digitalInApp: false });
      const r = calculateLaunchReadiness({ ...input, answers: { ...input.answers, [iap]: "missing" } });
      expect(r.hardBlockers).toEqual([]);
      expect(r.verdict).toBe("READY");
    });
  });
});

// -----------------------------------------------------------------------------
// End-to-end scoring
// -----------------------------------------------------------------------------

describe("calculateLaunchReadiness — scoring", () => {
  it("1. all items missing → 0, PROTOTYPE, every applicable blocker listed", () => {
    const r = calculateLaunchReadiness(build({ fill: "missing" }));
    expect(r.overallScore).toBe(0);
    expect(r.verdict).toBe("PROTOTYPE");
    expect(r.categoryScores.every((c) => c.percent === 0)).toBe(true);
    const applicableBlockers = itemsFor(["web"], false).filter((i) => i.hardBlocker);
    expect(r.hardBlockers.map((b) => b.itemId)).toEqual(applicableBlockers.map((i) => i.id));
    expect(r.missingItems.length).toBe(Object.keys(build().answers).length);
  });

  it("2. all items done → 100, READY, no gaps", () => {
    const r = calculateLaunchReadiness(build({ types: ["ai", "saas"], paid: true }));
    expect(r.overallScore).toBe(100);
    expect(r.verdict).toBe("READY");
    expect(r.categoryScores.every((c) => c.percent === 100)).toBe(true);
    expect(r.hardBlockers).toEqual([]);
    expect(r.missingItems).toEqual([]);
    expect(r.topGaps).toEqual([]);
    expect(r.nextActions).toEqual([]);
  });

  it.each([true, false])(
    "3. all items partial (paid=%s) → every category 50, overall exactly 50, NOT_READY",
    (paid) => {
      const r = calculateLaunchReadiness(build({ fill: "partial", paid }));
      expect(r.categoryScores.every((c) => c.percent === 50)).toBe(true);
      // Exactly 50, not 49.999… — otherwise the redistributed weights would
      // tip the free product into PROTOTYPE.
      expect(r.overallScore).toBe(50);
      expect(r.verdict).toBe("NOT_READY");
      expect(r.hardBlockers).toEqual([]); // partial hard blockers do not block
      expect(r.missingItems).toEqual([]);
    },
  );

  it("computes category percent as Σ(points × weight) / Σ(2 × weight) × 100", () => {
    // Web security items: https(3) secrets(3) authz(3) proven-auth(2) rate(2) deps(1) → possible 28.
    const r = calculateLaunchReadiness(
      build({ overrides: { "sa-proven-auth": "partial", "sa-dependency-scanning": "missing" } }),
    );
    const sec = r.categoryScores.find((c) => c.key === "securityAuth")!;
    expect(sec.possible).toBe(28);
    expect(sec.earned).toBe(28 - 2 - 2); // partial w2 loses 2, missing w1 loses 2
    expect(sec.percent).toBeCloseTo((24 / 28) * 100, 5); // 85.714286
    expect(sec.displayPercent).toBe(86);
  });

  describe("4. not-applicable answers", () => {
    // Checklist v2: analytics items no longer allow N/A, so this uses web
    // onboarding, where sign-up (N/A allowed) sits beside first run and help.
    it("excludes N/A items from the category denominator", () => {
      const r = calculateLaunchReadiness(build({ overrides: { "oa-signup-fast": "notApplicable" } }));
      const oa = r.categoryScores.find((c) => c.key === "onboardingActivation")!;
      expect(oa.scoredItemCount).toBe(2);
      expect(oa.possible).toBe(8); // first run (w2) + help (w2)
      expect(oa.percent).toBe(100);
    });

    // Checklist v2: every non-Payments category contains items that do not
    // allow N/A, so marking a whole category N/A is now rejected at the item
    // level — still a validation error, never a silent redistribution.
    it.each(
      CATEGORIES.filter((c) => c.key !== "paymentsBilling").map((c) => [c.key] as const),
    )("rejects %s with every item marked N/A instead of redistributing it", (key) => {
      const input = build({ paid: true, categories: { [key]: "notApplicable" } });
      expect(() => calculateLaunchReadiness(input)).toThrow(AssessmentValidationError);
      expect(() => calculateLaunchReadiness(input)).toThrow(/"Not applicable" is not allowed/);
    });

    // Checklist v2: the live payment test does not allow N/A, so a product
    // where money changes hands can no longer exclude Payments by marking
    // every item N/A. Payments is excluded only by answering No to the setup
    // question (test 5).
    it("rejects a paid product marking every payment item N/A", () => {
      const input = build({ paid: true, categories: { paymentsBilling: "notApplicable" } });
      expect(() => calculateLaunchReadiness(input)).toThrow(/pb-live-payment-tested/);
    });

    it("still allows N/A on payment items that permit it", () => {
      const r = calculateLaunchReadiness(
        build({
          types: ["saas"],
          paid: true,
          overrides: {
            "pb-webhooks-verified": "notApplicable",
            "pb-failed-payments-handled": "notApplicable",
            "pb-saas-self-serve-plans": "notApplicable",
          },
        }),
      );
      const pb = r.categoryScores.find((c) => c.key === "paymentsBilling")!;
      expect(pb.scoredItemCount).toBe(2); // live payment + receipts
      expect(r.verdict).toBe("READY");
    });

    it("an N/A hard blocker is not a blocker", () => {
      const r = calculateLaunchReadiness(build({ overrides: { "rq-backups-enabled": "notApplicable" } }));
      expect(r.hardBlockers).toEqual([]);
      expect(r.verdict).toBe("READY");
    });
  });

  describe("5–6. payments", () => {
    it("5. excludes Payments from scoring for a free product, ignoring any payment answers", () => {
      const input = build({ paid: false });
      const r = calculateLaunchReadiness({
        ...input,
        answers: { ...input.answers, "pb-live-payment-tested": "missing" },
      });
      expect(r.excludedCategories).toEqual(["paymentsBilling"]);
      expect(r.categoryScores.some((c) => c.key === "paymentsBilling")).toBe(false);
      expect(r.hardBlockers).toEqual([]);
      expect(r.overallScore).toBe(100);
    });

    it("6. redistributes the 10 payment points proportionally", () => {
      const r = calculateLaunchReadiness(build({ paid: false }));
      const weights = Object.fromEntries(r.categoryScores.map((c) => [c.key, c.effectiveWeight]));
      expect(weights.productPositioning).toBeCloseTo((15 * 100) / 90, 10);
      expect(weights.dataPrivacy).toBeCloseTo((10 * 100) / 90, 10);
      const sum = r.categoryScores.reduce((s, c) => s + c.effectiveWeight, 0);
      expect(sum).toBeCloseTo(100, 10);
    });

    it("6. the same weak category costs more when payments are excluded", () => {
      const free = calculateLaunchReadiness(build({ paid: false, categories: { analyticsFeedback: "missing" } }));
      const paid = calculateLaunchReadiness(build({ paid: true, categories: { analyticsFeedback: "missing" } }));
      expect(paid.overallScore).toBe(90); // 100 − 10
      expect(free.overallScore).toBeCloseTo(100 - 1000 / 90, 5); // 88.888889
      expect(free.displayScore).toBe(89);
    });

    it("uses the catalogue weights unchanged when payments apply", () => {
      const r = calculateLaunchReadiness(build({ paid: true }));
      expect(r.excludedCategories).toEqual([]);
      for (const c of r.categoryScores) {
        expect(c.effectiveWeight).toBe(c.baseWeight);
      }
    });
  });

  it("16. one category below 60 with a high score → LAUNCH_WITH_CAVEATS", () => {
    const r = calculateLaunchReadiness(build({ categories: { analyticsFeedback: "missing" } }));
    expect(r.displayScore).toBe(89);
    expect(categoryPercent(r, "analyticsFeedback")).toBe(0);
    expect(r.hardBlockers).toEqual([]);
    expect(r.verdict).toBe("LAUNCH_WITH_CAVEATS");
  });

  it("17. two categories below 60 → NOT_READY even with a 70+ score", () => {
    const r = calculateLaunchReadiness(build({ categories: { analyticsFeedback: "missing", launchGtm: "missing" } }));
    expect(r.overallScore).toBeCloseTo(100 - 2000 / 90, 5); // 77.777778
    expect(r.displayScore).toBe(78);
    expect(r.hardBlockers).toEqual([]);
    expect(r.verdict).toBe("NOT_READY");
  });

  it("18 / 20. one hard blocker overrides a high score → NOT_READY", () => {
    const r = calculateLaunchReadiness(build({ overrides: { "sa-https-everywhere": "missing" } }));
    expect(r.overallScore).toBeCloseTo(100 - (6 / 28) * (1500 / 90), 5); // 96.428571
    expect(r.displayScore).toBe(96);
    expect(r.hardBlockers.map((b) => b.itemId)).toEqual(["sa-https-everywhere"]);
    expect(r.verdict).toBe("NOT_READY");
  });

  it("19 / 20. multiple hard blockers override a high score → PROTOTYPE", () => {
    const r = calculateLaunchReadiness(
      build({ overrides: { "sa-https-everywhere": "missing", "sa-no-exposed-secrets": "missing" } }),
    );
    expect(r.overallScore).toBeCloseTo(100 - (12 / 28) * (1500 / 90), 5); // 92.857143
    expect(r.displayScore).toBe(93);
    expect(r.hardBlockers.map((b) => b.itemId)).toEqual(["sa-https-everywhere", "sa-no-exposed-secrets"]);
    expect(r.verdict).toBe("PROTOTYPE");
  });

  // Checklist v5 (audit P0-1): a partial hard blocker is still not a missing
  // (`blocking`) blocker, but it now caps the verdict at NOT_READY. Under v4
  // this exact input returned READY — the defect this change fixes.
  it("a partial hard blocker is a gap, not a missing blocker, and caps the verdict at NOT_READY", () => {
    const r = calculateLaunchReadiness(build({ overrides: { "sa-https-everywhere": "partial" } }));
    expect(r.hardBlockers).toEqual([]);
    expect(r.partialBlockers.map((b) => b.itemId)).toEqual(["sa-https-everywhere"]);
    expect(r.topGaps[0]).toMatchObject({ itemId: "sa-https-everywhere", hardBlocker: true, blocking: false, gapPoints: 3 });
    expect(r.verdict).toBe("NOT_READY");
  });

  it("returns category scores in catalogue order", () => {
    const r = calculateLaunchReadiness(build({ paid: true }));
    expect(r.categoryScores.map((c) => c.key)).toEqual(CATEGORIES.map((c) => c.key));
  });

  // Checklist v4: store approval has no Partial, so it is answered Missing here.
  it("is deterministic across repeated calls", () => {
    const input = build({
      types: ["mobile", "saas"],
      paid: true,
      digitalInApp: true,
      fill: "partial",
      overrides: { "lg-mobile-store-approved": "missing" },
    });
    expect(calculateLaunchReadiness(input)).toEqual(calculateLaunchReadiness(input));
  });
});

// -----------------------------------------------------------------------------
// deriveVerdict — boundaries and precedence
// -----------------------------------------------------------------------------

describe("deriveVerdict — score boundaries (all categories 100, no blockers)", () => {
  it.each([
    [0, "PROTOTYPE"],
    [40, "PROTOTYPE"], // 7
    [49, "PROTOTYPE"], // 8
    [50, "NOT_READY"], // 9
    [64, "NOT_READY"], // 10
    [65, "NOT_READY"], // 11
    [69, "NOT_READY"], // 12
    [70, "LAUNCH_WITH_CAVEATS"], // 13
    [84, "LAUNCH_WITH_CAVEATS"], // 14
    [85, "READY"], // 15
    [100, "READY"],
  ] as const)("score %d → %s", (score, expected) => {
    expect(deriveVerdict(score, flat(100), 0)).toBe(expected satisfies Verdict);
  });
});

describe("deriveVerdict — category rules", () => {
  it("one category below 60 is allowed for LAUNCH_WITH_CAVEATS", () => {
    expect(deriveVerdict(75, [...flat(100).slice(1), 59], 0)).toBe("LAUNCH_WITH_CAVEATS");
  });

  it("one category below 60 blocks READY even at 85+", () => {
    expect(deriveVerdict(90, [...flat(100).slice(1), 59], 0)).toBe("LAUNCH_WITH_CAVEATS");
  });

  it("a category of 60–69 at 85+ is LAUNCH_WITH_CAVEATS, not READY", () => {
    expect(deriveVerdict(90, [...flat(100).slice(1), 69], 0)).toBe("LAUNCH_WITH_CAVEATS");
  });

  it("a category at exactly 60 is not weak; exactly 70 meets READY", () => {
    expect(deriveVerdict(75, [...flat(100).slice(2), 60, 60], 0)).toBe("LAUNCH_WITH_CAVEATS");
    expect(deriveVerdict(90, [...flat(100).slice(1), 70], 0)).toBe("READY");
  });

  it("two categories below 60 → NOT_READY regardless of score", () => {
    expect(deriveVerdict(95, [...flat(100).slice(2), 59, 59], 0)).toBe("NOT_READY");
  });

  it("two categories below 60 do not rescue a sub-50 score from PROTOTYPE", () => {
    expect(deriveVerdict(45, [...flat(100).slice(2), 10, 10], 0)).toBe("PROTOTYPE");
  });
});

describe("deriveVerdict — hard blockers", () => {
  it("one hard blocker caps a perfect score at NOT_READY", () => {
    expect(deriveVerdict(100, flat(100), 1)).toBe("NOT_READY");
  });

  it("two or more hard blockers cap a perfect score at PROTOTYPE", () => {
    expect(deriveVerdict(100, flat(100), 2)).toBe("PROTOTYPE");
    expect(deriveVerdict(100, flat(100), 5)).toBe("PROTOTYPE");
  });

  it("one hard blocker with a sub-50 score is still PROTOTYPE", () => {
    expect(deriveVerdict(40, flat(100), 1)).toBe("PROTOTYPE");
  });
});

// -----------------------------------------------------------------------------
// Precision — verdicts use full-precision scores, never display rounding
// -----------------------------------------------------------------------------

describe("deriveVerdict — full-precision overall score", () => {
  it.each([
    [49.6, "PROTOTYPE"],
    [49.99, "PROTOTYPE"],
    [50.0, "NOT_READY"],
    [69.6, "NOT_READY"], // displays as 70
    [69.99, "NOT_READY"],
    [70.0, "LAUNCH_WITH_CAVEATS"],
    [84.6, "LAUNCH_WITH_CAVEATS"], // displays as 85
    [84.99, "LAUNCH_WITH_CAVEATS"],
    [85.0, "READY"],
  ] as const)("overall %d → %s", (score, expected) => {
    expect(deriveVerdict(score, flat(100), 0)).toBe(expected);
  });
});

describe("deriveVerdict — full-precision category scores", () => {
  // Two categories at the given value, the rest at 100, overall 90, no blockers.
  it.each([
    [59.6, "NOT_READY"], // displays as 60, but both are still weak
    [59.99, "NOT_READY"],
    [60.0, "LAUNCH_WITH_CAVEATS"], // not weak; below 70 so not READY
  ] as const)("two categories at %d → %s", (value, expected) => {
    expect(deriveVerdict(90, [...flat(100).slice(2), value, value], 0)).toBe(expected);
  });

  // One category at the given value, the rest at 100, overall 90, no blockers.
  it.each([
    [69.6, "LAUNCH_WITH_CAVEATS"], // displays as 70, but does not meet READY
    [69.99, "LAUNCH_WITH_CAVEATS"],
    [70.0, "READY"],
  ] as const)("one category at %d → %s", (value, expected) => {
    expect(deriveVerdict(90, [...flat(100).slice(1), value], 0)).toBe(expected);
  });
});

describe("calculateLaunchReadiness — display rounding never changes the verdict", () => {
  // Web, free (weights 15/15/15/15/10/10/10 of 90). Every category stays ≥ 70
  // and there are no blockers, so only the overall threshold decides.
  //   lost weight = pp 3.75 + rq 2.5 + sa 2.6786 + dp 2 + af 2 + lg 0.9091 = 13.8377
  //   overall     = 100 − 13.8377 × 100 / 90 = 84.6248  → displays as 85
  const r = calculateLaunchReadiness(
    build({
      overrides: {
        "pp-value-proposition": "missing",
        "rq-critical-path-tests": "missing",
        "sa-proven-auth": "missing",
        "sa-dependency-scanning": "partial",
        "dp-terms-of-service": "missing",
        "af-activation-tracked": "partial",
        "lg-contact-early-users": "missing",
      },
    }),
  );

  it("keeps the overall score at full precision and rounds only the display value", () => {
    expect(r.overallScore).toBeCloseTo(84.6248, 3);
    expect(r.displayScore).toBe(85);
  });

  it("judges 84.62 as below 85 — LAUNCH_WITH_CAVEATS, not READY", () => {
    expect(r.hardBlockers).toEqual([]);
    expect(r.categoryScores.every((c) => c.percent >= 70)).toBe(true);
    expect(r.verdict).toBe("LAUNCH_WITH_CAVEATS");
  });

  it("gives every category a whole-number display percent", () => {
    for (const c of r.categoryScores) {
      expect(c.displayPercent).toBe(Math.round(c.percent));
    }
  });
});

// -----------------------------------------------------------------------------
// Gaps and next actions
// -----------------------------------------------------------------------------

describe("gaps and next actions", () => {
  // Web, free, everything done except these (gap = weight × (2 − score)):
  //   sa-https-everywhere      missing  w3 → 6, blocking
  //   sa-proven-auth           missing  w2 → 4   (Security, order 3)
  //   dp-terms-of-service      missing  w2 → 4   (Data & privacy, order 4)
  //   rq-rollback-ready        partial  w2 → 2   (Reliability, order 2)
  //   af-traffic-sources       missing  w1 → 2   (Analytics, order 6)
  //   pp-scope-trimmed         partial  w1 → 1   ← 6th, cut by the top-5 limit
  const input = build({
    overrides: {
      "sa-https-everywhere": "missing",
      "sa-proven-auth": "missing",
      "dp-terms-of-service": "missing",
      "rq-rollback-ready": "partial",
      "af-traffic-sources": "missing",
      "pp-scope-trimmed": "partial",
    },
  });
  const r = calculateLaunchReadiness(input);

  it("21. ranks blockers first, then gap points, then category order", () => {
    expect(r.topGaps.map((g) => g.itemId)).toEqual([
      "sa-https-everywhere",
      "sa-proven-auth",
      "dp-terms-of-service",
      "rq-rollback-ready",
      "af-traffic-sources",
    ]);
    expect(r.topGaps.map((g) => g.gapPoints)).toEqual([6, 4, 4, 2, 2]);
  });

  it("22. returns at most five gaps", () => {
    expect(TOP_GAP_LIMIT).toBe(5);
    expect(r.topGaps).toHaveLength(5);
    expect(r.topGaps.map((g) => g.itemId)).not.toContain("pp-scope-trimmed");
  });

  it("22. caps gaps at five even when everything is missing, blockers first", () => {
    const all = calculateLaunchReadiness(build({ fill: "missing" }));
    expect(all.topGaps).toHaveLength(5);
    expect(all.nextActions).toHaveLength(5);
    expect(all.topGaps.every((g) => g.blocking)).toBe(true);
    expect(all.hardBlockers.length).toBeGreaterThan(5); // full list is not truncated
  });

  it("returns one next action per top gap, taken verbatim from the catalogue", () => {
    expect(r.nextActions).toEqual(r.topGaps.map((g) => getItemById(g.itemId)!.action));
  });

  it("lists every missing item in catalogue order, including blockers", () => {
    expect(r.missingItems.map((g) => g.itemId)).toEqual([
      "sa-https-everywhere",
      "sa-proven-auth",
      "dp-terms-of-service",
      "af-traffic-sources",
    ]);
  });

  it("always puts blocking hard blockers ahead of larger ordinary gaps", () => {
    const gap = (itemId: string, gapPoints: number, blocking: boolean): ChecklistGap => ({
      itemId,
      label: itemId,
      category: "productPositioning",
      weight: 3,
      answer: "missing",
      score: 0,
      gapPoints,
      hardBlocker: blocking,
      blocking,
      action: itemId,
    });
    const ranked = rankGaps([gap("pp-value-proposition", 9, false), gap("pp-core-job-works", 6, true)]);
    expect(ranked.map((g) => g.itemId)).toEqual(["pp-core-job-works", "pp-value-proposition"]);
  });
});

// -----------------------------------------------------------------------------
// Invalid input
// -----------------------------------------------------------------------------

describe("calculateLaunchReadiness — invalid input", () => {
  const valid = build();

  it("throws on null or missing input", () => {
    expect(() => calculateLaunchReadiness(null as unknown as AssessmentInput)).toThrow(/missing input/);
    expect(() => calculateLaunchReadiness({ ...valid, product: undefined } as unknown as AssessmentInput)).toThrow(/input\.product/);
  });

  it("throws on an empty product-type list", () => {
    expect(() => calculateLaunchReadiness({ ...valid, product: { ...valid.product, productTypes: [] } })).toThrow(/at least one product type/);
  });

  it("throws when productTypes is not an array", () => {
    expect(() =>
      calculateLaunchReadiness({ ...valid, product: { ...valid.product, productTypes: "web" } } as unknown as AssessmentInput),
    ).toThrow(/at least one product type/);
  });

  it("throws on an unknown product type", () => {
    expect(() =>
      calculateLaunchReadiness({ ...valid, product: { ...valid.product, productTypes: ["web", "desktop"] } } as unknown as AssessmentInput),
    ).toThrow(/unknown product type "desktop"/);
  });

  it("throws when paymentsApplicable or sellsDigitalGoodsInApp is not a boolean", () => {
    expect(() => calculateLaunchReadiness({ ...valid, paymentsApplicable: "no" } as unknown as AssessmentInput)).toThrow(/paymentsApplicable/);
    expect(() => calculateLaunchReadiness({ ...valid, sellsDigitalGoodsInApp: undefined } as unknown as AssessmentInput)).toThrow(/sellsDigitalGoodsInApp/);
  });

  it("throws when paysOutSellers is missing or not a boolean", () => {
    expect(() => calculateLaunchReadiness({ ...valid, paysOutSellers: undefined } as unknown as AssessmentInput)).toThrow(/paysOutSellers/);
    expect(() => calculateLaunchReadiness({ ...valid, paysOutSellers: "yes" } as unknown as AssessmentInput)).toThrow(/paysOutSellers/);
  });

  it("throws when answers is missing or not a plain object", () => {
    expect(() => calculateLaunchReadiness({ ...valid, answers: null } as unknown as AssessmentInput)).toThrow(/answers/);
    expect(() => calculateLaunchReadiness({ ...valid, answers: [] } as unknown as AssessmentInput)).toThrow(/answers/);
  });

  it("throws naming the item when an applicable item has no answer", () => {
    const answers = { ...valid.answers };
    delete answers["dp-privacy-policy"];
    expect(() => calculateLaunchReadiness({ ...valid, answers })).toThrow(/dp-privacy-policy/);
  });

  it("throws on an invalid answer value", () => {
    expect(() =>
      calculateLaunchReadiness({ ...valid, answers: { ...valid.answers, "dp-privacy-policy": "yes" } } as unknown as AssessmentInput),
    ).toThrow(/dp-privacy-policy/);
  });

  it("ignores answers for unknown or non-applicable items", () => {
    const r = calculateLaunchReadiness({
      ...valid,
      answers: { ...valid.answers, "not-a-real-item": "missing", "oa-api-quickstart": "missing" },
    });
    expect(r.overallScore).toBe(100);
  });

  it("throws a validation error for every malformed input", () => {
    expect(() => calculateLaunchReadiness({ ...valid, answers: null } as unknown as AssessmentInput)).toThrow(
      AssessmentValidationError,
    );
  });

  // Checklist v2: rejected at the first item that does not allow N/A.
  it("throws when every applicable item is marked not applicable", () => {
    expect(() => calculateLaunchReadiness(build({ fill: "notApplicable" }))).toThrow(
      /"Not applicable" is not allowed for pp-core-job-works/,
    );
  });
});

// -----------------------------------------------------------------------------
// Checklist v2 (P1) — per-item N/A control
// -----------------------------------------------------------------------------

describe("per-item N/A control", () => {
  const BLOCKERS_WITHOUT_NA = [
    "pp-core-job-works",
    "oa-api-reference-docs",
    "sa-https-everywhere",
    "sa-no-exposed-secrets",
    "sa-authorization-enforced",
    "dp-privacy-policy",
    "pb-live-payment-tested",
    "pb-mobile-in-app-purchase",
    "pb-marketplace-payouts",
    "lg-mobile-store-approved",
  ];

  it("declares allowNotApplicable explicitly as a boolean on every item", () => {
    for (const item of CHECKLIST_ITEMS) {
      expect(typeof item.allowNotApplicable).toBe("boolean");
    }
  });

  it("prohibits N/A on every hard blocker except backups", () => {
    const blockers = CHECKLIST_ITEMS.filter((i) => i.hardBlocker);
    expect(blockers.filter((i) => !i.allowNotApplicable).map((i) => i.id).sort()).toEqual(
      [...BLOCKERS_WITHOUT_NA].sort(),
    );
    expect(getItemById("rq-backups-enabled")?.allowNotApplicable).toBe(true);
  });

  it("answerOptionsFor offers N/A only when the item allows it", () => {
    for (const item of CHECKLIST_ITEMS) {
      const values = answerOptionsFor(item).map((o) => o.value);
      // Checklist v4: Partial is also per-item (only store approval turns it off).
      expect(values).toEqual([
        "missing",
        ...(item.allowPartial ? ["partial"] : []),
        "done",
        ...(item.allowNotApplicable ? ["notApplicable"] : []),
      ]);
    }
  });

  it.each(BLOCKERS_WITHOUT_NA)("the engine rejects a programmatic N/A for %s", (id) => {
    // A product where every one of these blockers applies.
    const input = build({ types: ["mobile", "api", "marketplace"], paid: true, digitalInApp: true, payouts: true });
    expect(id in input.answers).toBe(true);
    expect(() =>
      calculateLaunchReadiness({ ...input, answers: { ...input.answers, [id]: "notApplicable" } }),
    ).toThrow(new RegExp(`not allowed for ${id}`));
  });

  it("the engine rejects N/A on a prohibited ordinary item too", () => {
    const input = build();
    expect(() =>
      calculateLaunchReadiness({ ...input, answers: { ...input.answers, "af-traffic-sources": "notApplicable" } }),
    ).toThrow(/not allowed for af-traffic-sources/);
  });

  it.each([
    ["rq-backups-enabled", ["web"]],
    ["oa-signup-fast", ["web"]],
    ["oa-saas-team-invites", ["saas"]],
    ["sa-saas-roles", ["saas"]],
    ["pb-api-usage-metering", ["api"]],
  ] as const)("still allows a legitimate N/A for %s", (id, types) => {
    const input = build({ types, paid: true, overrides: { [id]: "notApplicable" } });
    expect(() => calculateLaunchReadiness(input)).not.toThrow();
  });
});

// -----------------------------------------------------------------------------
// Checklist v2 (P1) — payment applicability and the live payment test
// -----------------------------------------------------------------------------

describe("payments applicability", () => {
  const ids = (items: ReturnType<typeof itemsFor>) => items.map((i) => i.id);
  const LIVE = "pb-live-payment-tested";
  const IAP = "pb-mobile-in-app-purchase";
  const METERING = "pb-api-usage-metering";

  it.each([
    ["paid web", ["web"]],
    ["paid SaaS", ["saas"]],
  ] as const)("%s gets the live payment test", (_label, types) => {
    const items = ids(itemsFor(types, true));
    expect(items).toContain(LIVE);
    expect(items).not.toContain(IAP);
  });

  it("mobile with in-app digital goods gets the live payment test and the IAP blocker", () => {
    const items = ids(itemsFor(["mobile"], true, true));
    expect(items).toContain(LIVE);
    expect(items).toContain(IAP);
  });

  it("mobile without in-app digital goods gets the live payment test but not the IAP blocker", () => {
    const items = ids(itemsFor(["mobile"], true, false));
    expect(items).toContain(LIVE);
    expect(items).not.toContain(IAP);
  });

  it("API products get the live payment test and usage metering", () => {
    const items = ids(itemsFor(["api"], true));
    expect(items).toContain(LIVE);
    expect(items).toContain(METERING);
  });

  it.each(["web", "saas", "mobile", "api", "marketplace", "ai"] as const)(
    "free %s gets no payment items at all",
    (type) => {
      expect(itemsFor([type], false, true, true).some((i) => i.category === "paymentsBilling")).toBe(false);
    },
  );

  it("defines Done for card, in-app, and usage billing, and no longer requires a refund", () => {
    const item = getItemById(LIVE)!;
    expect(item.description).toMatch(/live mode/);
    expect(item.description).toMatch(/TestFlight/);
    expect(item.description).toMatch(/Google Play internal testing/);
    expect(item.description).toMatch(/don't need to be publicly released/);
    expect(item.description).toMatch(/usage-based or invoiced billing/);
    expect(item.description).not.toMatch(/refund/i);
    expect(item.action).toMatch(/refund it afterwards/); // moved to the action
  });

  it("a paid mobile IAP app can reach READY once its pre-release purchase test is done", () => {
    const r = calculateLaunchReadiness(build({ types: ["mobile"], paid: true, digitalInApp: true }));
    expect(r.verdict).toBe("READY");
  });
});

// -----------------------------------------------------------------------------
// Checklist v2 (P1) — marketplace seller payouts
// -----------------------------------------------------------------------------

describe("marketplace seller payouts", () => {
  const PAYOUTS = "pb-marketplace-payouts";
  const has = (paid: boolean, payouts: boolean, types: ProductType[] = ["marketplace"]) =>
    itemsFor(types, paid, false, payouts).some((i) => i.id === PAYOUTS);

  it("applies to a paid marketplace that pays sellers or providers", () => {
    expect(has(true, true)).toBe(true);
  });

  it.each([
    "listing-fee marketplace",
    "subscription marketplace",
    "lead-generation marketplace",
    "commission-free marketplace where buyers pay sellers directly",
  ])("does not apply to a %s (money changes hands, no payouts)", () => {
    expect(has(true, false)).toBe(false);
  });

  it("does not apply to a free marketplace, even if the payout flag is set", () => {
    expect(has(false, true)).toBe(false);
    expect(has(false, false)).toBe(false);
  });

  it("does not apply to non-marketplace products, even if the payout flag is set", () => {
    expect(has(true, true, ["web", "saas"])).toBe(false);
  });

  it("does not make every marketplace paid — a free marketplace has no Payments category", () => {
    expect(itemsFor(["marketplace"], false).some((i) => i.category === "paymentsBilling")).toBe(false);
  });

  it("a paying marketplace without payouts can reach READY with no payout blocker", () => {
    const r = calculateLaunchReadiness(build({ types: ["marketplace"], paid: true, payouts: false }));
    expect(r.verdict).toBe("READY");
    expect(r.hardBlockers).toEqual([]);
  });

  it("a marketplace that pays sellers is blocked when payouts are missing, and cannot use N/A", () => {
    const missing = calculateLaunchReadiness(
      build({ types: ["marketplace"], paid: true, payouts: true, overrides: { [PAYOUTS]: "missing" } }),
    );
    expect(missing.hardBlockers.map((b) => b.itemId)).toEqual([PAYOUTS]);
    expect(missing.verdict).toBe("NOT_READY");
    expect(answerOptionsFor(getItemById(PAYOUTS)!).map((o) => o.value)).not.toContain("notApplicable");
    expect(() =>
      calculateLaunchReadiness(
        build({ types: ["marketplace"], paid: true, payouts: true, overrides: { [PAYOUTS]: "notApplicable" } }),
      ),
    ).toThrow(AssessmentValidationError);
  });
});

// -----------------------------------------------------------------------------
// Checklist v3 (P2) — user-account applicability
// -----------------------------------------------------------------------------

describe("user-account applicability", () => {
  const ACCOUNT_ITEMS = [
    "oa-signup-fast",
    "sa-proven-auth",
    "dp-account-deletion",
    "oa-saas-team-invites",
    "sa-saas-roles",
    "dp-saas-data-export",
  ];
  const STILL_UNCONDITIONAL = [
    "sa-authorization-enforced",
    "sa-rate-limiting",
    "sa-ai-usage-limits",
    "sa-api-key-management",
    "rq-backups-enabled",
  ];
  const ids = (types: readonly ProductType[], accounts: boolean, paid = true) =>
    itemsFor(types, paid, false, false, accounts).map((i) => i.id);

  // 1. Validation
  it("1. rejects a missing or non-boolean hasUserAccounts", () => {
    const valid = build();
    expect(() => calculateLaunchReadiness({ ...valid, hasUserAccounts: undefined } as unknown as AssessmentInput)).toThrow(/hasUserAccounts/);
    expect(() => calculateLaunchReadiness({ ...valid, hasUserAccounts: "no" } as unknown as AssessmentInput)).toThrow(/hasUserAccounts/);
  });

  // 2 + 5. The six conditional items and their N/A permissions
  it("2. exactly six items require hasUserAccounts", () => {
    expect(CHECKLIST_ITEMS.filter((i) => i.requires === "hasUserAccounts").map((i) => i.id).sort()).toEqual(
      [...ACCOUNT_ITEMS].sort(),
    );
  });

  it.each([
    ["oa-signup-fast", true],
    ["sa-proven-auth", false],
    ["dp-account-deletion", false],
    ["oa-saas-team-invites", true],
    ["sa-saas-roles", true],
    ["dp-saas-data-export", true],
  ] as const)("5. %s allowNotApplicable is %s", (id, allowed) => {
    expect(getItemById(id)?.allowNotApplicable).toBe(allowed);
  });

  it("5. the engine rejects N/A on sa-proven-auth and dp-account-deletion when users sign in", () => {
    for (const id of ["sa-proven-auth", "dp-account-deletion"]) {
      expect(() => calculateLaunchReadiness(build({ overrides: { [id]: "notApplicable" } }))).toThrow(
        new RegExp(`not allowed for ${id}`),
      );
    }
  });

  it("5. N/A still works on the four account items that allow it", () => {
    const input = build({
      types: ["saas"],
      paid: true,
      overrides: {
        "oa-signup-fast": "notApplicable",
        "oa-saas-team-invites": "notApplicable",
        "sa-saas-roles": "notApplicable",
        "dp-saas-data-export": "notApplicable",
      },
    });
    expect(() => calculateLaunchReadiness(input)).not.toThrow();
  });

  // 3 + 4. Every product type, with and without accounts
  it.each(PRODUCT_TYPES.map((t) => [t.key] as const))(
    "3. %s with accounts shows every account item that fits the type",
    (type) => {
      const list = ids([type], true);
      expect(list).toContain("sa-proven-auth");
      expect(list).toContain("dp-account-deletion");
      expect(list.includes("oa-signup-fast")).toBe(type !== "api"); // UI products only
      for (const saasOnly of ["oa-saas-team-invites", "sa-saas-roles", "dp-saas-data-export"]) {
        expect(list.includes(saasOnly)).toBe(type === "saas");
      }
    },
  );

  it.each(PRODUCT_TYPES.map((t) => [t.key] as const))(
    "4. %s without accounts shows no account items but keeps authorization",
    (type) => {
      const list = ids([type], false);
      for (const id of ACCOUNT_ITEMS) expect(list).not.toContain(id);
      expect(list).toContain("sa-authorization-enforced");
    },
  );

  it.each([
    ["web", 3],
    ["mobile", 3],
    ["api", 2],
    ["ai", 3],
    ["marketplace", 3],
    ["saas", 6],
  ] as const)("4. %s loses exactly %i items without accounts", (type, lost) => {
    expect(ids([type], true).length - ids([type], false).length).toBe(lost);
  });

  it("with accounts, every product sees exactly the v2 checklist", () => {
    const v2Web = [...ids(["web"], true)];
    expect(v2Web).toHaveLength(39); // paid web, unchanged from v2
    expect(ids(["ai", "saas"], true)).toHaveLength(52); // Threadloom's shape
  });

  // 6. Authorization stays unconditional
  it("6. sa-authorization-enforced stays on every product, with or without accounts", () => {
    const item = getItemById("sa-authorization-enforced")!;
    expect(item.requires).toBeUndefined();
    expect(item.allowNotApplicable).toBe(false);
    expect(item.hardBlocker).toBe(true);
    for (const t of PRODUCT_TYPES) {
      for (const accounts of [true, false]) {
        expect(ids([t.key], accounts)).toContain("sa-authorization-enforced");
      }
    }
    expect(item.whyItMatters).toMatch(/about stored data, not whether you have accounts/);
  });

  it.each(STILL_UNCONDITIONAL)("6. %s does not depend on accounts", (id) => {
    expect(getItemById(id)?.requires).toBeUndefined();
  });

  it("AI usage limits explicitly cover visitors who don't sign in", () => {
    const item = getItemById("sa-ai-usage-limits")!;
    expect(item.description).toMatch(/per IP address or session/);
    expect(ids(["ai"], false)).toContain("sa-ai-usage-limits");
  });

  it("sa-proven-auth does not assume passwords", () => {
    const item = getItemById("sa-proven-auth")!;
    expect(item.description).toMatch(/magic links/);
    expect(item.description).toMatch(/Google or Apple login/);
    expect(item.description).toMatch(/account recovery/);
  });

  // 7–14. Scenarios — each maps to an answer to "Do people sign in?"
  const SCENARIOS = [
    // [label, types, users sign in?]
    ["7. API with API keys only, no human accounts", ["api"], false],
    ["8. API with a developer dashboard sign-up", ["api"], true],
    ["9. anonymous / accountless web tool", ["web"], false],
    ["10. magic-link sign-in", ["web", "saas"], true],
    ["11. OAuth / social login", ["mobile"], true],
    ["12. invite-only product", ["web", "saas"], true],
    ["13. team / workspace SaaS", ["saas"], true],
    ["14. admin-only login (only the founder signs in)", ["web"], false],
  ] as const;

  it.each(SCENARIOS)("%s", (_label, types, accounts) => {
    const list = ids(types, accounts);
    expect(list.includes("sa-proven-auth")).toBe(accounts);
    expect(list.includes("dp-account-deletion")).toBe(accounts);
    expect(list).toContain("sa-authorization-enforced");
    // Scores cleanly when everything is done.
    const r = calculateLaunchReadiness(build({ types, paid: true, accounts }));
    expect(r.verdict).toBe("READY");
  });

  it("7. an API-key-only API keeps key management and authorization, but loses sign-in items", () => {
    const list = ids(["api"], false);
    expect(list).toContain("sa-api-key-management");
    expect(list).toContain("sa-authorization-enforced");
    expect(list).not.toContain("sa-proven-auth");
  });

  it("12. an invite-only product can still mark sign-up speed N/A", () => {
    expect(() =>
      calculateLaunchReadiness(build({ types: ["web", "saas"], paid: true, overrides: { "oa-signup-fast": "notApplicable" } })),
    ).not.toThrow();
  });

  it("13. a team SaaS gets invites, roles, and export; a single-user SaaS can mark invites and roles N/A", () => {
    const list = ids(["saas"], true);
    for (const id of ["oa-saas-team-invites", "sa-saas-roles", "dp-saas-data-export"]) expect(list).toContain(id);
  });

  it("answers for account items are ignored when users don't sign in", () => {
    const input = build({ types: ["web"], accounts: false });
    const r = calculateLaunchReadiness({
      ...input,
      answers: { ...input.answers, "sa-proven-auth": "missing", "dp-account-deletion": "notApplicable" },
    });
    expect(r.verdict).toBe("READY");
  });

  it("an accountless product still hits the authorization blocker when it is missing", () => {
    const r = calculateLaunchReadiness(build({ types: ["web"], accounts: false, overrides: { "sa-authorization-enforced": "missing" } }));
    expect(r.hardBlockers.map((b) => b.itemId)).toEqual(["sa-authorization-enforced"]);
  });
});

// -----------------------------------------------------------------------------
// Checklist v4 (P2) — store approval has no Partial state
// -----------------------------------------------------------------------------

describe("store approval is yes-or-no", () => {
  const STORE = "lg-mobile-store-approved";
  const item = () => getItemById(STORE)!;
  const mobileFree = (answer: ChecklistAnswer) =>
    build({ types: ["mobile"], paid: false, overrides: { [STORE]: answer } });

  it("1. every item still allows Partial except lg-mobile-store-approved", () => {
    expect(CHECKLIST_ITEMS.filter((i) => !i.allowPartial).map((i) => i.id)).toEqual([STORE]);
    for (const i of CHECKLIST_ITEMS) expect(typeof i.allowPartial).toBe("boolean");
  });

  it("keeps store approval mobile-only, weight 3, a hard blocker, in Launch & GTM, with no N/A", () => {
    const s = item();
    expect(s.applicableProductTypes).toEqual(["mobile"]);
    expect(s.requires).toBeUndefined();
    expect(s.weight).toBe(3);
    expect(s.hardBlocker).toBe(true);
    expect(s.category).toBe("launchGtm");
    expect(s.allowNotApplicable).toBe(false);
  });

  it("2. answerOptionsFor returns exactly Missing and Done", () => {
    expect(answerOptionsFor(item()).map((o) => o.label)).toEqual(["Missing", "Done"]);
  });

  it("the wording says submitted, in review, TestFlight, and internal testing are Missing", () => {
    const d = item().description;
    for (const phrase of ["Missing", "submitted", "in review", "TestFlight", "internal testing", "each public store"]) {
      expect(d).toContain(phrase);
    }
  });

  it("3 + 4. the engine rejects a programmatic Partial and names the item", () => {
    expect(() => calculateLaunchReadiness(mobileFree("partial"))).toThrow(AssessmentValidationError);
    expect(() => calculateLaunchReadiness(mobileFree("partial"))).toThrow(
      /"Partial" is not available for lg-mobile-store-approved — answer missing or done/,
    );
  });

  it("5. Missing, as the only blocker, caps an otherwise-perfect mobile product at NOT_READY", () => {
    const r = calculateLaunchReadiness(mobileFree("missing"));
    expect(r.hardBlockers.map((b) => b.itemId)).toEqual([STORE]);
    expect(r.overallScore).toBeCloseTo(97.435897, 5);
    expect(r.verdict).toBe("NOT_READY");
  });

  it("6. Done lets the normal scoring rules apply", () => {
    const r = calculateLaunchReadiness(mobileFree("done"));
    expect(r.overallScore).toBe(100);
    expect(r.verdict).toBe("READY");
    const weak = calculateLaunchReadiness(
      build({ types: ["mobile"], paid: false, overrides: { [STORE]: "done" }, categories: { analyticsFeedback: "missing" } }),
    );
    expect(weak.verdict).toBe("LAUNCH_WITH_CAVEATS"); // ordinary category rule, not the blocker
  });

  it("7 + 8. an app that is submitted or in review can no longer be READY — it is Missing, so NOT_READY", () => {
    // v3: Partial here scored 98.72 and passed every READY rule.
    expect(() => calculateLaunchReadiness(mobileFree("partial"))).toThrow();
    expect(calculateLaunchReadiness(mobileFree("missing")).verdict).toBe("NOT_READY");
  });

  it("11. a saved Partial is not an allowed answer, so it is never scored or converted", () => {
    expect(isAnswerAllowed(item(), "partial")).toBe(false);
    expect(isAnswerAllowed(item(), "missing")).toBe(true);
    expect(isAnswerAllowed(item(), "done")).toBe(true);
  });

  it("12. other mobile items still allow Partial", () => {
    for (const id of [
      "pp-store-listing-complete",
      "oa-mobile-permission-priming",
      "rq-mobile-real-devices",
      "dp-mobile-privacy-labels",
      "pb-mobile-in-app-purchase",
      "af-mobile-store-reviews",
    ]) {
      expect(getItemById(id)?.allowPartial).toBe(true);
      expect(answerOptionsFor(getItemById(id)!).map((o) => o.value)).toContain("partial");
    }
    const r = calculateLaunchReadiness(
      build({ types: ["mobile"], paid: true, digitalInApp: true, fill: "partial", overrides: { [STORE]: "done" } }),
    );
    expect(r.hardBlockers).toEqual([]); // partial blockers still never cap
  });

  it("13. non-mobile products are unaffected", () => {
    for (const types of [["web"], ["api"], ["ai"], ["marketplace"], ["saas"]] as const) {
      expect(itemsFor(types, true).some((i) => i.id === STORE)).toBe(false);
      const r = calculateLaunchReadiness(build({ types, paid: true, fill: "partial" }));
      expect(r.overallScore).toBe(50);
    }
  });

  it("mobile IAP and live payment behave exactly as before", () => {
    const r = calculateLaunchReadiness(
      build({ types: ["mobile"], paid: true, digitalInApp: true, overrides: { "pb-mobile-in-app-purchase": "partial", "pb-live-payment-tested": "partial" } }),
    );
    expect(r.hardBlockers).toEqual([]);
    expect(answerOptionsFor(getItemById("pb-live-payment-tested")!).map((o) => o.value)).toEqual(["missing", "partial", "done"]);
  });

  it("regression: hasUserAccounts and payout applicability are unchanged", () => {
    expect(itemsFor(["saas"], true, false, false, true)).toHaveLength(44);
    expect(itemsFor(["saas"], true, false, false, false)).toHaveLength(38);
    expect(itemsFor(["marketplace"], true, false, true).some((i) => i.id === "pb-marketplace-payouts")).toBe(true);
    expect(itemsFor(["marketplace"], true, false, false).some((i) => i.id === "pb-marketplace-payouts")).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Checklist v5 (audit P0-1) — Partial hard blockers cap at NOT_READY
// -----------------------------------------------------------------------------

describe("partial hard blockers", () => {
  // Every hard blocker that still allows Partial (store approval does not).
  const PARTIAL_ABLE = [
    "pp-core-job-works",
    "oa-api-reference-docs",
    "rq-backups-enabled",
    "sa-https-everywhere",
    "sa-no-exposed-secrets",
    "sa-authorization-enforced",
    "dp-privacy-policy",
    "pb-live-payment-tested",
    "pb-mobile-in-app-purchase",
    "pb-marketplace-payouts",
  ];
  // A product where all ten apply.
  const everything = (overrides: Record<string, ChecklistAnswer> = {}) =>
    build({ types: ["mobile", "api", "marketplace", "web"], paid: true, digitalInApp: true, payouts: true, accounts: true, overrides });

  it("covers exactly the hard blockers that allow Partial", () => {
    expect(CHECKLIST_ITEMS.filter((i) => i.hardBlocker && i.allowPartial).map((i) => i.id).sort()).toEqual(
      [...PARTIAL_ABLE].sort(),
    );
  });

  it.each(PARTIAL_ABLE)("%s answered Partial caps an otherwise-perfect product at NOT_READY", (id) => {
    const r = calculateLaunchReadiness(everything({ [id]: "partial" }));
    expect(r.overallScore).toBeGreaterThan(98); // v4 called every one of these READY
    expect(r.verdict).toBe("NOT_READY");
    expect(r.hardBlockers).toEqual([]);
    expect(r.partialBlockers.map((b) => b.itemId)).toEqual([id]);
  });

  it("two partial blockers → NOT_READY, not PROTOTYPE", () => {
    const r = calculateLaunchReadiness(everything({ "sa-no-exposed-secrets": "partial", "sa-https-everywhere": "partial" }));
    expect(r.partialBlockers).toHaveLength(2);
    expect(r.verdict).toBe("NOT_READY");
  });

  it("all ten partial blockers → NOT_READY, not PROTOTYPE (v4: 87.46 READY)", () => {
    const r = calculateLaunchReadiness(everything(Object.fromEntries(PARTIAL_ABLE.map((id) => [id, "partial"]))));
    expect(r.overallScore).toBeCloseTo(87.46, 2);
    expect(r.partialBlockers).toHaveLength(10);
    expect(r.hardBlockers).toEqual([]);
    expect(r.verdict).toBe("NOT_READY");
  });

  it("one missing + one partial → NOT_READY (missing count rules unchanged)", () => {
    const r = calculateLaunchReadiness(everything({ "dp-privacy-policy": "missing", "sa-https-everywhere": "partial" }));
    expect(r.hardBlockers.map((b) => b.itemId)).toEqual(["dp-privacy-policy"]);
    expect(r.partialBlockers.map((b) => b.itemId)).toEqual(["sa-https-everywhere"]);
    expect(r.verdict).toBe("NOT_READY");
  });

  it("two missing + partials → PROTOTYPE (still missing-only)", () => {
    const r = calculateLaunchReadiness(
      everything({ "dp-privacy-policy": "missing", "sa-no-exposed-secrets": "missing", "sa-https-everywhere": "partial" }),
    );
    expect(r.verdict).toBe("PROTOTYPE");
  });

  it("partialBlockers lists only hard blockers answered Partial, in catalogue order", () => {
    const r = calculateLaunchReadiness(
      everything({
        "pb-live-payment-tested": "partial",
        "pp-core-job-works": "partial",
        "dp-privacy-policy": "missing", // missing → hardBlockers, not partialBlockers
        "rq-rollback-ready": "partial", // not a hard blocker
      }),
    );
    expect(r.partialBlockers.map((b) => b.itemId)).toEqual(["pp-core-job-works", "pb-live-payment-tested"]);
    expect(r.partialBlockers.every((b) => b.hardBlocker && !b.blocking && b.answer === "partial")).toBe(true);
    expect(r.hardBlockers.map((b) => b.itemId)).toEqual(["dp-privacy-policy"]);
  });

  it("a partial non-blocker item does not cap the verdict", () => {
    const r = calculateLaunchReadiness(everything({ "rq-rollback-ready": "partial" }));
    expect(r.partialBlockers).toEqual([]);
    expect(r.verdict).toBe("READY");
  });

  it("deriveVerdict: partial blockers cap at NOT_READY but never trigger PROTOTYPE", () => {
    expect(deriveVerdict(100, flat(100), 0)).toBe("READY"); // default: no partial blockers
    expect(deriveVerdict(100, flat(100), 0, 1)).toBe("NOT_READY");
    expect(deriveVerdict(100, flat(100), 0, 10)).toBe("NOT_READY");
    expect(deriveVerdict(100, flat(100), 1, 3)).toBe("NOT_READY");
    expect(deriveVerdict(100, flat(100), 2, 0)).toBe("PROTOTYPE");
    expect(deriveVerdict(45, flat(100), 0, 1)).toBe("PROTOTYPE"); // score rule unchanged
    expect(deriveVerdict(75, flat(100), 0, 1)).toBe("NOT_READY"); // no longer caveats
  });

  it("backups wording: Done is automated backups; restore practice moved to the action", () => {
    const b = getItemById("rq-backups-enabled")!;
    expect(b.description).toMatch(/Done means automated backups are enabled/);
    expect(b.description).toMatch(/Partial means backups are manual or only cover some of your data/);
    expect(b.description).not.toMatch(/restore/);
    expect(b.action).toMatch(/practise one restore/);
    expect(b.weight).toBe(3);
    expect(b.allowNotApplicable).toBe(true);
  });
});
