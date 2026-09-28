# Technical Plan — Founder Launch Checklist

Related issue: not yet assigned (Track A tool #2)
Parent issue: #59 — Announce Three-Product Build Lab and Boilerplate Track
Companion docs: `product-brief.md`, `qa-report.md`, `deployment.md` (this folder)

Checklist version: **5** · Share format version: **1** · Storage version: **1**
Status: describes the implementation as built (not a forward plan)

---

## 1. Architecture

One Next.js 15 App Router application at `tools/free-leadmagnets/`, shared with
the AI Idea Validator. Tool #2 adds two routes and one domain library.

```text
app/
  page.tsx                                   tools index (card for each tool)
  tools/launch-checklist/
    page.tsx               server   metadata + hero, mounts LaunchChecklistApp
    LaunchChecklistApp.tsx client   setup, checklist, validation, save/restore
    ChecklistSummary.tsx   client   result (own + shared), copy report, share link
    report/
      page.tsx             server   noindex metadata + header, mounts SharedReport
      SharedReport.tsx     client   reads #r=, recomputes, renders the report
lib/launch-checklist/
  types.ts         domain types (no React, no browser APIs)
  catalogue.ts     single source of truth: types, categories, 69 items, versions
  calculate.ts     pure scoring engine + validation
  persistence.ts   localStorage save/load/clear (defensive)
  share.ts         share-link encode/decode (pure)
  samples.ts       Threadloom example assessment
  *.test.ts        Vitest suites
components/ui/     shared primitives reused unchanged (Button, TextField, ProgressBar)
```

Data flow:

```text
form state ─▶ effective answers (disallowed answers dropped)
          ─▶ validation (form) ─▶ AssessmentInput
          ─▶ calculateLaunchReadiness (pure) ─▶ LaunchReadinessResult ─▶ ChecklistSummary
AssessmentInput ─▶ encodeSharePayload ─▶ #r=… ─▶ parseShareFragment ─▶ same engine
form state ─▶ saveState (localStorage, inputs only)
```

## 2. Components

| Component | Responsibility |
|---|---|
| `LaunchChecklistApp` | Setup questions, applicable items (from `getApplicableItems`), per-item answer options (from `answerOptionsFor`), progress counts, validation and focus, calculate, stale-result tracking, example loader, reset, save/restore |
| `ChecklistSummary` | `variant="own"` (stale banner, copy report, copy share link) or `variant="shared"` (self-assessment disclaimer, list of every answer); score, verdict, missing and partial hard blockers, category breakdown, top gaps, next actions, missing items; clipboard with a manual-copy fallback |
| `SharedReport` | Reads `location.hash` after mount and on `hashchange`; shows loading, invalid, out of date, or the report |

UI code never scores or ranks anything itself; it renders the engine's result.

## 3. Domain logic

### Catalogue (`catalogue.ts`)

- `PRODUCT_TYPES`, `CATEGORIES` (weights 15/15/15/15/10/10/10/10), `CHECKLIST_ITEMS` (69).
- Every item declares `id`, `category`, `label`, `description`, `whyItMatters`,
  `action`, `weight` (1–3), `hardBlocker` (true exactly when weight 3, enforced
  by the type), `applicableProductTypes`, optional `requires`
  (`hasUserAccounts` | `sellsDigitalGoodsInApp` | `paysOutSellers`),
  `allowNotApplicable`, and `allowPartial`.
- Helpers: `getApplicableItems`, `isItemApplicable`, `isAnswerAllowed`,
  `answerOptionsFor`, `getCategory`, `getItemById`.
- `CHECKLIST_VERSION` (5) with the version history in its doc comment.

### Scoring engine (`calculate.ts`)

- `calculateLaunchReadiness(input)` — validates, filters applicable items,
  scores categories, computes the overall score, finds gaps, derives the
  verdict. Pure and deterministic; no clock, randomness, storage, or network.
- `deriveVerdict(score, categoryPercents, hardBlockerCount, partialBlockerCount = 0)`.
- `THRESHOLDS`: prototype below 50, not-ready below 70, ready at 85+, weak
  category below 60, ready category at 70+. All comparisons use unrounded
  scores (normalised to six decimals).
- Result: `overallScore`, `displayScore`, `verdict`, `categoryScores`,
  `excludedCategories`, `hardBlockers` (missing), `partialBlockers`,
  `missingItems`, `topGaps` (≤ 5), `nextActions`.

## 4. Validation (four layers, one rule set)

| Layer | Enforces |
|---|---|
| Form (`LaunchChecklistApp`) | Required fields; setup answers; every applicable item answered with an allowed answer; product text free of forbidden characters (`containsForbiddenText`); inline errors, `aria-invalid`, focus on the first problem |
| Engine (`calculateLaunchReadiness`) | Input shape; known product types; boolean flags; every applicable item answered; allowed answers only (`isAnswerAllowed`); no fully-N/A non-Payments category. Throws `AssessmentValidationError` |
| Encoder (`encodeSharePayload`) | Refuses product text the decoder would reject (empty, untrimmed, over length, forbidden characters) and unanswered items |
| Decoder (`parseShareFragment`) | Length cap (2,000 characters), `#r=` shape, base64url, UTF-8, JSON, exact keys, versions, product types, flags, answer string, text rules, then the engine's own validation |

`FORBIDDEN_TEXT` in `share.ts` (C0/C1 control characters, including tabs, and
bidirectional mark, override, and isolate characters) is written with `\u`
escapes and shared through `containsForbiddenText`.

## 5. Persistence (`persistence.ts`)

- Key `aipe-launch-checklist:v1`; envelope `{ version: 1, state }`.
- State: `name`, `oneLiner`, `productTypes`, `hasUserAccounts`, `charges`,
  `sellsDigital`, `paysOutSellers` (each yes/no/null), `answers`.
- `getBrowserStorage` returns null on the server, when access throws, or when
  a write probe fails; every read and write is wrapped so failures degrade to
  "no persistence".
- Restore happens in an effect after mount; saving starts only after restore,
  so the first empty render can never overwrite saved answers. An untouched
  form stores nothing.

### Migration behaviour

| Stored data | Behaviour |
|---|---|
| Malformed JSON, wrong version, wrong field types, unknown product type, invalid answer value | Ignored and removed; clean form |
| Answers for item ids no longer in the catalogue | Dropped individually |
| Missing `paysOutSellers` (pre-v2) or `hasUserAccounts` (pre-v3) | Restored as unanswered; the checklist stays hidden until the sign-in question is answered |
| An answer the item no longer allows (N/A since v2, Partial on store approval since v4) | Kept in storage, not shown or scored; Calculate shows "… isn't available for this item. Choose …" and focuses the item |
| Product text with forbidden characters | Restored; flagged by the form on Calculate |
| Calculated result | Never stored, so never restored |

## 6. Share encoding (`share.ts`)

- URL: `<origin>/tools/launch-checklist/report#r=<base64url(UTF-8 JSON)>`.
- Payload keys, in order: `v` (share format 1), `c` (checklist version), `t`
  (product types), `p` (money changes hands, 0/1), `d` (digital goods in the
  app, 0/1), `a` (one character per slot in `SHARE_ITEM_TABLE`: `m`/`p`/`d`/`n`,
  or `-` when the item does not apply), `n` (name), `o` (one-liner).
- `SHARE_ITEM_TABLE` is a frozen, append-only list of the 69 item ids; a test
  pins a fingerprint of its first 69 slots so it can never be reordered.
- Derived flags (no keys of their own): `paysOutSellers` from whether the
  seller-payout slot is answered (for a paying marketplace), and
  `hasUserAccounts` from whether the `sa-proven-auth` slot is answered (that
  item applies to every product type and depends only on sign-in; pinned by a
  test).
- Worst-case URL ~1,040 characters (all 69 items, maximum-length emoji text).

## 7. Versioning

| Version | Where | Bump when |
|---|---|---|
| `CHECKLIST_VERSION` = 5 | `catalogue.ts` | Any scoring-relevant change: items, weights, hard blockers, applicability, answer points or permissions, thresholds, verdict rules. Old links then show as out of date |
| `SHARE_VERSION` = 1 | `share.ts` | Only when the payload encoding itself changes |
| `STORAGE_VERSION` = 1 | `persistence.ts` (key suffix `:v1`) | Only on a breaking change to the saved-state shape (new fields have been added compatibly so far) |

Adding a checklist item also requires appending its id to `SHARE_ITEM_TABLE`
(a test fails until you do).

## 8. Client / server boundaries

- Both `page.tsx` files are server components that export static metadata.
  Product text is never placed in metadata.
- `localStorage` and `location.hash` are read only inside effects after mount,
  so the prerendered HTML (empty form; report "Loading…") always matches the
  first client render — no hydration mismatch.
- The report page never imports or touches persistence, so opening someone
  else's link cannot overwrite the visitor's saved answers.

## 9. Dependencies

No dependencies were added for Tool #2. Runtime: `next` ^15.5, `react` ^19,
`react-dom` ^19. Dev: TypeScript, Tailwind CSS 3, PostCSS, Autoprefixer,
ESLint (`next/core-web-vitals`), Vitest. Browser APIs used: `localStorage`,
`navigator.clipboard`, `btoa`/`atob`, `TextEncoder`/`TextDecoder`.

## 10. Build and deployment assumptions

- `next build` prerenders every route as static (`○`): `/`, `/_not-found`,
  `/tools/idea-validator`, `/tools/launch-checklist`,
  `/tools/launch-checklist/report`.
- No API routes, middleware, server actions, or environment variables.
- Vercel: root directory `tools/free-leadmagnets`, Node 22, `npm ci`,
  `npm run build`. See `deployment.md`.
- The share-link origin is read from `window.location.origin` at click time,
  so no deployment URL needs configuring.

## 11. Security and privacy

- **No server-side data.** Nothing a user types is sent to AIPE Labs. The page
  copy says answers are saved only in this browser and Start again clears them.
- **localStorage** holds the product name, description, setup answers, and
  checklist answers in plain text in that browser profile.
- **Share URLs** carry the same data in the fragment. The fragment is not sent
  to servers, Referer headers, or link-preview crawlers, but it is visible to
  anyone who has the link and in browser history. Links cannot be revoked.
- **Tamper resistance:** the decoder is strict and all-or-nothing, the result is
  always recomputed (never trusted from the link), and product text is rendered
  as escaped React text — no `dangerouslySetInnerHTML`.
- **Spoofing:** anyone can craft a link showing arbitrary text; mitigated by the
  self-assessment disclaimer, `noindex`, length caps, and forbidden-character
  rejection.

## 12. Why no database, authentication, or API

The tool needs no shared state: scoring is deterministic and runs in the
browser, saved answers are per-browser, and share links are self-contained.
A backend would add a data store, secrets, a privacy-policy change, retention
and deletion duties, and abuse handling for hosted content — none of which the
current scope requires. Server-side share records (short, revocable links) were
evaluated and deferred.

## 13. Known limitations

- Two setup answers are implied in share links (payouts, sign-in); a third
  should trigger share format 2 with an explicit flags field.
- The "fully N/A category" validation can no longer trigger with the current
  catalogue (every non-Payments category has items that prohibit N/A); it is
  kept as a safety net.
- The engine accepts setup combinations the UI never sends (for example digital
  goods without Mobile); they only hide or show items, and the share decoder
  rejects most of them.
- The 80/200 character limits are defined in three places (catalogue,
  persistence, form).
- No automated UI (DOM) tests; the UI was verified in a browser (see
  `qa-report.md`).
