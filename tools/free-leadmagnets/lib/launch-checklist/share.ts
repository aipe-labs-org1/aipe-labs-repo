/**
 * Self-contained share links for the Founder Launch Checklist.
 *
 * A share link carries the assessment *input* in the URL fragment:
 *
 *   /tools/launch-checklist/report#r=<base64url(JSON payload)>
 *
 * The fragment is never sent to a server, so nothing is uploaded or stored.
 * The score, verdict, gaps, and actions are never encoded — the report page
 * always recomputes them with `calculateLaunchReadiness`.
 *
 * Decoding is strict and all-or-nothing: anything unexpected is "invalid",
 * and a payload from a different `CHECKLIST_VERSION` is "outdated" and is
 * never re-scored under the current rules.
 *
 * Pure module: no React, no DOM access beyond the standard `btoa`/`atob`/
 * `TextEncoder`/`TextDecoder` globals (available in browsers and Node).
 */

import { calculateLaunchReadiness } from "./calculate";
import {
  CHECKLIST_VERSION,
  ONE_LINER_MAX_LENGTH,
  PRODUCT_NAME_MAX_LENGTH,
  PRODUCT_TYPES,
  getApplicableItems,
} from "./catalogue";
import type { AssessmentInput, ChecklistAnswer, ProductType } from "./types";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Share format version. Bump only when the payload encoding itself changes. */
export const SHARE_VERSION = 1;

/** Fragment parameter holding the payload: `#r=<payload>`. */
export const SHARE_PARAM = "r";

/** Public route that renders a shared report. */
export const REPORT_PATH = "/tools/launch-checklist/report";

/** Longest fragment accepted, checked before any decoding work. */
export const MAX_FRAGMENT_LENGTH = 2000;

/**
 * Frozen, append-only encoding table: position N in the answer string always
 * means the item at index N here. It is deliberately NOT derived from the
 * catalogue, so reordering how items are displayed can never change the
 * meaning of an existing link.
 *
 * Rules:
 *   - Append new item ids at the end. Never reorder, remove, or reuse slots.
 *   - A test fails until every catalogue id appears here exactly once.
 *   - Adding an item is scoring-relevant: also bump `CHECKLIST_VERSION`.
 */
export const SHARE_ITEM_TABLE: readonly string[] = [
  "pp-core-job-works",
  "pp-value-proposition",
  "pp-public-page",
  "pp-scope-trimmed",
  "pp-store-listing-complete",
  "pp-ai-limits-stated",
  "pp-marketplace-both-sides",
  "oa-signup-fast",
  "oa-first-run-guided",
  "oa-help-contact",
  "oa-api-reference-docs",
  "oa-api-quickstart",
  "oa-mobile-permission-priming",
  "oa-ai-example-inputs",
  "oa-marketplace-supply-seeded",
  "oa-saas-team-invites",
  "rq-backups-enabled",
  "rq-separate-environments",
  "rq-monitoring-alerts",
  "rq-critical-path-tests",
  "rq-rollback-ready",
  "rq-core-screens-fast",
  "rq-mobile-real-devices",
  "rq-api-versioning",
  "rq-ai-failure-handling",
  "rq-ai-output-evaluated",
  "sa-https-everywhere",
  "sa-no-exposed-secrets",
  "sa-authorization-enforced",
  "sa-proven-auth",
  "sa-rate-limiting",
  "sa-dependency-scanning",
  "sa-api-key-management",
  "sa-ai-prompt-injection",
  "sa-ai-usage-limits",
  "sa-marketplace-report-block",
  "sa-saas-roles",
  "dp-privacy-policy",
  "dp-terms-of-service",
  "dp-data-inventory",
  "dp-account-deletion",
  "dp-cookie-consent",
  "dp-mobile-privacy-labels",
  "dp-ai-data-use-disclosed",
  "dp-saas-data-export",
  "pb-live-payment-tested",
  "pb-webhooks-verified",
  "pb-failed-payments-handled",
  "pb-receipts-tax-refunds",
  "pb-mobile-in-app-purchase",
  "pb-api-usage-metering",
  "pb-marketplace-payouts",
  "pb-saas-self-serve-plans",
  "af-activation-tracked",
  "af-traffic-sources",
  "af-feedback-channel",
  "af-metrics-review",
  "af-ai-output-rating",
  "af-api-usage-visibility",
  "af-mobile-store-reviews",
  "lg-launch-channels-chosen",
  "lg-launch-assets-ready",
  "lg-external-users-tried",
  "lg-launch-day-owner",
  "lg-contact-early-users",
  "lg-name-trademark-checked",
  "lg-seo-social-previews",
  "lg-mobile-store-approved",
  "lg-changelog-status-page",
] as const;

