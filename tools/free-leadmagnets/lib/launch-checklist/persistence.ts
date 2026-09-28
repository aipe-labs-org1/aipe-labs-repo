/**
 * Browser persistence for the Founder Launch Checklist form.
 *
 * Saves only what the user typed or selected — never the calculated result,
 * which is always re-derived by the pure scoring engine. Every function here
 * is defensive: storage may be missing (server rendering, privacy modes),
 * may throw (quota, disabled storage), or may hold data written by an older
 * or tampered build. None of those cases may crash the page.
 */

import { CHECKLIST_ITEMS, PRODUCT_TYPES } from "./catalogue";
import type { ChecklistAnswer, ProductType } from "./types";

/** Versioned key. Bump the suffix (and `STORAGE_VERSION`) on breaking changes. */
export const STORAGE_KEY = "aipe-launch-checklist:v1";
export const STORAGE_VERSION = 1;

/** Field limits, matching the form's `maxLength` attributes. */
const NAME_MAX = 80;
const ONE_LINER_MAX = 200;

export type YesNo = "yes" | "no";

/** Everything needed to restore the form exactly. No results, no scores. */
export interface SavedChecklistState {
  name: string;
  oneLiner: string;
  productTypes: ProductType[];
  /** "Do people sign in to use your product?" — added in checklist v3. */
  hasUserAccounts: YesNo | null;
  charges: YesNo | null;
  sellsDigital: YesNo | null;
  /** "Does your marketplace pay sellers or providers?" — added in checklist v2. */
  paysOutSellers: YesNo | null;
  answers: Record<string, ChecklistAnswer>;
}

/** The subset of the Web Storage API this module uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface Envelope {
  version: typeof STORAGE_VERSION;
  state: SavedChecklistState;
}

export const EMPTY_STATE: SavedChecklistState = {
  name: "",
  oneLiner: "",
  productTypes: [],
  hasUserAccounts: null,
  charges: null,
  sellsDigital: null,
  paysOutSellers: null,
  answers: {},
};

const PRODUCT_TYPE_KEYS: readonly ProductType[] = PRODUCT_TYPES.map((t) => t.key);
const ITEM_IDS: ReadonlySet<string> = new Set(CHECKLIST_ITEMS.map((i) => i.id));
const ANSWERS: readonly ChecklistAnswer[] = ["missing", "partial", "done", "notApplicable"];

// -----------------------------------------------------------------------------
// Pure (de)serialisation
// -----------------------------------------------------------------------------

export function serializeState(state: SavedChecklistState): string {
  const envelope: Envelope = { version: STORAGE_VERSION, state };
  return JSON.stringify(envelope);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isYesNoOrNull(v: unknown): v is YesNo | null {
  return v === "yes" || v === "no" || v === null;
}

/**
 * Parse and validate a stored value. Returns null for anything that is not a
 * well-formed state from this version: bad JSON, a different version, wrong
 * field types, unknown product types, or invalid answer values.
 *
 * Answers for item ids no longer in the catalogue are dropped rather than
 * rejecting the whole state, so retiring an item does not wipe a user's work.
 */
export function parseState(raw: string | null): SavedChecklistState | null {
  if (raw === null) return null;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(data) || data.version !== STORAGE_VERSION || !isRecord(data.state)) {
    return null;
  }
  const s = data.state;

  if (typeof s.name !== "string" || typeof s.oneLiner !== "string") return null;
  if (!isYesNoOrNull(s.charges) || !isYesNoOrNull(s.sellsDigital)) return null;
  // Added after v1 of this storage format shipped. A state saved before it
  // existed simply has no answer yet — not an incompatible state — so a
  // missing value restores as unanswered instead of discarding saved work.
  const paysOutSellers = s.paysOutSellers === undefined ? null : s.paysOutSellers;
  if (!isYesNoOrNull(paysOutSellers)) return null;
  // Same for the accounts answer (added in checklist v3). Never guessed from
  // other answers — an older save restores it as unanswered.
  const hasUserAccounts = s.hasUserAccounts === undefined ? null : s.hasUserAccounts;
  if (!isYesNoOrNull(hasUserAccounts)) return null;

  if (!Array.isArray(s.productTypes)) return null;
  if (!s.productTypes.every((t) => PRODUCT_TYPE_KEYS.includes(t as ProductType))) {
    return null;
  }
  const selected = new Set(s.productTypes as ProductType[]);
  // Catalogue order, no duplicates — the same shape the form produces.
  const productTypes = PRODUCT_TYPE_KEYS.filter((k) => selected.has(k));

  if (!isRecord(s.answers)) return null;
  const answers: Record<string, ChecklistAnswer> = {};
  for (const [id, answer] of Object.entries(s.answers)) {
    if (!ANSWERS.includes(answer as ChecklistAnswer)) return null;
    if (ITEM_IDS.has(id)) answers[id] = answer as ChecklistAnswer;
  }

  return {
    name: s.name.slice(0, NAME_MAX),
    oneLiner: s.oneLiner.slice(0, ONE_LINER_MAX),
    productTypes,
    hasUserAccounts,
    charges: s.charges,
    sellsDigital: s.sellsDigital,
    paysOutSellers,
    answers,
  };
}

/** True when the state holds nothing the user entered. */
export function isEmptyState(state: SavedChecklistState): boolean {
  return (
    state.name === "" &&
    state.oneLiner === "" &&
    state.productTypes.length === 0 &&
    state.hasUserAccounts === null &&
    state.charges === null &&
    state.sellsDigital === null &&
    state.paysOutSellers === null &&
    Object.keys(state.answers).length === 0
  );
}

// -----------------------------------------------------------------------------
// Storage access — every call is wrapped so failures degrade to "no persistence"
// -----------------------------------------------------------------------------

/**
 * The browser's localStorage, or null when unavailable: during server
 * rendering, when access throws (blocked storage, some privacy modes), or
 * when a write probe fails.
 */
export function getBrowserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    const probe = `${STORAGE_KEY}:probe`;
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/**
 * Load the saved state, or null if there is none or it is unusable.
 * Unusable data is removed so it is not re-read on every visit.
 */
export function loadState(storage: StorageLike | null): SavedChecklistState | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  const state = parseState(raw);
  if (raw !== null && state === null) clearState(storage);
  return state;
}

/** Save the state. Returns false if the write failed (e.g. quota exceeded). */
export function saveState(storage: StorageLike | null, state: SavedChecklistState): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, serializeState(state));
    return true;
  } catch {
    return false;
  }
}

/** Remove the saved state. Never throws. */
export function clearState(storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing useful to do — the page keeps working without persistence.
  }
}
