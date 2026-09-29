import { describe, expect, it } from "vitest";

import {
  EMPTY_STATE,
  STORAGE_KEY,
  STORAGE_VERSION,
  clearState,
  getBrowserStorage,
  isEmptyState,
  loadState,
  parseState,
  saveState,
  serializeState,
  type SavedChecklistState,
  type StorageLike,
} from "./persistence";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const STATE: SavedChecklistState = {
  name: "Threadloom",
  oneLiner: "Turn long-form blog posts into ready-to-publish social threads.",
  productTypes: ["ai", "saas"],
  hasUserAccounts: "yes",
  charges: "yes",
  sellsDigital: null,
  paysOutSellers: null,
  answers: {
    "pp-core-job-works": "done",
    "dp-privacy-policy": "missing",
    "oa-saas-team-invites": "notApplicable",
    "sa-rate-limiting": "partial",
  },
};

/** In-memory Storage with an inspectable backing map. */
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: StorageLike = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
  return { storage, map };
}

/** Storage where every call throws, like blocked or full storage. */
const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

/** Serialise an arbitrary envelope, bypassing type checks. */
function raw(state: unknown, version: unknown = STORAGE_VERSION): string {
  return JSON.stringify({ version, state });
}

// -----------------------------------------------------------------------------
// Round trip
// -----------------------------------------------------------------------------

describe("serializeState / parseState", () => {
  it("round-trips a valid state exactly", () => {
    expect(parseState(serializeState(STATE))).toEqual(STATE);
  });

  it("round-trips the empty state", () => {
    expect(parseState(serializeState(EMPTY_STATE))).toEqual(EMPTY_STATE);
  });

  it("round-trips the mobile in-app answer", () => {
    const mobile: SavedChecklistState = { ...STATE, productTypes: ["mobile"], sellsDigital: "no" };
    expect(parseState(serializeState(mobile))).toEqual(mobile);
  });

  it("stores a versioned envelope and no result or score", () => {
    const stored = JSON.parse(serializeState(STATE));
    expect(stored.version).toBe(STORAGE_VERSION);
    expect(Object.keys(stored.state).sort()).toEqual(
      ["answers", "charges", "hasUserAccounts", "name", "oneLiner", "paysOutSellers", "productTypes", "sellsDigital"],
    );
  });

  it.each(["yes", "no"] as const)("round-trips the accounts answer %s", (value) => {
    const state: SavedChecklistState = { ...STATE, hasUserAccounts: value };
    expect(parseState(serializeState(state))).toEqual(state);
  });

  it("restores a state saved before the accounts question existed as unanswered, keeping everything else", () => {
    const { hasUserAccounts: _omitted, ...legacy } = STATE;
    expect(parseState(raw(legacy))).toEqual({ ...STATE, hasUserAccounts: null });
  });

  it("restores a state saved before both v2 and v3 setup questions existed", () => {
    const { hasUserAccounts: _a, paysOutSellers: _p, ...legacy } = STATE;
    expect(parseState(raw(legacy))).toEqual({ ...STATE, hasUserAccounts: null, paysOutSellers: null });
  });

  it("round-trips the marketplace payout answer", () => {
    const marketplace: SavedChecklistState = { ...STATE, productTypes: ["marketplace"], paysOutSellers: "yes" };
    expect(parseState(serializeState(marketplace))).toEqual(marketplace);
  });

  it("restores a state saved before the payout question existed, with that answer empty", () => {
    const { paysOutSellers: _omitted, ...legacy } = STATE;
    expect(parseState(raw(legacy))).toEqual({ ...STATE, paysOutSellers: null });
  });

  it("uses a versioned key", () => {
    expect(STORAGE_KEY).toBe("aipe-launch-checklist:v1");
  });
});

// -----------------------------------------------------------------------------
// Rejection
// -----------------------------------------------------------------------------

describe("parseState — rejects unusable data", () => {
  it("returns null when nothing is stored", () => {
    expect(parseState(null)).toBeNull();
  });

  it.each(["", "{", "not json", "undefined", "{\"version\":1,"])(
    "rejects malformed JSON %j",
    (bad) => {
      expect(parseState(bad)).toBeNull();
    },
  );

  it.each([["null"], ["42"], ["\"text\""], ["[]"], ["{}"]])("rejects non-envelope JSON %s", (bad) => {
    expect(parseState(bad)).toBeNull();
  });

  it.each([0, 2, "1", null])("rejects version %j", (version) => {
    expect(parseState(raw(STATE, version))).toBeNull();
  });

  it("rejects a state with no version", () => {
    expect(parseState(JSON.stringify({ state: STATE }))).toBeNull();
  });

  it("rejects a missing or non-object state", () => {
    expect(parseState(raw(undefined))).toBeNull();
    expect(parseState(raw("state"))).toBeNull();
    expect(parseState(raw([STATE]))).toBeNull();
  });

  it.each([
    ["name is not a string", { name: 42 }],
    ["oneLiner is missing", { oneLiner: undefined }],
    ["productTypes is not an array", { productTypes: "ai" }],
    ["productTypes has an unknown type", { productTypes: ["ai", "desktop"] }],
    ["charges is not yes/no/null", { charges: true }],
    ["sellsDigital is not yes/no/null", { sellsDigital: "maybe" }],
    ["paysOutSellers is not yes/no/null", { paysOutSellers: true }],
    ["hasUserAccounts is not yes/no/null", { hasUserAccounts: 1 }],
    ["answers is not an object", { answers: ["done"] }],
    ["an answer value is invalid", { answers: { "pp-core-job-works": "yes" } }],
  ])("rejects a state where %s", (_why, patch) => {
    expect(parseState(raw({ ...STATE, ...patch }))).toBeNull();
  });
});