/** Answer → payload character, and the marker for items that do not apply. */
const ANSWER_TO_CHAR: Readonly<Record<ChecklistAnswer, string>> = {
  missing: "m",
  partial: "p",
  done: "d",
  notApplicable: "n",
};
const NOT_APPLICABLE_ITEM = "-";

/** The item whose presence in `a` encodes "pays out sellers" (see decoder). */
const PAYOUT_ITEM_ID = "pb-marketplace-payouts";

/** The item whose presence in `a` encodes "has user accounts" (see decoder). */
export const ACCOUNTS_ITEM_ID = "sa-proven-auth";
const CHAR_TO_ANSWER: ReadonlyMap<string, ChecklistAnswer> = new Map(
  (Object.entries(ANSWER_TO_CHAR) as [ChecklistAnswer, string][]).map(
    ([answer, char]) => [char, answer],
  ),
);

/** The payload's keys, in serialisation order. Decoding requires exactly these. */
const PAYLOAD_KEYS = ["v", "c", "t", "p", "d", "a", "n", "o"] as const;

const PRODUCT_TYPE_KEYS: readonly ProductType[] = PRODUCT_TYPES.map((t) => t.key);

/**
 * C0/C1 control characters (including pasted tabs) and bidirectional
 * mark/override/isolate characters. Rejecting them stops links that render
 * misleading or reordered text on our domain. The single source of truth for
 * product-text safety: the form, `encodeSharePayload`, and the decoder all use
 * `containsForbiddenText`, so the app can never create a link that later opens
 * as invalid. Written with \u escapes on purpose \u2014 keep it pure ASCII.
 */
export const FORBIDDEN_TEXT = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

