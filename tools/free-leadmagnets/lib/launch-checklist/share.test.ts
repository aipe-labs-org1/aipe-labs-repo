import { describe, expect, it } from "vitest";

import { createHash } from "node:crypto";

import { calculateLaunchReadiness } from "./calculate";
import {
  CHECKLIST_ITEMS,
  CHECKLIST_VERSION,
  PRODUCT_TYPES,
  getApplicableItems,
  getItemById,
  isAnswerAllowed,
} from "./catalogue";
import { THREADLOOM } from "./samples";
import {
  ACCOUNTS_ITEM_ID,
  FORBIDDEN_TEXT,
  MAX_FRAGMENT_LENGTH,
  containsForbiddenText,
  REPORT_PATH,
  SHARE_ITEM_TABLE,
  SHARE_VERSION,
  buildShareUrl,
  encodeSharePayload,
  parseShareFragment,
  type SharePayloadV1,
} from "./share";
import type { AssessmentInput, ChecklistAnswer, ProductType } from "./types";

// -----------------------------------------------------------------------------
// Fixtures / helpers
// -----------------------------------------------------------------------------

const CYCLE: readonly ChecklistAnswer[] = ["missing", "partial", "done", "notApplicable"];

/** The six items controlled by `hasUserAccounts` (checklist v3). */
const ACCOUNT_ITEMS = [
  "oa-signup-fast",
  "sa-proven-auth",
  "dp-account-deletion",
  "oa-saas-team-invites",
  "sa-saas-roles",
  "dp-saas-data-export",
] as const;

/** sha256 of the original 69 table slots, joined with ",". Never update for a reorder. */
const V1_TABLE_FINGERPRINT = "bf5ae74873c96a6f6f6086e47437a8cdb7a8d04510f401240a4a2d2841a14b43";
const ALL_TYPES: readonly ProductType[] = PRODUCT_TYPES.map((t) => t.key);

/**
 * A complete input where answers cycle missing → partial → done → N/A through
 * the applicable items. Items in one category are consecutive, so no category
 * is ever entirely N/A. `offset` varies which answer each item gets. Items
 * that do not allow N/A (checklist v2) get "done" in its place.
 *
 * `payouts` is only kept for a paid marketplace, matching what the UI sends.
 * `accounts` defaults to true (users sign in), which reproduces the v2 list.
 */
function inputFor(
  types: readonly ProductType[],
  paid: boolean,
  digital: boolean,
  offset = 0,
  fill?: ChecklistAnswer,
  payouts = false,
  accounts = true,
): AssessmentInput & { answers: Record<string, ChecklistAnswer> } {
  const paysOutSellers = payouts && paid && types.includes("marketplace");
  const items = getApplicableItems({
    productTypes: types,
    hasUserAccounts: accounts,
    paymentsApplicable: paid,
    sellsDigitalGoodsInApp: digital,
    paysOutSellers,
  });
  return {
    product: {
      name: "Test product",
      oneLiner: "A product used to test share links.",
      productTypes: ALL_TYPES.filter((t) => types.includes(t)),
    },
    hasUserAccounts: accounts,
    paymentsApplicable: paid,
    sellsDigitalGoodsInApp: digital,
    paysOutSellers,
    answers: Object.fromEntries(
      items.map((item, i) => {
        const answer = fill ?? CYCLE[(i + offset) % CYCLE.length];
        return [item.id, isAnswerAllowed(item, answer) ? answer : "done"];
      }),
    ),
  };
}

/** Every non-empty subset of product types (63). */
function allTypeCombinations(): ProductType[][] {
  const combos: ProductType[][] = [];
  for (let mask = 1; mask < 1 << ALL_TYPES.length; mask++) {
    combos.push(ALL_TYPES.filter((_, i) => mask & (1 << i)));
  }
  return combos;
}

