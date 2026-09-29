"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { ProgressBar } from "@/components/ui/ProgressBar";
import {
  AssessmentValidationError,
  calculateLaunchReadiness,
  findFullyNotApplicableCategories,
} from "@/lib/launch-checklist/calculate";
import {
  ANSWER_OPTIONS,
  CATEGORIES,
  PRODUCT_TYPES,
  answerOptionsFor,
  getApplicableItems,
  isAnswerAllowed,
} from "@/lib/launch-checklist/catalogue";
import {
  clearState,
  getBrowserStorage,
  isEmptyState,
  loadState,
  saveState,
  type SavedChecklistState,
  type StorageLike,
  type YesNo,
} from "@/lib/launch-checklist/persistence";
import { THREADLOOM } from "@/lib/launch-checklist/samples";
import { containsForbiddenText } from "@/lib/launch-checklist/share";
import type {
  AssessmentInput,
  CategoryKey,
  ChecklistAnswer,
  ChecklistCategory,
  ChecklistItem,
  LaunchReadinessResult,
  ProductType,
} from "@/lib/launch-checklist/types";
import { cn } from "@/lib/utils";

import ChecklistSummary from "./ChecklistSummary";

// -----------------------------------------------------------------------------
// Types and static copy
// -----------------------------------------------------------------------------

interface SetupErrors {
  name?: string;
  oneLiner?: string;
  productTypes?: string;
  hasUserAccounts?: string;
  charges?: string;
  sellsDigital?: string;
  paysOutSellers?: string;
}

/** The result together with the exact input that produced it. */
interface Calculation {
  result: LaunchReadinessResult;
  input: AssessmentInput;
}

const ERRORS = {
  name: "Please enter a product name.",
  oneLiner: "Please enter a one-line description.",
  /**
   * Text containing characters share links reject (pasted tabs, other control
   * characters, or invisible text-direction marks). Checked with the same
   * helper the share encoder and decoder use.
   */
  hiddenCharacters: (field: string) =>
    `Remove hidden formatting characters from the ${field}, such as tabs or invisible text-direction marks. Retyping it usually fixes this.`,
  productTypes: "Select at least one product type.",
  hasUserAccounts: "Please tell us whether people sign in to use your product.",
  charges: "Please tell us whether money changes hands through your product.",
  sellsDigital:
    "Please tell us whether the app sells digital goods or subscriptions.",
  paysOutSellers: "Please tell us whether your marketplace pays sellers or providers.",
  item: "Choose an answer.",
  /**
   * A restored answer the item no longer accepts (checklist v2 N/A rules,
   * v4 store-approval Partial). Lists that item's actual choices, e.g.
   * "Not applicable isn't available for this item. Choose Missing, Partial, or Done."
   */
  itemAnswerNotAllowed: (answer: ChecklistAnswer, item: ChecklistItem) => {
    const answerLabel = ANSWER_OPTIONS.find((o) => o.value === answer)?.label ?? answer;
    const choices = answerOptionsFor(item).map((o) => o.label);
    const list =
      choices.length > 2
        ? `${choices.slice(0, -1).join(", ")}, or ${choices.at(-1)}`
        : choices.join(" or ");
    return `${answerLabel} isn't available for this item. Choose ${list}.`;
  },
  category: (label: string) =>
    `Every item in ${label} is marked Not applicable. Answer at least one item — only Payments & billing can be skipped entirely.`,
} as const;