/** True when the text contains a character share links reject. */
export function containsForbiddenText(value: string): boolean {
  return FORBIDDEN_TEXT.test(value);
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Share format v1, exactly as serialised. */
export interface SharePayloadV1 {
  /** Share format version. */
  v: typeof SHARE_VERSION;
  /** `CHECKLIST_VERSION` the assessment was made with. */
  c: number;
  /** Product types, in catalogue order. */
  t: ProductType[];
  /** Charges users. */
  p: 0 | 1;
  /** Sells digital goods or subscriptions inside the mobile app. */
  d: 0 | 1;
  /** One character per `SHARE_ITEM_TABLE` slot: m/p/d/n, or "-" if it does not apply. */
  a: string;
  /** Product name. */
  n: string;
  /** One-line description. */
  o: string;
}

/** Outcome of reading a shared-report fragment. */
export type ShareParseResult =
  | { status: "missing" }
  | { status: "invalid" }
  | { status: "outdated"; checklistVersion: number }
  | { status: "valid"; input: AssessmentInput };

// -----------------------------------------------------------------------------
// base64url (UTF-8)
// -----------------------------------------------------------------------------

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode base64url to UTF-8 text, or null for anything malformed. */
function fromBase64Url(encoded: string): string | null {
  if (!BASE64URL.test(encoded) || encoded.length % 4 === 1) return null;
  const padded =
    encoded.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (encoded.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Encoding
// -----------------------------------------------------------------------------

/**
 * Encode an assessment input as a base64url share payload. Pass the exact
 * input that produced the displayed result. Throws if an applicable item has
 * no answer — only complete, scored assessments can be shared — or if the
 * product name or one-liner would be rejected by `parseShareFragment`.
 */
export function encodeSharePayload(input: AssessmentInput): string {
  // Refuse text the decoder would reject, so a link can never be created that
  // later opens as "invalid". The form validates the same rule first.
  if (!isValidText(input.product.name, PRODUCT_NAME_MAX_LENGTH)) {
    throw new Error("encodeSharePayload: product name cannot be shared as a link");
  }
  if (!isValidText(input.product.oneLiner, ONE_LINER_MAX_LENGTH)) {
    throw new Error("encodeSharePayload: one-line description cannot be shared as a link");
  }

  const applicable = new Set(
    getApplicableItems({
      productTypes: input.product.productTypes,
      hasUserAccounts: input.hasUserAccounts,
      paymentsApplicable: input.paymentsApplicable,
      sellsDigitalGoodsInApp: input.sellsDigitalGoodsInApp,
      paysOutSellers: input.paysOutSellers,
    }).map((i) => i.id),
  );

  const a = SHARE_ITEM_TABLE.map((id) => {
    if (!applicable.has(id)) return NOT_APPLICABLE_ITEM;
    const answer = input.answers[id];
    if (answer === undefined) {
      throw new Error(`encodeSharePayload: missing answer for ${id}`);
    }
    return ANSWER_TO_CHAR[answer];
  }).join("");

  const selected = new Set(input.product.productTypes);
  const payload: SharePayloadV1 = {
    v: SHARE_VERSION,
    c: CHECKLIST_VERSION,
    t: PRODUCT_TYPE_KEYS.filter((k) => selected.has(k)),
    p: input.paymentsApplicable ? 1 : 0,
    d: input.sellsDigitalGoodsInApp ? 1 : 0,
    a,
    n: input.product.name,
    o: input.product.oneLiner,
  };
  return toBase64Url(JSON.stringify(payload));
}

/** Full share URL, e.g. `https://example.com/tools/launch-checklist/report#r=…`. */
export function buildShareUrl(origin: string, input: AssessmentInput): string {
  return `${origin}${REPORT_PATH}#${SHARE_PARAM}=${encodeSharePayload(input)}`;
}

// -----------------------------------------------------------------------------
// Decoding
// -----------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maxLength &&
    value === value.trim() &&
    !containsForbiddenText(value)
  );
}

const INVALID: ShareParseResult = { status: "invalid" };

/**
 * Read a shared-report fragment (`location.hash`). Accepts it with or without
 * the leading "#". Returns:
 *   - "missing"  — no fragment at all
 *   - "outdated" — well-formed, but made with a different `CHECKLIST_VERSION`
 *   - "valid"    — a complete `AssessmentInput` the scoring engine accepts
 *   - "invalid"  — anything else, with no partial data
 */
export function parseShareFragment(hash: string): ShareParseResult {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (fragment.length === 0) return { status: "missing" };
  if (fragment.length > MAX_FRAGMENT_LENGTH) return INVALID;

  // Exactly one parameter: r=<payload>.
  const prefix = `${SHARE_PARAM}=`;
  if (!fragment.startsWith(prefix)) return INVALID;
  const json = fromBase64Url(fragment.slice(prefix.length));
  if (json === null) return INVALID;

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return INVALID;
  }
  if (!isRecord(data)) return INVALID;

  // Exact key set — no missing and no extra keys.
  const keys = Object.keys(data);
  if (
    keys.length !== PAYLOAD_KEYS.length ||
    !PAYLOAD_KEYS.every((k) => Object.prototype.hasOwnProperty.call(data, k))
  ) {
    return INVALID;
  }

  if (data.v !== SHARE_VERSION) return INVALID;

  // A different checklist version is outdated, not invalid — and is never
  // re-scored, because its answers meant something under different rules.
  if (typeof data.c !== "number" || !Number.isInteger(data.c) || data.c < 1) {
    return INVALID;
  }
  if (data.c !== CHECKLIST_VERSION) {
    return { status: "outdated", checklistVersion: data.c };
  }

  // Product types: non-empty, known, no duplicates.
  const t = data.t;
  if (!Array.isArray(t) || t.length === 0) return INVALID;
  if (!t.every((x) => PRODUCT_TYPE_KEYS.includes(x as ProductType))) return INVALID;
  if (new Set(t).size !== t.length) return INVALID;
  const selected = new Set(t as ProductType[]);
  const productTypes = PRODUCT_TYPE_KEYS.filter((k) => selected.has(k));

  // Flags.
  if ((data.p !== 0 && data.p !== 1) || (data.d !== 0 && data.d !== 1)) return INVALID;
  const paymentsApplicable = data.p === 1;
  const sellsDigitalGoodsInApp = data.d === 1;
  if (sellsDigitalGoodsInApp && !(paymentsApplicable && selected.has("mobile"))) {
    return INVALID;
  }

  // Text.
  if (!isValidText(data.n, PRODUCT_NAME_MAX_LENGTH)) return INVALID;
  if (!isValidText(data.o, ONE_LINER_MAX_LENGTH)) return INVALID;

  // Answers: one character per table slot; applicable items answered,
  // everything else "-".
  const a = data.a;
  if (typeof a !== "string" || a.length !== SHARE_ITEM_TABLE.length) return INVALID;

  // "Pays out sellers" has no key of its own: for a marketplace where money
  // changes hands it is exactly whether the payout item was answered, since
  // that condition is the only thing that makes the item apply. This keeps the
  // payload structure — and so SHARE_VERSION — unchanged.
  const payoutChar = a[SHARE_ITEM_TABLE.indexOf(PAYOUT_ITEM_ID)];
  const paysOutSellers =
    paymentsApplicable && selected.has("marketplace") && payoutChar !== NOT_APPLICABLE_ITEM;

  // "Has user accounts" has no key of its own either. It is safe to derive
  // from the sa-proven-auth slot because that item applies to EVERY product
  // type and depends on nothing but `hasUserAccounts` (no payment condition,
  // no other `requires`) — so its slot is answered exactly when users sign in
  // and "-" exactly when they don't. share.test.ts pins that assumption; if
  // the item's applicability ever changes, that test fails before links can
  // silently decode wrongly. The per-slot checks below then enforce the other
  // five account items against the derived value.
  const hasUserAccounts =
    a[SHARE_ITEM_TABLE.indexOf(ACCOUNTS_ITEM_ID)] !== NOT_APPLICABLE_ITEM;

  const applicable = new Set(
    getApplicableItems({
      productTypes,
      hasUserAccounts,
      paymentsApplicable,
      sellsDigitalGoodsInApp,
      paysOutSellers,
    }).map((i) => i.id),
  );
  const answers: Record<string, ChecklistAnswer> = {};
  for (let i = 0; i < SHARE_ITEM_TABLE.length; i++) {
    const id = SHARE_ITEM_TABLE[i];
    const char = a[i];
    if (applicable.has(id)) {
      const answer = CHAR_TO_ANSWER.get(char);
      if (answer === undefined) return INVALID;
      answers[id] = answer;
    } else if (char !== NOT_APPLICABLE_ITEM) {
      return INVALID;
    }
  }

  const input: AssessmentInput = {
    product: { name: data.n, oneLiner: data.o, productTypes },
    hasUserAccounts,
    paymentsApplicable,
    sellsDigitalGoodsInApp,
    paysOutSellers,
    answers,
  };

  // Final gate: the scoring engine's own validation (e.g. a non-Payments
  // category marked entirely N/A).
  try {
    calculateLaunchReadiness(input);
  } catch {
    return INVALID;
  }

  return { status: "valid", input };
}