describe("parseState — normalises recoverable data", () => {
  it("drops answers for item ids no longer in the catalogue", () => {
    const parsed = parseState(raw({ ...STATE, answers: { ...STATE.answers, "retired-item": "done" } }));
    expect(parsed?.answers).toEqual(STATE.answers);
  });

  it("de-duplicates product types and puts them in catalogue order", () => {
    const parsed = parseState(raw({ ...STATE, productTypes: ["saas", "ai", "saas"] }));
    expect(parsed?.productTypes).toEqual(["ai", "saas"]);
  });

  it("truncates text to the form's maximum lengths", () => {
    const parsed = parseState(raw({ ...STATE, name: "x".repeat(500), oneLiner: "y".repeat(500) }));
    expect(parsed?.name).toHaveLength(80);
    expect(parsed?.oneLiner).toHaveLength(200);
  });
});

// -----------------------------------------------------------------------------
// Storage access
// -----------------------------------------------------------------------------

describe("saveState / loadState / clearState", () => {
  it("saves and loads a state", () => {
    const { storage, map } = memoryStorage();
    expect(saveState(storage, STATE)).toBe(true);
    expect(map.has(STORAGE_KEY)).toBe(true);
    expect(loadState(storage)).toEqual(STATE);
  });

  it("returns null when nothing is saved", () => {
    expect(loadState(memoryStorage().storage)).toBeNull();
  });

  it("ignores and removes malformed saved data", () => {
    const { storage, map } = memoryStorage({ [STORAGE_KEY]: "{not json" });
    expect(loadState(storage)).toBeNull();
    expect(map.has(STORAGE_KEY)).toBe(false);
  });

  it("ignores and removes a version-mismatched state", () => {
    const { storage, map } = memoryStorage({ [STORAGE_KEY]: raw(STATE, 99) });
    expect(loadState(storage)).toBeNull();
    expect(map.has(STORAGE_KEY)).toBe(false);
  });

  it("leaves unrelated keys alone", () => {
    const { storage, map } = memoryStorage({ other: "keep", [STORAGE_KEY]: "bad" });
    loadState(storage);
    clearState(storage);
    expect(map.get("other")).toBe("keep");
  });

  it("clearState removes the saved state so the next load is clean", () => {
    const { storage } = memoryStorage();
    saveState(storage, STATE);
    clearState(storage);
    expect(loadState(storage)).toBeNull();
  });

  it("treats missing storage as no persistence", () => {
    expect(loadState(null)).toBeNull();
    expect(saveState(null, STATE)).toBe(false);
    expect(() => clearState(null)).not.toThrow();
  });

  it("never throws when storage throws", () => {
    expect(loadState(throwingStorage)).toBeNull();
    expect(saveState(throwingStorage, STATE)).toBe(false);
    expect(() => clearState(throwingStorage)).not.toThrow();
  });

  it("getBrowserStorage returns null outside the browser", () => {
    // Vitest runs in Node, where `window` does not exist — like server rendering.
    expect(getBrowserStorage()).toBeNull();
  });
});

describe("isEmptyState", () => {
  it("is true only for the untouched form", () => {
    expect(isEmptyState(EMPTY_STATE)).toBe(true);
    expect(isEmptyState({ ...EMPTY_STATE, name: "x" })).toBe(false);
    expect(isEmptyState({ ...EMPTY_STATE, productTypes: ["web"] })).toBe(false);
    expect(isEmptyState({ ...EMPTY_STATE, charges: "no" })).toBe(false);
    expect(isEmptyState({ ...EMPTY_STATE, paysOutSellers: "no" })).toBe(false);
    expect(isEmptyState({ ...EMPTY_STATE, hasUserAccounts: "no" })).toBe(false);
    expect(isEmptyState({ ...EMPTY_STATE, answers: { "pp-core-job-works": "done" } })).toBe(false);
  });
});