const YES_NO_OPTIONS: readonly { value: YesNo; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function focusById(id: string) {
  const el = typeof document !== "undefined" ? document.getElementById(id) : null;
  el?.focus();
}

/** DOM id of an item's first answer option — used to focus the item. */
function firstAnswerId(itemId: string) {
  return `${itemId}-${ANSWER_OPTIONS[0].value}`;
}

// -----------------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------------

export default function LaunchChecklistApp() {
  const [name, setName] = useState("");
  const [oneLiner, setOneLiner] = useState("");
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [hasUserAccounts, setHasUserAccounts] = useState<YesNo | null>(null);
  const [charges, setCharges] = useState<YesNo | null>(null);
  const [sellsDigital, setSellsDigital] = useState<YesNo | null>(null);
  const [paysOutSellers, setPaysOutSellers] = useState<YesNo | null>(null);
  const [answers, setAnswers] = useState<Record<string, ChecklistAnswer>>({});

  const [setupErrors, setSetupErrors] = useState<SetupErrors>({});
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [categoryErrors, setCategoryErrors] = useState<
    Partial<Record<CategoryKey, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);

  const [calculation, setCalculation] = useState<Calculation | null>(null);
  const [isStale, setIsStale] = useState(false);

  const resultHeadingRef = useRef<HTMLHeadingElement>(null);

  // ---------------------------------------------------------------------------
  // Local persistence — inputs only, never the result
  // ---------------------------------------------------------------------------

  const storageRef = useRef<StorageLike | null>(null);
  /** True once saved input has been restored (or found absent). Gates saving. */
  const [restoreDone, setRestoreDone] = useState(false);
  /** True when this visit started from answers saved in this browser. */
  const [restoredFromBrowser, setRestoredFromBrowser] = useState(false);

  // Restore after mount, never during render: the server HTML and the first
  // client render are both the empty form, so hydration always matches.
  // No result is restored — the user recalculates from the restored answers.
  useEffect(() => {
    const storage = getBrowserStorage();
    storageRef.current = storage;
    const saved = loadState(storage);
    if (saved && !isEmptyState(saved)) {
      setName(saved.name);
      setOneLiner(saved.oneLiner);
      setProductTypes(saved.productTypes);
      setHasUserAccounts(saved.hasUserAccounts);
      setCharges(saved.charges);
      setSellsDigital(saved.sellsDigital);
      setPaysOutSellers(saved.paysOutSellers);
      setAnswers(saved.answers);
      setRestoredFromBrowser(true);
    }
    setRestoreDone(true);
  }, []);

  // Save every input change. Waits for the restore above so the initial empty
  // render can never overwrite saved answers. An untouched form stores nothing.
  useEffect(() => {
    if (!restoreDone) return;
    const state: SavedChecklistState = {
      name,
      oneLiner,
      productTypes,
      hasUserAccounts,
      charges,
      sellsDigital,
      paysOutSellers,
      answers,
    };
    if (isEmptyState(state)) clearState(storageRef.current);
    else saveState(storageRef.current, state);
  }, [
    restoreDone,
    name,
    oneLiner,
    productTypes,
    hasUserAccounts,
    charges,
    sellsDigital,
    paysOutSellers,
    answers,
  ]);

  // ---------------------------------------------------------------------------
  // Derived state — applicability always comes from the catalogue
  // ---------------------------------------------------------------------------

  const asksAboutInAppSales =
    charges === "yes" && productTypes.includes("mobile");
  const asksAboutPayouts =
    charges === "yes" && productTypes.includes("marketplace");
  // The checklist depends on all three always-asked setup answers, so it only
  // appears once each is answered — including for older saves that predate
  // the accounts question.
  const setupReady =
    productTypes.length > 0 && hasUserAccounts !== null && charges !== null;

  const applicableItems = useMemo(
    () =>
      productTypes.length > 0 && hasUserAccounts !== null && charges !== null
        ? getApplicableItems({
            productTypes,
            hasUserAccounts: hasUserAccounts === "yes",
            paymentsApplicable: charges === "yes",
            sellsDigitalGoodsInApp:
              charges === "yes" &&
              productTypes.includes("mobile") &&
              sellsDigital === "yes",
            paysOutSellers:
              charges === "yes" &&
              productTypes.includes("marketplace") &&
              paysOutSellers === "yes",
          })
        : [],
    [productTypes, hasUserAccounts, charges, sellsDigital, paysOutSellers],
  );

  const groups = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        category,
        items: applicableItems.filter((i) => i.category === category.key),
      })).filter((g) => g.items.length > 0),
    [applicableItems],
  );

  /**
   * Answers that currently count. A saved "Not applicable" on an item that no
   * longer allows it (checklist v2) is dropped, so the item shows as
   * unanswered instead of silently excluding itself or breaking scoring.
   */
  const effectiveAnswers = useMemo(() => {
    const result: Record<string, ChecklistAnswer> = {};
    for (const item of applicableItems) {
      const answer = answers[item.id];
      if (answer !== undefined && isAnswerAllowed(item, answer)) {
        result[item.id] = answer;
      }
    }
    return result;
  }, [applicableItems, answers]);

  const answeredCount = Object.keys(effectiveAnswers).length;

  // Move focus to the result after each successful calculation so keyboard
  // and screen-reader users land on it (the checklist above is long).
  useEffect(() => {
    if (calculation) resultHeadingRef.current?.focus();
  }, [calculation]);

  // ---------------------------------------------------------------------------
  // Change handlers
  // ---------------------------------------------------------------------------

  /** Any edit after a result marks it stale and clears the form-level error. */
  function markChanged() {
    if (calculation) setIsStale(true);
    setFormError(null);
  }

  function clearSetupError(key: keyof SetupErrors) {
    if (setupErrors[key]) {
      setSetupErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  function toggleProductType(type: ProductType) {
    setProductTypes((prev) => {
      const selected = prev.includes(type)
        ? prev.filter((t) => t !== type)
        : [...prev, type];
      // Keep catalogue order so the stored list is stable.
      return PRODUCT_TYPES.map((t) => t.key).filter((k) => selected.includes(k));
    });
    clearSetupError("productTypes");
    markChanged();
  }

  function updateAnswer(item: ChecklistItem, value: ChecklistAnswer) {
    setAnswers((prev) => ({ ...prev, [item.id]: value }));
    if (itemErrors[item.id]) {
      setItemErrors((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
    if (value !== "notApplicable" && categoryErrors[item.category]) {
      setCategoryErrors((prev) => {
        const next = { ...prev };
        delete next[item.category];
        return next;
      });
    }
    markChanged();
  }

  // ---------------------------------------------------------------------------
  // Example + reset
  // ---------------------------------------------------------------------------

  function clearErrors() {
    setSetupErrors({});
    setItemErrors({});
    setCategoryErrors({});
    setFormError(null);
  }

  function handleLoadExample() {
    const {
      product,
      hasUserAccounts: sampleHasAccounts,
      paymentsApplicable,
      sellsDigitalGoodsInApp,
      paysOutSellers,
    } = THREADLOOM.input;
    const yesNo = (value: boolean): YesNo => (value ? "yes" : "no");
    setName(product.name);
    setOneLiner(product.oneLiner);
    setProductTypes([...product.productTypes]);
    setHasUserAccounts(yesNo(sampleHasAccounts));
    setCharges(yesNo(paymentsApplicable));
    setSellsDigital(
      paymentsApplicable && product.productTypes.includes("mobile")
        ? yesNo(sellsDigitalGoodsInApp)
        : null,
    );
    setPaysOutSellers(
      paymentsApplicable && product.productTypes.includes("marketplace")
        ? yesNo(paysOutSellers)
        : null,
    );
    setAnswers({ ...THREADLOOM.input.answers });
    setRestoredFromBrowser(false);
    clearErrors();
    // A freshly loaded example supersedes any previous result — the user
    // still clicks Calculate, as in the AI Idea Validator.
    setCalculation(null);
    setIsStale(false);
  }

  function handleReset() {
    setName("");
    setOneLiner("");
    setProductTypes([]);
    setHasUserAccounts(null);
    setCharges(null);
    setSellsDigital(null);
    setPaysOutSellers(null);
    setAnswers({});
    clearErrors();
    setCalculation(null);
    setIsStale(false);
    setRestoredFromBrowser(false);
    clearState(storageRef.current);
    focusById("productName");
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const nextSetup: SetupErrors = {};
    if (name.trim().length === 0) nextSetup.name = ERRORS.name;
    else if (containsForbiddenText(name.trim())) {
      nextSetup.name = ERRORS.hiddenCharacters("product name");
    }
    if (oneLiner.trim().length === 0) nextSetup.oneLiner = ERRORS.oneLiner;
    else if (containsForbiddenText(oneLiner.trim())) {
      nextSetup.oneLiner = ERRORS.hiddenCharacters("one-line description");
    }
    if (productTypes.length === 0) nextSetup.productTypes = ERRORS.productTypes;
    if (hasUserAccounts === null) nextSetup.hasUserAccounts = ERRORS.hasUserAccounts;
    if (charges === null) nextSetup.charges = ERRORS.charges;
    if (asksAboutInAppSales && sellsDigital === null) {
      nextSetup.sellsDigital = ERRORS.sellsDigital;
    }
    if (asksAboutPayouts && paysOutSellers === null) {
      nextSetup.paysOutSellers = ERRORS.paysOutSellers;
    }

    const nextItems: Record<string, string> = {};
    const nextCategories: Partial<Record<CategoryKey, string>> = {};
    if (setupReady) {
      for (const item of applicableItems) {
        if (effectiveAnswers[item.id] !== undefined) continue;
        // A restored answer the item no longer allows (a v2 N/A, or a v4
        // Partial on store approval) gets a specific message; it is never
        // silently converted to another answer.
        const saved = answers[item.id];
        nextItems[item.id] =
          saved !== undefined ? ERRORS.itemAnswerNotAllowed(saved, item) : ERRORS.item;
      }
      for (const key of findFullyNotApplicableCategories(applicableItems, effectiveAnswers)) {
        const label = CATEGORIES.find((c) => c.key === key)?.label ?? key;
        nextCategories[key] = ERRORS.category(label);
      }
    }

    setSetupErrors(nextSetup);
    setItemErrors(nextItems);
    setCategoryErrors(nextCategories);

    // Focus targets in visual order.
    const focusOrder: string[] = [];
    if (nextSetup.name) focusOrder.push("productName");
    if (nextSetup.oneLiner) focusOrder.push("oneLiner");
    if (nextSetup.productTypes) focusOrder.push(`productType-${PRODUCT_TYPES[0].key}`);
    if (nextSetup.hasUserAccounts) focusOrder.push("hasUserAccounts-yes");
    if (nextSetup.charges) focusOrder.push("charges-yes");
    if (nextSetup.sellsDigital) focusOrder.push("sellsDigital-yes");
    if (nextSetup.paysOutSellers) focusOrder.push("paysOutSellers-yes");
    for (const { category, items } of groups) {
      if (nextCategories[category.key]) focusOrder.push(firstAnswerId(items[0].id));
      for (const item of items) {
        if (nextItems[item.id]) focusOrder.push(firstAnswerId(item.id));
      }
    }

    const issueCount =
      Object.keys(nextSetup).length +
      Object.keys(nextItems).length +
      Object.keys(nextCategories).length;

    if (issueCount > 0) {
      setFormError(
        `${issueCount} ${issueCount === 1 ? "thing needs" : "things need"} fixing before you can calculate. The first one is highlighted.`,
      );
      focusById(focusOrder[0]);
      return;
    }

    const input: AssessmentInput = {
      product: {
        name: name.trim(),
        oneLiner: oneLiner.trim(),
        productTypes: [...productTypes],
      },
      hasUserAccounts: hasUserAccounts === "yes",
      paymentsApplicable: charges === "yes",
      sellsDigitalGoodsInApp: asksAboutInAppSales && sellsDigital === "yes",
      paysOutSellers: asksAboutPayouts && paysOutSellers === "yes",
      answers: { ...effectiveAnswers },
    };

    try {
      const result = calculateLaunchReadiness(input);
      setCalculation({ result, input });
      setIsStale(false);
      setFormError(null);
    } catch (err) {
      // Validation above mirrors the engine, so this should be unreachable.
      // Fail visibly rather than crash.
      setFormError(
        err instanceof AssessmentValidationError
          ? "Some answers could not be scored. Please review the checklist and try again."
          : "Something went wrong while scoring. Please try again.",
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* Example loader */}
      <div className="mt-10 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div>
          <p className="text-sm font-medium text-slate-900">Try an example</p>
          <p className="mt-1 text-xs text-slate-500">
            Prefill the form with Threadloom, an AI + SaaS product that turns
            blog posts into social threads, then click Calculate. You can change
            any answer first.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={handleLoadExample}
          className="w-full flex-none sm:w-auto"
        >
          Load Threadloom example
        </Button>
      </div>

      {restoredFromBrowser && (
        <p role="status" className="mt-3 text-xs text-slate-500">
          Restored your answers from this browser. Click Start again to clear them.
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-12" noValidate>
        {/* 1. Product setup */}
        <section aria-labelledby="section-product" className="space-y-6">
          <h2 id="section-product" className="text-xl font-semibold text-slate-900">
            1. Your product
          </h2>
          <TextField
            id="productName"
            label="Product name"
            hint="1–80 characters."
            maxLength={80}
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clearSetupError("name");
              markChanged();
            }}
            error={setupErrors.name}
          />
          <TextField
            id="oneLiner"
            label="One-line description"
            hint="What does it do, in one sentence? 1–200 characters."
            maxLength={200}
            required
            value={oneLiner}
            onChange={(e) => {
              setOneLiner(e.target.value);
              clearSetupError("oneLiner");
              markChanged();
            }}
            error={setupErrors.oneLiner}
          />
          <ProductTypeField
            selected={productTypes}
            onToggle={toggleProductType}
            error={setupErrors.productTypes}
          />
          <YesNoField
            name="hasUserAccounts"
            legend="Do people sign in to use your product?"
            hint="Any sign-in counts: email and password, magic link, Google or Apple login, SSO, or invite-only. If developers sign up to get an API key, answer Yes. Answer No if people use it without signing in, or if only you sign in to an admin area."
            value={hasUserAccounts}
            onChange={(v) => {
              setHasUserAccounts(v);
              clearSetupError("hasUserAccounts");
              markChanged();
            }}
            error={setupErrors.hasUserAccounts}
          />
          <YesNoField
            name="charges"
            legend="Does money change hands through your product?"
            hint="Purchases, subscriptions, usage-based billing, fees, commissions, or any other paid transaction — whoever pays. Choose No only if the product is completely free; the Payments & billing section is then skipped and its weight shared across the other areas."
            value={charges}
            onChange={(v) => {
              setCharges(v);
              clearSetupError("charges");
              markChanged();
            }}
            error={setupErrors.charges}
          />
          {asksAboutInAppSales && (
            <YesNoField
              name="sellsDigital"
              legend="Do you sell digital goods or subscriptions inside the mobile app?"
              hint="For example premium features, credits, or a subscription unlocked in the app. Physical goods and real-world services don't count."
              value={sellsDigital}
              onChange={(v) => {
                setSellsDigital(v);
                clearSetupError("sellsDigital");
                markChanged();
              }}
              error={setupErrors.sellsDigital}
            />
          )}
          {asksAboutPayouts && (
            <YesNoField
              name="paysOutSellers"
              legend="Does your marketplace pay sellers or providers?"
              hint="Choose Yes if buyers pay through your product and you pass money on to sellers or providers, for example after taking a commission. Choose No if you only charge listing fees, subscriptions, or lead fees and buyers pay sellers directly."
              value={paysOutSellers}
              onChange={(v) => {
                setPaysOutSellers(v);
                clearSetupError("paysOutSellers");
                markChanged();
              }}
              error={setupErrors.paysOutSellers}
            />
          )}
        </section>

        {/* 2. Checklist */}
        <section aria-labelledby="section-checklist" className="space-y-6">
          <h2 id="section-checklist" className="text-xl font-semibold text-slate-900">
            2. Launch checklist
          </h2>

          {!setupReady ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
              Choose at least one product type, whether people sign in, and
              whether money changes hands through your product to see the
              checklist for your product.
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                Answer each item for where your product is today. Choose{" "}
                <span className="font-medium text-slate-900">Not applicable</span>{" "}
                only when an item genuinely does not apply — it is then left out
                of your score. It isn&apos;t offered for items every product like
                yours needs. Items marked{" "}
                <span className="font-medium text-slate-900">Hard blocker</span>{" "}
                rule out &ldquo;Ready to launch&rdquo; if they are missing.
              </p>

              <AssessmentProgress answered={answeredCount} total={applicableItems.length} />

              {groups.map(({ category, items }) => (
                <CategorySection
                  key={category.key}
                  category={category}
                  items={items}
                  answers={effectiveAnswers}
                  itemErrors={itemErrors}
                  categoryError={categoryErrors[category.key]}
                  onAnswer={updateAnswer}
                />
              ))}
            </>
          )}
        </section>

        {/* Actions */}
        <div className="space-y-4 border-t border-slate-200 pt-8">
          {formError && (
            <p
              role="alert"
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
            >
              {formError}
            </p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              {setupReady
                ? `${answeredCount} of ${applicableItems.length} checklist items answered.`
                : "Complete your product details to see the checklist."}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="secondary" onClick={handleReset}>
                Start again
              </Button>
              <Button type="submit">
                {calculation && isStale
                  ? "Recalculate launch readiness"
                  : "Calculate launch readiness"}
              </Button>
            </div>
          </div>
        </div>
      </form>

      <ChecklistSummary
        variant="own"
        result={calculation?.result ?? null}
        input={calculation?.input ?? null}
        isStale={isStale}
        headingRef={resultHeadingRef}
      />
    </>
  );
}

// -----------------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------------

function describedBy(...ids: (string | false | undefined)[]) {
  const joined = ids.filter(Boolean).join(" ");
  return joined.length > 0 ? joined : undefined;
}

/** Multi-select product types as native checkboxes. */
function ProductTypeField({
  selected,
  onToggle,
  error,
}: {
  selected: readonly ProductType[];
  onToggle: (type: ProductType) => void;
  error?: string;
}) {
  return (
    <fieldset
      aria-describedby={describedBy("productTypes-hint", error && "productTypes-error")}
      aria-invalid={error ? true : undefined}
    >
      <legend className="text-sm font-medium text-slate-900">
        What kind of product is it?
        <span className="ml-1 text-rose-600" aria-hidden="true">
          *
        </span>
      </legend>
      <p id="productTypes-hint" className="mt-1 text-xs text-slate-500">
        Select every type that applies — for example, AI product and SaaS.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {PRODUCT_TYPES.map((type) => {
          const id = `productType-${type.key}`;
          const checked = selected.includes(type.key);
          return (
            <label
              key={type.key}
              htmlFor={id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border bg-white p-3 transition",
                "focus-within:ring-2 focus-within:ring-slate-500 focus-within:ring-offset-2",
                checked
                  ? "border-slate-900 bg-slate-50"
                  : error
                    ? "border-rose-400 hover:border-rose-500"
                    : "border-slate-300 hover:border-slate-400",
              )}
            >
              <input
                id={id}
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(type.key)}
                className="mt-0.5 h-4 w-4 flex-none accent-slate-900 focus:outline-none"
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">
                  {type.label}
                </span>
                <span className="block text-xs text-slate-500">{type.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      {error && (
        <p id="productTypes-error" role="alert" className="mt-2 text-xs text-rose-600">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/** A required Yes / No question as a native radio pair. */
function YesNoField({
  name,
  legend,
  hint,
  value,
  onChange,
  error,
}: {
  name: string;
  legend: string;
  hint?: string;
  value: YesNo | null;
  onChange: (v: YesNo) => void;
  error?: string;
}) {
  const hintId = hint ? `${name}-hint` : undefined;
  const errorId = error ? `${name}-error` : undefined;
  return (
    <fieldset
      aria-describedby={describedBy(hintId, errorId)}
      aria-invalid={error ? true : undefined}
    >
      <legend className="text-sm font-medium text-slate-900">
        {legend}
        <span className="ml-1 text-rose-600" aria-hidden="true">
          *
        </span>
      </legend>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
      <div className="mt-3 grid max-w-xs grid-cols-2 gap-2">
        {YES_NO_OPTIONS.map((option) => (
          <ChoiceButton
            key={option.value}
            id={`${name}-${option.value}`}
            name={name}
            label={option.label}
            checked={value === option.value}
            invalid={Boolean(error)}
            onSelect={() => onChange(option.value)}
          />
        ))}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-xs text-rose-600">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * A native radio styled as a button, following `RadioScale`: the input is
 * visually hidden but keeps keyboard (arrow key) navigation, and the label
 * carries the focus ring. Selection is shown by fill and text, not colour alone.
 */
function ChoiceButton({
  id,
  name,
  label,
  checked,
  invalid,
  onSelect,
}: {
  id: string;
  name: string;
  label: string;
  checked: boolean;
  invalid: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex min-h-[44px] cursor-pointer items-center justify-center rounded-md border px-2 py-2 text-center text-sm font-medium transition",
        "focus-within:ring-2 focus-within:ring-slate-500 focus-within:ring-offset-2",
        checked
          ? "border-slate-900 bg-slate-900 text-white"
          : invalid
            ? "border-rose-400 bg-white text-slate-700 hover:border-rose-500"
            : "border-slate-300 bg-white text-slate-700 hover:border-slate-400",
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="sr-only"
      />
      {label}
    </label>
  );
}

function AssessmentProgress({ answered, total }: { answered: number; total: number }) {
  const percent = total > 0 ? (answered / total) * 100 : 0;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-slate-900">Assessment progress</span>
        <span className="text-sm tabular-nums text-slate-700">
          {answered} / {total} answered
        </span>
      </div>
      <ProgressBar value={percent} label="Assessment progress" className="mt-2" />
      <p className="mt-2 text-xs text-slate-500">
        This tracks how many items you have answered, not your readiness score.
      </p>
    </div>
  );
}

function CategorySection({
  category,
  items,
  answers,
  itemErrors,
  categoryError,
  onAnswer,
}: {
  category: ChecklistCategory;
  items: readonly ChecklistItem[];
  answers: Readonly<Record<string, ChecklistAnswer>>;
  itemErrors: Readonly<Record<string, string>>;
  categoryError?: string;
  onAnswer: (item: ChecklistItem, value: ChecklistAnswer) => void;
}) {
  const headingId = `category-${category.key}`;
  const answered = items.filter((i) => answers[i.id] !== undefined).length;
  const remaining = items.length - answered;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "rounded-xl border bg-white p-4 shadow-sm sm:p-6",
        categoryError ? "border-rose-300" : "border-slate-200",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="text-lg font-semibold text-slate-900">
          {category.label}
        </h3>
        <span className="text-xs tabular-nums text-slate-500">
          {answered} answered · {remaining} remaining
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600">{category.description}</p>
      <ProgressBar
        value={(answered / items.length) * 100}
        label={`${category.label} answered`}
        className="mt-3"
      />
      {categoryError && (
        <p
          role="alert"
          className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800"
        >
          {categoryError}
        </p>
      )}
      <ul className="mt-6 divide-y divide-slate-200">
        {items.map((item) => (
          <li key={item.id} className="py-6 first:pt-0 last:pb-0">
            <ChecklistItemField
              item={item}
              value={answers[item.id]}
              error={itemErrors[item.id]}
              onChange={(v) => onAnswer(item, v)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ChecklistItemField({
  item,
  value,
  error,
  onChange,
}: {
  item: ChecklistItem;
  value: ChecklistAnswer | undefined;
  error?: string;
  onChange: (v: ChecklistAnswer) => void;
}) {
  const descId = `${item.id}-desc`;
  const whyId = `${item.id}-why`;
  const errorId = `${item.id}-error`;
  // Only the answers this item allows — no "Not applicable" when prohibited.
  const options = answerOptionsFor(item);
  return (
    <fieldset
      aria-describedby={describedBy(descId, whyId, error && errorId)}
      aria-invalid={error ? true : undefined}
    >
      <legend className="text-sm font-semibold text-slate-900">
        {item.label}
        {item.hardBlocker && (
          <span className="ml-2 inline-block rounded bg-rose-50 px-1.5 py-0.5 align-middle text-xs font-medium text-rose-800 ring-1 ring-inset ring-rose-200">
            Hard blocker
          </span>
        )}
      </legend>
      <p id={descId} className="mt-1 text-sm text-slate-600">
        {item.description}
      </p>
      <p id={whyId} className="mt-1 text-xs text-slate-500">
        <span className="font-medium text-slate-600">Why it matters: </span>
        {item.whyItMatters}
      </p>
      <div
        className={cn(
          "mt-3 grid gap-2",
          // Two choices sit side by side (capped on wider screens to match the
          // other rows' button width); three fit one row even on a phone; four
          // wrap to 2 × 2.
          options.length === 2
            ? "grid-cols-2 sm:max-w-xs"
            : options.length === 3
              ? "grid-cols-3"
              : "grid-cols-2 sm:grid-cols-4",
        )}
      >
        {options.map((option) => (
          <ChoiceButton
            key={option.value}
            id={`${item.id}-${option.value}`}
            name={item.id}
            label={option.label}
            checked={value === option.value}
            invalid={Boolean(error)}
            onSelect={() => onChange(option.value)}
          />
        ))}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-xs text-rose-600">
          {error}
        </p>
      )}
    </fieldset>
  );
}