function fragmentFor(input: AssessmentInput): string {
  return `#r=${encodeSharePayload(input)}`;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodePayload(input: AssessmentInput): SharePayloadV1 {
  const b64 = encodeSharePayload(input).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
}

/** A valid payload object to mutate in rejection tests. */
function validPayload(): Record<string, unknown> {
  return { ...decodePayload(THREADLOOM.input) };
}

/** Encode an arbitrary object (bypassing type checks) as a fragment. */
function fragmentOf(payload: unknown): string {
  return `#r=${toBase64Url(JSON.stringify(payload))}`;
}

function expectRoundTrip(input: AssessmentInput) {
  const parsed = parseShareFragment(fragmentFor(input));
  expect(parsed.status).toBe("valid");
  if (parsed.status !== "valid") return;
  expect(parsed.input).toEqual(input);
  expect(calculateLaunchReadiness(parsed.input)).toEqual(calculateLaunchReadiness(input));
}

// -----------------------------------------------------------------------------
// Frozen table / catalogue stability
// -----------------------------------------------------------------------------

describe("SHARE_ITEM_TABLE — catalogue stability", () => {
  // If this fails after adding a checklist item: append its id to the END of
  // SHARE_ITEM_TABLE (never reorder or reuse slots) and decide whether to bump
  // CHECKLIST_VERSION — adding an item is scoring-relevant, so it should.
  it("contains every catalogue id exactly once", () => {
    expect(new Set(SHARE_ITEM_TABLE).size).toBe(SHARE_ITEM_TABLE.length);
    expect([...SHARE_ITEM_TABLE].sort()).toEqual(CHECKLIST_ITEMS.map((i) => i.id).sort());
  });

  it("has exactly one slot per catalogue item", () => {
    expect(SHARE_ITEM_TABLE.length).toBe(CHECKLIST_ITEMS.length);
    expect(SHARE_ITEM_TABLE.length).toBe(69);
  });
});

// -----------------------------------------------------------------------------
// Round trips
// -----------------------------------------------------------------------------

describe("round trips — encode → parse → recompute gives the same result", () => {
  it.each(allTypeCombinations().map((c) => [c.join("+"), c] as const))(
    "%s (free, paid, and paid + digital goods where mobile)",
    (_label, types) => {
      expectRoundTrip(inputFor(types, false, false));
      expectRoundTrip(inputFor(types, true, false, 1));
      if (types.includes("mobile")) expectRoundTrip(inputFor(types, true, true, 2));
      if (types.includes("marketplace")) expectRoundTrip(inputFor(types, true, false, 3, undefined, true));
      // Without user accounts (checklist v3).
      expectRoundTrip(inputFor(types, false, false, 1, undefined, false, false));
      expectRoundTrip(inputFor(types, true, false, 2, undefined, false, false));
    },
  );

  it("17. with accounts — the account items round-trip", () => {
    const input = inputFor(["saas"], true, false);
    for (const id of ACCOUNT_ITEMS) expect(input.answers[id]).toBeDefined();
    expectRoundTrip(input);
  });

  it("18. without accounts — no account items, and the flag round-trips as false", () => {
    const input = inputFor(["web", "saas"], true, false, 0, undefined, false, false);
    for (const id of ACCOUNT_ITEMS) expect(input.answers[id]).toBeUndefined();
    expect(input.answers["sa-authorization-enforced"]).toBeDefined();
    expectRoundTrip(input);
  });

  it("free product", () => expectRoundTrip(inputFor(["web"], false, false)));
  it("paid product", () => expectRoundTrip(inputFor(["web"], true, false)));
  it("mobile with digital goods includes the in-app purchase item", () => {
    const input = inputFor(["mobile"], true, true);
    expect(input.answers["pb-mobile-in-app-purchase"]).toBeDefined();
    expectRoundTrip(input);
  });
  it("mobile without digital goods", () => {
    const input = inputFor(["mobile"], true, false);
    expect(input.answers["pb-mobile-in-app-purchase"]).toBeUndefined();
    expectRoundTrip(input);
  });
  it("Threadloom sample", () => expectRoundTrip(THREADLOOM.input));
  it("all answers done", () => expectRoundTrip(inputFor(ALL_TYPES, true, true, 0, "done", true)));
  it("all answers missing", () => expectRoundTrip(inputFor(ALL_TYPES, true, true, 0, "missing", true)));
  // Checklist v2: the live payment test no longer allows N/A, so this uses
  // every payment and SaaS item that still does.
  it("N/A answers on every item that allows them", () => {
    const input = inputFor(["saas"], true, false);
    for (const id of [
      "pb-webhooks-verified",
      "pb-failed-payments-handled",
      "pb-saas-self-serve-plans",
      "oa-saas-team-invites",
      "sa-saas-roles",
    ]) {
      input.answers[id] = "notApplicable";
    }
    expectRoundTrip(input);
  });
  it("marketplace that pays sellers", () => {
    const input = inputFor(["marketplace"], true, false, 0, undefined, true);
    expect(input.answers["pb-marketplace-payouts"]).toBeDefined();
    expectRoundTrip(input);
  });
  it("marketplace where money changes hands but sellers are not paid out", () => {
    const input = inputFor(["marketplace"], true, false);
    expect(input.answers["pb-marketplace-payouts"]).toBeUndefined();
    expectRoundTrip(input);
  });
  it("non-ASCII product text", () => {
    const input = { ...THREADLOOM.input, product: { ...THREADLOOM.input.product, name: "Fil d'Ariane — 线程 🚀", oneLiner: "Crée des fils à partir d'articles « longs »." } };
    expectRoundTrip(input);
  });
});

// -----------------------------------------------------------------------------
// Payload correctness
// -----------------------------------------------------------------------------

describe("payload correctness", () => {
  const payload = decodePayload(THREADLOOM.input);

  it("contains exactly the v1 keys, in order, and no results", () => {
    expect(Object.keys(payload)).toEqual(["v", "c", "t", "p", "d", "a", "n", "o"]);
    const json = JSON.stringify(payload);
    for (const field of ["score", "verdict", "categoryScores", "topGaps", "nextActions", "hardBlockers"]) {
      expect(json).not.toContain(field);
    }
  });

  it("carries the version fields", () => {
    expect(payload.v).toBe(SHARE_VERSION);
    expect(payload.c).toBe(CHECKLIST_VERSION);
  });

  it("encodes one answer character per table slot, '-' for items that do not apply", () => {
    expect(payload.a).toHaveLength(SHARE_ITEM_TABLE.length);
    expect(payload.a).toMatch(/^[mpdn-]+$/);
    const i = SHARE_ITEM_TABLE.indexOf("dp-privacy-policy");
    expect(payload.a[i]).toBe("m"); // Threadloom's hard blocker
    expect(payload.a[SHARE_ITEM_TABLE.indexOf("oa-api-quickstart")]).toBe("-"); // API only
  });

  it("keeps the product name and description", () => {
    expect(payload.n).toBe("Threadloom");
    expect(payload.o).toBe(THREADLOOM.input.product.oneLiner);
  });

  it("encodes flags and types compactly", () => {
    expect(payload.t).toEqual(["ai", "saas"]);
    expect(payload.p).toBe(1);
    expect(payload.d).toBe(0);
  });

  it("builds a report URL with the payload in the fragment, never the query", () => {
    const url = buildShareUrl("https://tools.example", THREADLOOM.input);
    expect(url.startsWith(`https://tools.example${REPORT_PATH}#r=`)).toBe(true);
    expect(url).not.toContain("?");
    expect(parseShareFragment(new URL(url).hash).status).toBe("valid");
  });

  it("stays well under the fragment limit in the worst case", () => {
    const worst = inputFor(ALL_TYPES, true, true, 0, undefined, true);
    worst.product = { name: "🚀".repeat(40), oneLiner: "🚀".repeat(100), productTypes: worst.product.productTypes };
    const fragment = fragmentFor(worst);
    expect(fragment.length).toBeLessThan(MAX_FRAGMENT_LENGTH);
    expect(parseShareFragment(fragment).status).toBe("valid");
  });

  it("refuses to encode an incomplete assessment", () => {
    const input = inputFor(["web"], false, false);
    delete input.answers["dp-privacy-policy"];
    expect(() => encodeSharePayload(input)).toThrow(/dp-privacy-policy/);
  });
});

// -----------------------------------------------------------------------------
// Outdated
// -----------------------------------------------------------------------------

describe("versioning (checklist v5)", () => {
  it("the checklist version is 5 and the share format is still 1", () => {
    expect(CHECKLIST_VERSION).toBe(5);
    expect(SHARE_VERSION).toBe(1);
  });

  it("new links record checklist version 5 in share format 1", () => {
    const payload = decodePayload(THREADLOOM.input);
    expect(payload.v).toBe(1);
    expect(payload.c).toBe(5);
    expect(parseShareFragment(fragmentFor(THREADLOOM.input)).status).toBe("valid");
  });

  it("a link made under checklist version 4 is outdated, not re-scored", () => {
    expect(parseShareFragment(fragmentOf({ ...validPayload(), c: 4 }))).toEqual({
      status: "outdated",
      checklistVersion: 4,
    });
  });

  it("the real v4 Threadloom link from the store-approval checkpoint is outdated", () => {
    // Created by "Copy share link" under checklist version 4.
    const v4 =
      "#r=eyJ2IjoxLCJjIjo0LCJ0IjpbImFpIiwic2FhcyJdLCJwIjoxLCJkIjowLCJhIjoiZGRkZC1wLWRtcC0tLXAtbmRwbXBkZC0tbXBkZGRkcG0tcGQtbm1wcHBkLXBkZGRtcC0tLXBwbWRtbS0tZHBwbWRtZC1tIiwibiI6IlRocmVhZGxvb20iLCJvIjoiVHVybiBsb25nLWZvcm0gYmxvZyBwb3N0cyBpbnRvIHJlYWR5LXRvLXB1Ymxpc2ggc29jaWFsIHRocmVhZHMuIn0";
    expect(parseShareFragment(v4)).toEqual({ status: "outdated", checklistVersion: 4 });
  });

  it("10. a link made under checklist version 3 is outdated, not re-scored", () => {
    expect(parseShareFragment(fragmentOf({ ...validPayload(), c: 3 }))).toEqual({
      status: "outdated",
      checklistVersion: 3,
    });
  });

  it("10. the real v3 Threadloom link from the P2 accounts checkpoint is outdated", () => {
    // Created by "Copy share link" under checklist version 3.
    const v3 =
      "#r=eyJ2IjoxLCJjIjozLCJ0IjpbImFpIiwic2FhcyJdLCJwIjoxLCJkIjowLCJhIjoiZGRkZC1wLWRtcC0tLXAtbmRwbXBkZC0tbXBkZGRkcG0tcGQtbm1wcHBkLXBkZGRtcC0tLXBwbWRtbS0tZHBwbWRtZC1tIiwibiI6IlRocmVhZGxvb20iLCJvIjoiVHVybiBsb25nLWZvcm0gYmxvZyBwb3N0cyBpbnRvIHJlYWR5LXRvLXB1Ymxpc2ggc29jaWFsIHRocmVhZHMuIn0";
    expect(parseShareFragment(v3)).toEqual({ status: "outdated", checklistVersion: 3 });
  });

  it("a link made under checklist version 2 is outdated, not re-scored", () => {
    expect(parseShareFragment(fragmentOf({ ...validPayload(), c: 2 }))).toEqual({
      status: "outdated",
      checklistVersion: 2,
    });
  });

  it("the real v2 Threadloom link from the P1 checkpoint is outdated", () => {
    // Created by "Copy share link" under checklist version 2.
    const v2 =
      "#r=eyJ2IjoxLCJjIjoyLCJ0IjpbImFpIiwic2FhcyJdLCJwIjoxLCJkIjowLCJhIjoiZGRkZC1wLWRtcC0tLXAtbmRwbXBkZC0tbXBkZGRkcG0tcGQtbm1wcHBkLXBkZGRtcC0tLXBwbWRtbS0tZHBwbWRtZC1tIiwibiI6IlRocmVhZGxvb20iLCJvIjoiVHVybiBsb25nLWZvcm0gYmxvZyBwb3N0cyBpbnRvIHJlYWR5LXRvLXB1Ymxpc2ggc29jaWFsIHRocmVhZHMuIn0";
    expect(parseShareFragment(v2)).toEqual({ status: "outdated", checklistVersion: 2 });
  });

  it("a link made under checklist version 1 is outdated, not re-scored", () => {
    expect(parseShareFragment(fragmentOf({ ...validPayload(), c: 1 }))).toEqual({
      status: "outdated",
      checklistVersion: 1,
    });
  });

  it("the real v1 Threadloom link from the previous checkpoint is outdated", () => {
    // Created by "Copy share link" under checklist version 1.
    const v1 =
      "#r=eyJ2IjoxLCJjIjoxLCJ0IjpbImFpIiwic2FhcyJdLCJwIjoxLCJkIjowLCJhIjoiZGRkZC1wLWRtcC0tLXAtbmRwbXBkZC0tbXBkZGRkcG0tcGQtbm1wcHBkLXBkZGRtcC0tLXBwbWRtbS0tZHBwbWRtZC1tIiwibiI6IlRocmVhZGxvb20iLCJvIjoiVHVybiBsb25nLWZvcm0gYmxvZyBwb3N0cyBpbnRvIHJlYWR5LXRvLXB1Ymxpc2ggc29jaWFsIHRocmVhZHMuIn0";
    expect(parseShareFragment(v1)).toEqual({ status: "outdated", checklistVersion: 1 });
  });

  it("keeps the payload keys unchanged — no key was added for payouts or accounts", () => {
    for (const accounts of [true, false]) {
      const payload = decodePayload(inputFor(["marketplace"], true, false, 0, undefined, true, accounts));
      expect(Object.keys(payload)).toEqual(["v", "c", "t", "p", "d", "a", "n", "o"]);
    }
  });

  it("derives paysOutSellers from whether the payout item was answered", () => {
    const paying = parseShareFragment(fragmentFor(inputFor(["marketplace"], true, false, 0, undefined, true)));
    const notPaying = parseShareFragment(fragmentFor(inputFor(["marketplace"], true, false)));
    expect(paying.status === "valid" && paying.input.paysOutSellers).toBe(true);
    expect(notPaying.status === "valid" && notPaying.input.paysOutSellers).toBe(false);
  });

  it("derives hasUserAccounts from whether sa-proven-auth was answered", () => {
    const withAccounts = parseShareFragment(fragmentFor(inputFor(["web"], false, false)));
    const without = parseShareFragment(fragmentFor(inputFor(["web"], false, false, 0, undefined, false, false)));
    expect(withAccounts.status === "valid" && withAccounts.input.hasUserAccounts).toBe(true);
    expect(without.status === "valid" && without.input.hasUserAccounts).toBe(false);
  });

  it("never reorders the first 69 slots of the share table", () => {
    // Pinned so a reorder, removal, or renamed id fails loudly. Appending new
    // ids after slot 69 does not change this fingerprint.
    const fingerprint = createHash("sha256").update(SHARE_ITEM_TABLE.slice(0, 69).join(",")).digest("hex");
    expect(fingerprint).toBe(V1_TABLE_FINGERPRINT);
  });
});

describe("19. sa-proven-auth derivation assumption", () => {
  // The decoder derives hasUserAccounts from the sa-proven-auth slot. That is
  // only safe while sa-proven-auth applies to every product type and depends
  // on nothing but hasUserAccounts. If either stops being true, these tests
  // fail before any link can decode wrongly.
  const item = getItemById(ACCOUNTS_ITEM_ID)!;

  it("uses sa-proven-auth, a Security & auth item in the frozen table", () => {
    expect(ACCOUNTS_ITEM_ID).toBe("sa-proven-auth");
    expect(SHARE_ITEM_TABLE).toContain(ACCOUNTS_ITEM_ID);
    expect(item.category).toBe("securityAuth"); // never excluded like Payments
  });

  it("is declared for every product type and requires only hasUserAccounts", () => {
    expect([...item.applicableProductTypes].sort()).toEqual([...ALL_TYPES].sort());
    expect(item.requires).toBe("hasUserAccounts");
  });

  it.each(ALL_TYPES.map((t) => [t] as const))(
    "%s: present with accounts, absent without, whatever the other flags",
    (type) => {
      for (const paid of [true, false]) {
        for (const digital of [true, false]) {
          for (const payouts of [true, false]) {
            const ctx = { productTypes: [type], paymentsApplicable: paid, sellsDigitalGoodsInApp: digital, paysOutSellers: payouts };
            const on = getApplicableItems({ ...ctx, hasUserAccounts: true }).some((i) => i.id === ACCOUNTS_ITEM_ID);
            const off = getApplicableItems({ ...ctx, hasUserAccounts: false }).some((i) => i.id === ACCOUNTS_ITEM_ID);
            expect(on).toBe(true);
            expect(off).toBe(false);
          }
        }
      }
    },
  );
});

describe("share-safe product text (audit P1-1)", () => {
  it.each([
    ["tab", "Thread\tloom"],
    ["newline", "Thread\nloom"],
    ["NUL", "Thread\u0000loom"],
    ["unit separator U+001F", "Thread\u001Floom"],
    ["DEL", "Thread\u007Floom"],
    ["C1 NEL U+0085", "Thread\u0085loom"],
    ["C1 U+009F", "Thread\u009Floom"],
    ["LRM U+200E", "Thread‎loom"],
    ["RLM U+200F", "‏מוצר‏"],
    ["LRE U+202A", "Thread‪loom"],
    ["RLO U+202E", "Thread‮loom"],
    ["LRI U+2066", "Thread⁦loom"],
    ["PDI U+2069", "Thread⁩loom"],
  ])("rejects %s", (_label, text) => {
    expect(containsForbiddenText(text)).toBe(true);
    expect(FORBIDDEN_TEXT.test(text)).toBe(true);
  });

  it.each([
    ["plain ASCII", "Threadloom"],
    ["accented Latin", "Café Crème"],
    ["CJK and emoji", "線程 🚀"],
    ["Hebrew without marks", "מוצר חדש"],
    ["space U+0020 (just above the C0 range)", "Thread loom"],
    ["no-break space U+00A0 (just above C1)", "Thread loom"],
    ["zero-width joiner U+200D (emoji sequences)", "👩‍💻"],
    ["hyphen U+2010 (just above the marks)", "Thread‐loom"],
    ["U+2065 and U+206A (either side of the isolates)", "a⁥b⁪c"],
  ])("accepts %s", (_label, text) => {
    expect(containsForbiddenText(text)).toBe(false);
  });

  it("FORBIDDEN_TEXT is written with \\u escapes — its source is pure ASCII", () => {
    expect([...FORBIDDEN_TEXT.source].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
    expect(FORBIDDEN_TEXT.source).toBe("[\\u0000-\\u001F\\u007F-\\u009F\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]");
  });

  it.each([
    ["a pasted tab in the name", { name: "Thread\tloom" }],
    ["an RLM in the name", { name: "Thread‏loom" }],
    ["a tab in the one-liner", { oneLiner: "Turn posts\tinto threads." }],
    ["a bidi override in the one-liner", { oneLiner: "Turn posts ‮into threads." }],
    ["an empty name", { name: "" }],
    ["an untrimmed name", { name: " Threadloom" }],
    ["a name over 80 characters", { name: "x".repeat(81) }],
    ["a one-liner over 200 characters", { oneLiner: "y".repeat(201) }],
  ])("encodeSharePayload refuses %s instead of creating a link that opens as invalid", (_label, patch) => {
    const input = { ...THREADLOOM.input, product: { ...THREADLOOM.input.product, ...patch } };
    expect(() => encodeSharePayload(input)).toThrow(/cannot be shared as a link/);
  });

  it("everything encodeSharePayload accepts, parseShareFragment accepts", () => {
    for (const name of ["Threadloom", "Café Crème", "線程 🚀", "מוצר חדש", "👩‍💻"]) {
      const input = { ...THREADLOOM.input, product: { ...THREADLOOM.input.product, name } };
      expect(parseShareFragment(fragmentFor(input)).status).toBe("valid");
    }
  });
});

describe("9. store approval has no Partial in share links (checklist v4)", () => {
  const STORE = "lg-mobile-store-approved";
  const mobile = () => decodePayload(inputFor(["mobile"], true, true, 0, "done"));
  const withStoreChar = (char: string) => {
    const p = mobile();
    const a = p.a.split("");
    a[SHARE_ITEM_TABLE.indexOf(STORE)] = char;
    return fragmentOf({ ...p, a: a.join("") });
  };

  it("a payload with 'p' in the store-approval slot is invalid", () => {
    expect(parseShareFragment(withStoreChar("p"))).toEqual({ status: "invalid" });
  });

  it("'m' and 'd' in the store-approval slot are still valid", () => {
    expect(parseShareFragment(withStoreChar("m")).status).toBe("valid");
    expect(parseShareFragment(withStoreChar("d")).status).toBe("valid");
  });

  it("'p' on other mobile items is still valid", () => {
    const p = mobile();
    const a = p.a.split("");
    for (const id of ["pp-store-listing-complete", "rq-mobile-real-devices", "dp-mobile-privacy-labels", "pb-mobile-in-app-purchase"]) {
      a[SHARE_ITEM_TABLE.indexOf(id)] = "p";
    }
    expect(parseShareFragment(fragmentOf({ ...p, a: a.join("") })).status).toBe("valid");
  });
});

describe("rejects tampered account slots as invalid", () => {
  const slot = (id: string) => SHARE_ITEM_TABLE.indexOf(id);

  it("an account item answered while sa-proven-auth is '-' (no accounts)", () => {
    const p = decodePayload(inputFor(["saas"], true, false, 0, undefined, false, false));
    const a = p.a.split("");
    a[slot("dp-account-deletion")] = "d";
    expect(parseShareFragment(fragmentOf({ ...p, a: a.join("") }))).toEqual({ status: "invalid" });
  });

  it("sa-proven-auth answered but another account item left as '-'", () => {
    const p = decodePayload(inputFor(["saas"], true, false));
    const a = p.a.split("");
    a[slot("dp-account-deletion")] = "-";
    expect(parseShareFragment(fragmentOf({ ...p, a: a.join("") }))).toEqual({ status: "invalid" });
  });

  it.each(["sa-proven-auth", "dp-account-deletion"])("'n' on %s when users sign in", (id) => {
    const p = decodePayload(inputFor(["web"], true, false));
    const a = p.a.split("");
    a[slot(id)] = "n";
    expect(parseShareFragment(fragmentOf({ ...p, a: a.join("") }))).toEqual({ status: "invalid" });
  });
});

describe("outdated checklist versions", () => {
  it.each([CHECKLIST_VERSION + 1, CHECKLIST_VERSION + 10])(
    "checklist version %i is outdated — no input, no result",
    (c) => {
      const parsed = parseShareFragment(fragmentOf({ ...validPayload(), c }));
      expect(parsed).toEqual({ status: "outdated", checklistVersion: c });
      expect(parsed).not.toHaveProperty("input");
    },
  );

  it("is outdated even when the old answers would not fit the current table", () => {
    const parsed = parseShareFragment(fragmentOf({ ...validPayload(), c: CHECKLIST_VERSION + 1, a: "dddd" }));
    expect(parsed.status).toBe("outdated");
  });
});

// -----------------------------------------------------------------------------
// Rejections
// -----------------------------------------------------------------------------

describe("missing fragment", () => {
  it.each(["", "#"])("%j is missing", (hash) => {
    expect(parseShareFragment(hash)).toEqual({ status: "missing" });
  });
});

describe("rejects malformed fragments as invalid", () => {
  const payload = encodeSharePayload(THREADLOOM.input);

  it.each([
    ["missing r", "#x=abc"],
    ["empty r", "#r="],
    ["r without =", `#r${payload}`],
    ["extra parameter", `#r=${payload}&x=1`],
    ["query-style prefix", `#?r=${payload}`],
    ["invalid base64url characters", "#r=abc$def"],
    ["standard base64 characters", `#r=${payload.slice(0, 20)}+/==`],
    ["impossible base64 length", "#r=abcde"],
    ["not JSON", `#r=${toBase64Url("not json")}`],
    ["truncated JSON", `#r=${toBase64Url("{\"v\":1,")}`],
    ["invalid UTF-8", `#r=${btoa("\xff\xfe\xfd").replace(/=+$/, "")}`],
    ["JSON array", fragmentOf([1, 2])],
    ["JSON null", fragmentOf(null)],
    ["JSON number", fragmentOf(1)],
  ])("%s", (_why, hash) => {
    expect(parseShareFragment(hash)).toEqual({ status: "invalid" });
  });

  it("an oversized fragment, before decoding", () => {
    expect(parseShareFragment(`#r=${"A".repeat(MAX_FRAGMENT_LENGTH)}`)).toEqual({ status: "invalid" });
  });

  it("an oversized fragment even if it would decode", () => {
    const big = fragmentOf({ ...validPayload(), pad: "x".repeat(MAX_FRAGMENT_LENGTH) });
    expect(big.length).toBeGreaterThan(MAX_FRAGMENT_LENGTH);
    expect(parseShareFragment(big)).toEqual({ status: "invalid" });
  });
});

describe("rejects invalid payload contents as invalid", () => {
  const without = (key: string) => {
    const p = validPayload();
    delete p[key];
    return p;
  };
  const answersWith = (id: string, char: string) => {
    const a = (validPayload().a as string).split("");
    a[SHARE_ITEM_TABLE.indexOf(id)] = char;
    return a.join("");
  };

  it.each([
    ["missing share version", without("v")],
    ["wrong share version", { ...validPayload(), v: 2 }],
    ["string share version", { ...validPayload(), v: "1" }],
    ["missing checklist version", without("c")],
    ["non-integer checklist version", { ...validPayload(), c: 1.5 }],
    ["zero checklist version", { ...validPayload(), c: 0 }],
    ["string checklist version", { ...validPayload(), c: "1" }],
    ["extra key", { ...validPayload(), score: 100 }],
    ["missing name key", without("n")],
    ["missing types key", without("t")],
    ["unknown product type", { ...validPayload(), t: ["ai", "desktop"] }],
    ["empty product types", { ...validPayload(), t: [] }],
    ["product types not an array", { ...validPayload(), t: "ai" }],
    ["duplicate product types", { ...validPayload(), t: ["ai", "saas", "ai"] }],
    ["charging flag not 0/1", { ...validPayload(), p: 2 }],
    ["charging flag boolean", { ...validPayload(), p: true }],
    ["digital flag not 0/1", { ...validPayload(), d: "1" }],
    ["digital goods without mobile", { ...validPayload(), d: 1 }],
    ["answers too short", { ...validPayload(), a: (validPayload().a as string).slice(1) }],
    ["answers too long", { ...validPayload(), a: `${validPayload().a}d` }],
    ["answers not a string", { ...validPayload(), a: ["d"] }],
    ["invalid answer character", { ...validPayload(), a: answersWith("pp-core-job-works", "x") }],
    ["uppercase answer character", { ...validPayload(), a: answersWith("pp-core-job-works", "D") }],
    ["'-' for an applicable item", { ...validPayload(), a: answersWith("dp-privacy-policy", "-") }],
    ["an answer for a non-applicable item", { ...validPayload(), a: answersWith("oa-api-quickstart", "d") }],
    ["name not a string", { ...validPayload(), n: 42 }],
    ["empty name", { ...validPayload(), n: "" }],
    ["name over 80 characters", { ...validPayload(), n: "x".repeat(81) }],
    ["name with surrounding whitespace", { ...validPayload(), n: " Threadloom" }],
    ["name with a control character", { ...validPayload(), n: "Thread\u0000loom" }],
    ["name with a bidi override", { ...validPayload(), n: "Thread‮loom" }],
    ["description not a string", { ...validPayload(), o: null }],
    ["empty description", { ...validPayload(), o: "" }],
    ["description over 200 characters", { ...validPayload(), o: "y".repeat(201) }],
    ["description with a newline", { ...validPayload(), o: "Line one\nline two" }],
    ["description with a tab", { ...validPayload(), o: "Tab\there" }],
  ])("%s", (_why, payload) => {
    expect(parseShareFragment(fragmentOf(payload))).toEqual({ status: "invalid" });
  });

  it("digital goods on a free mobile product", () => {
    const input = inputFor(["mobile"], false, false);
    const p = { ...decodePayload(input), d: 1 };
    expect(parseShareFragment(fragmentOf(p))).toEqual({ status: "invalid" });
  });

  it("digital-goods answers missing when d = 1 on a paid mobile product", () => {
    const input = inputFor(["mobile"], true, false);
    const p = { ...decodePayload(input), d: 1 }; // IAP item now applicable but encoded "-"
    expect(parseShareFragment(fragmentOf(p))).toEqual({ status: "invalid" });
  });

  // Checklist v2: rejected by the scoring engine's per-item N/A rule.
  it("a non-Payments category marked entirely N/A (scoring-engine validation)", () => {
    const p = validPayload();
    const a = (p.a as string).split("");
    SHARE_ITEM_TABLE.forEach((id, i) => {
      if (id.startsWith("af-") && a[i] !== "-") a[i] = "n";
    });
    expect(parseShareFragment(fragmentOf({ ...p, a: a.join("") }))).toEqual({ status: "invalid" });
  });

  it("'n' on a single item that does not allow N/A", () => {
    const p = validPayload();
    const a = (p.a as string).split("");
    a[SHARE_ITEM_TABLE.indexOf("sa-https-everywhere")] = "n";
    expect(parseShareFragment(fragmentOf({ ...p, a: a.join("") }))).toEqual({ status: "invalid" });
  });

  it("a payout answer on a product that is not a marketplace", () => {
    const p = validPayload(); // Threadloom: AI + SaaS
    const a = (p.a as string).split("");
    a[SHARE_ITEM_TABLE.indexOf("pb-marketplace-payouts")] = "d";
    expect(parseShareFragment(fragmentOf({ ...p, a: a.join("") }))).toEqual({ status: "invalid" });
  });

  it("a payout answer on a free marketplace", () => {
    const free = decodePayload(inputFor(["marketplace"], false, false));
    const a = free.a.split("");
    a[SHARE_ITEM_TABLE.indexOf("pb-marketplace-payouts")] = "d";
    expect(parseShareFragment(fragmentOf({ ...free, a: a.join("") }))).toEqual({ status: "invalid" });
  });

  it("'n' on the payout item for a marketplace that pays sellers", () => {
    const paying = decodePayload(inputFor(["marketplace"], true, false, 0, undefined, true));
    const a = paying.a.split("");
    a[SHARE_ITEM_TABLE.indexOf("pb-marketplace-payouts")] = "n";
    expect(parseShareFragment(fragmentOf({ ...paying, a: a.join("") }))).toEqual({ status: "invalid" });
  });

  it("the same content is valid before tampering (control)", () => {
    expect(parseShareFragment(fragmentOf(validPayload())).status).toBe("valid");
  });
});
