import { describe, expect, it } from "vitest";

import {
  AssessmentValidationError,
  calculateLaunchReadiness,
  findFullyNotApplicableCategories,
  toApplicabilityContext,
} from "./calculate";
import { getApplicableItems } from "./catalogue";
import { SAMPLES, THREADLOOM } from "./samples";
import type { CategoryKey, ChecklistAnswer } from "./types";

describe("sample assessments", () => {
  it.each(SAMPLES.map((s) => [s.slug, s] as const))(
    "%s answers every applicable item and nothing else",
    (_slug, sample) => {
      const ids = getApplicableItems(toApplicabilityContext(sample.input)).map((i) => i.id);
      expect(Object.keys(sample.input.answers).sort()).toEqual([...ids].sort());
    },
  );

  it.each(SAMPLES.map((s) => [s.slug, s] as const))(
    "%s scores without a validation error",
    (_slug, sample) => {
      expect(() => calculateLaunchReadiness(sample.input)).not.toThrow();
    },
  );
});

describe("Threadloom sample", () => {
  const r = calculateLaunchReadiness(THREADLOOM.input);
  const pct = (key: CategoryKey) => r.categoryScores.find((c) => c.key === key)!.percent;

  it("is an AI + SaaS product that charges users", () => {
    expect(THREADLOOM.input.product.productTypes).toEqual(["ai", "saas"]);
    expect(THREADLOOM.input.paymentsApplicable).toBe(true);
  });

  it("has exactly one hard blocker — the missing privacy policy — so it is NOT_READY", () => {
    expect(r.hardBlockers.map((b) => b.itemId)).toEqual(["dp-privacy-policy"]);
    expect(r.verdict).toBe("NOT_READY");
  });

  it("shows strong positioning and gaps everywhere the brief calls for", () => {
    expect(pct("productPositioning")).toBeGreaterThanOrEqual(90);
    for (const key of [
      "onboardingActivation",
      "reliabilityQuality",
      "dataPrivacy",
      "paymentsBilling",
      "analyticsFeedback",
      "launchGtm",
    ] as const) {
      expect(pct(key)).toBeLessThan(90);
    }
  });

  it("leads its top gaps with the blocker and returns five next actions", () => {
    expect(r.topGaps[0].itemId).toBe("dp-privacy-policy");
    expect(r.nextActions).toHaveLength(5);
  });

  // Re-evaluated under checklist v2. Threadloom is not a marketplace and not
  // mobile, answers "done" to the redefined live payment test, and only uses
  // N/A on items that still allow it (team invites, roles) — so none of the P1
  // changes alter its answers, applicable items, or score.
  it("is unchanged by the checklist v2 rules: 52 items, 61.25, NOT_READY", () => {
    expect(Object.keys(THREADLOOM.input.answers)).toHaveLength(52);
    expect(THREADLOOM.input.paysOutSellers).toBe(false);
    expect(r.overallScore).toBeCloseTo(61.249854, 5);
    expect(r.displayScore).toBe(61);
  });

  // 21. Re-evaluated under checklist v3. Creators sign in, so all six account
  // items still apply; its N/A answers (team invites, roles) are on items that
  // still allow N/A — a single-creator product has accounts but no teams.
  it("21. is unchanged by the checklist v3 rules: accounts yes, 52 items, 61.25 / 61, NOT_READY", () => {
    expect(THREADLOOM.input.hasUserAccounts).toBe(true);
    const applicable = getApplicableItems(toApplicabilityContext(THREADLOOM.input));
    expect(applicable).toHaveLength(52);
    for (const id of ["oa-signup-fast", "sa-proven-auth", "dp-account-deletion", "oa-saas-team-invites", "sa-saas-roles", "dp-saas-data-export"]) {
      expect(applicable.some((i) => i.id === id)).toBe(true);
    }
    expect(r.overallScore).toBeCloseTo(61.25, 2);
    expect(r.displayScore).toBe(61);
    expect(r.verdict).toBe("NOT_READY");
  });

  // Checklist v5: none of Threadloom's hard blockers are answered Partial
  // (all Done except the missing privacy policy), so the new cap cannot touch it.
  it("is unchanged by the checklist v5 partial-blocker rule", () => {
    expect(r.partialBlockers).toEqual([]);
    expect(r.hardBlockers.map((b) => b.itemId)).toEqual(["dp-privacy-policy"]);
    expect(Object.keys(THREADLOOM.input.answers)).toHaveLength(52);
    expect(r.overallScore).toBeCloseTo(61.249854, 5);
    expect(r.displayScore).toBe(61);
    expect(r.verdict).toBe("NOT_READY");
  });
});

describe("findFullyNotApplicableCategories", () => {
  const items = getApplicableItems({
    productTypes: ["web"],
    hasUserAccounts: true,
    paymentsApplicable: true,
    sellsDigitalGoodsInApp: false,
    paysOutSellers: false,
  });
  const all = (answer: "done" | "notApplicable") =>
    Object.fromEntries(items.map((i) => [i.id, answer]));

  it("returns nothing when categories have scored answers", () => {
    expect(findFullyNotApplicableCategories(items, all("done"))).toEqual([]);
  });

  it("flags every non-Payments category when everything is N/A, and never Payments", () => {
    const flagged = findFullyNotApplicableCategories(items, all("notApplicable"));
    expect(flagged).not.toContain("paymentsBilling");
    expect(flagged).toHaveLength(7);
  });

  it("does not treat unanswered items as N/A", () => {
    const answers: Record<string, ChecklistAnswer | undefined> = all("notApplicable");
    answers["af-traffic-sources"] = undefined;
    expect(findFullyNotApplicableCategories(items, answers)).not.toContain("analyticsFeedback");
  });

  // Checklist v2: analytics items no longer allow N/A, so the engine now
  // rejects this at the first prohibited item rather than at category level.
  // Both reject it — the category helper and the engine still agree.
  it("agrees with the scoring engine's validation", () => {
    const answers = { ...THREADLOOM.input.answers };
    for (const i of getApplicableItems(toApplicabilityContext(THREADLOOM.input))) {
      if (i.category === "analyticsFeedback") answers[i.id] = "notApplicable";
    }
    const input = { ...THREADLOOM.input, answers };
    expect(
      findFullyNotApplicableCategories(getApplicableItems(toApplicabilityContext(input)), answers),
    ).toEqual(["analyticsFeedback"]);
    expect(() => calculateLaunchReadiness(input)).toThrow(AssessmentValidationError);
    expect(() => calculateLaunchReadiness(input)).toThrow(/not allowed for af-activation-tracked/);
  });
});
