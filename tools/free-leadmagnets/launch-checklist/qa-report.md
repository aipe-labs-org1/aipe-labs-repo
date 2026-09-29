# Founder Launch Checklist — QA Report

Related issue: not yet assigned (Track A tool #2)
QA dates: 2026-09-26 to 2026-09-27
Checklist version under test: **5** · Share format: **1** · Storage key: `aipe-launch-checklist:v1`
Owner: Engineer, with Hitesh as reviewer for the final PASS decision

This report records QA that was actually performed. It separates automated
tests, browser QA, and manual checks that are **still outstanding**.

---

## 1. Environment

| Item | Value |
|---|---|
| OS | Windows 11 |
| Node / npm | 22.14.0 / 11.9.0 — matches the Node 22.x deployment target (`.nvmrc` = 22; `engines` = `>=20 <23`) |
| Next.js / React / TypeScript | 15.5.25 / 19.2.8 / 5.9.3 |
| Test runner | Vitest 2.1.9 (Node environment) |
| Browser QA | Local production build (`next build` + `next start -p 3107`) in the Claude desktop app's built-in browser, driven by scripted interaction and DOM measurement |

QA ran on the same Node major version as the deployment target (22.x). The
exact patch release Vercel builds with may differ.

## 2. Automated verification (checklist version 5)

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 — no ESLint warnings or errors |
| `npm test` | **561 passed**, 0 failed, 5 files |
| `npm run build` | exit 0 — all 5 routes static; `/tools/launch-checklist` 7.37 kB (130 kB first load), `/tools/launch-checklist/report` 1.13 kB (127 kB first load) |

### Test files

| File | Tests | Covers |
|---|---:|---|
| `lib/scoring/calculate.test.ts` | 58 | AI Idea Validator (Tool #1) — unchanged |
| `lib/launch-checklist/calculate.test.ts` | 227 | Scoring, verdicts, precision, applicability, N/A and Partial rules, blockers |
| `lib/launch-checklist/share.test.ts` | 212 | Share encoding/decoding, validation, versions, round trips |
| `lib/launch-checklist/persistence.test.ts` | 51 | Saved-state format, migration, failure handling |
| `lib/launch-checklist/samples.test.ts` | 13 | Threadloom sample, category-N/A helper |

### What the automated tests cover

- **Catalogue invariants:** 69 items, weights sum to 100, hard blocker ⇔
  weight 3, every item declares `allowNotApplicable` and `allowPartial`, every
  item has an action, every category non-empty for each product type.
- **Verdict boundaries** at 0, 40, 49, 49.6, 49.99, 50, 64, 65, 69, 69.6,
  69.99, 70, 84, 84.6, 84.99, 85, 100, and category thresholds at 59.6, 59.99,
  60, 69.6, 69.99, 70 — all on unrounded values; an end-to-end 84.62 score that
  displays as 85 stays Launch with caveats.
- **Partial hard blockers (v5):** each of the 10 Partial-able blockers answered
  Partial → Not ready; two → Not ready (not Prototype); all ten → 87.46 Not
  ready; missing + partial combinations keep the Missing-only Prototype rule;
  `partialBlockers` contents and order; `deriveVerdict` directly.
- **Store approval (v4):** only Missing/Done offered; engine rejects Partial
  with a message naming the item; Missing caps at Not ready; other mobile items
  keep Partial.
- **N/A control (v2):** 52 items prohibit N/A; the engine rejects programmatic
  N/A; legitimate N/A cases still work.
- **Applicability:** every product type with and without sign-in; the six
  account items; API with keys only vs developer sign-up; accountless,
  magic-link, OAuth, invite-only, team SaaS, and admin-only scenarios;
  payments for web, SaaS, mobile with/without in-app purchases, API, and free
  products; marketplaces with and without seller payouts (listing-fee,
  subscription, lead-generation, free).
- **Share round trips:** all 63 product-type combinations × free / paid /
  paid with digital goods / paying marketplace / without sign-in, each
  recomputed and compared with the original result; Threadloom; non-ASCII
  text; worst-case length.
- **Share rejections:** 50+ malformed or tampered payloads, disallowed answers
  per slot, account and payout slots, oversized fragments; a v1, v2, v3, and v4
  link (including real Threadloom links from earlier checkpoints) each report
  "outdated"; the share table fingerprint is pinned.
- **Hidden characters (P1-1):** 13 rejected and 9 accepted characters
  including boundaries; `FORBIDDEN_TEXT` source pinned as pure ASCII; the
  encoder refuses 8 kinds of bad text; everything the encoder accepts, the
  decoder accepts.
- **Persistence:** round trips; malformed, version-mismatched, and wrongly
  typed data rejected and removed; saves missing `paysOutSellers` or
  `hasUserAccounts` restore them as unanswered; storage that throws never
  breaks the page.
- **Threadloom regression:** 52 items, 61.249854 (displays 61), Not ready,
  privacy-policy blocker only, no partial blockers.

## 3. Browser QA (performed)

Each row records the latest checklist version it was run against.

| Area | Result | Last run at |
|---|---|---|
| Partial hard blocker (HTTPS, web) | 98, **Not ready**; "Hard blockers not fully done (1)" with "Answered Partial"; included in the copied report | v5 |
| All 10 applicable blockers Partial (57-item product) | 87, **Not ready**; section lists 10; report lists 10 | v5 |
| Threadloom | 52/52 answered; 61, Not ready; privacy-policy blocker; no partial section | v5 |
| Pasted tab in product name | Input keeps the tab; inline error, focus, `aria-invalid="true"` | v5 |
| Right-to-left mark in one-liner, then in name | Inline error on the right field with focus; fixing and recalculating works | v5 |
| Version-4 share link | "This report is out of date", no score | v5 |
| New version-5 share link | Opens at 61, Not ready | v5 |
| 375px mobile | No horizontal overflow; missing and partial blocker sections both fit | v5 |
| Console | No errors or hydration warnings (checklist, report, Tool #1) | v5 |
| Tool #1 regression | Sample #1 still 79, "Validate with landing page/interviews" | v5 |
| Store approval answer options | Missing and Done only (151×44px each at 375px); other mobile items keep Partial | v4 |
| Legacy saved Partial on store approval | Dropped (not converted); specific message and focus on Calculate | v4 |
| Sign-in question and applicability (web, SaaS, API with and without sign-up, mobile, marketplace) | Correct item counts, account items and N/A options, "Users sign in" line in the report | v3 |
| Legacy save without the sign-in answer | Question unanswered, checklist hidden; after Yes, now-invalid N/A answers dropped with message and focus | v3 |
| Money question, in-app purchase and payout questions, N/A options | Only allowed options shown; payout blocker only for paying marketplaces that pay sellers | v2 |
| Saved answers restore (A–L) | Restored after refresh; no result restored; Start again clears storage; corrupted storage ignored | v1 (storage format unchanged since) |
| Share links in a fresh tab | Report matches the original; the visitor's saved answers untouched; tampered, truncated, and oversized links invalid | v1–v5 |
| Setup, validation, calculate, stale result, reset, example | Errors inline with focus; stale banner and "Recalculate" label; copy disabled while stale | v1–v5 |
| Keyboard | Arrow keys move between answers; visible focus ring | v1 |
| Copy launch report / Copy share link | **Fallback path only** (the in-app browser blocks the clipboard): the select-and-copy box shows the full report or link | v1–v5 |

## 4. Manual checks still outstanding

| Check | Why it is outstanding |
|---|---|
| **Clipboard success path** ("Copied!") in Chrome and Safari on HTTPS | Not verified: the QA browser blocks clipboard writes, and the Chrome extension was not connected |
| Full-width desktop layout on the current version | Recent QA ran in a narrow pane; desktop was last checked at ~800–1024px in early checkpoints |
| Screen reader pass (VoiceOver / NVDA) | Not performed; semantics reviewed in code only |
| Safari, Firefox, and real iOS/Android devices | Not performed |
| Vercel preview deployment smoke test | Not deployed yet (see `deployment.md`) |
| Share links pasted into chat apps and email | Not verified that fragments survive link wrappers |

## 5. Known non-blocking issues

- Submitting an empty checklist raises many `role="alert"` messages at once
  (screen-reader noise).
- Long single-page form with no sticky progress bar.
- "Launch with caveats" copy ("launch to a small audience") sits awkwardly
  next to the store-approval blocker for TestFlight betas.
- The 80/200 character limits are defined in three places.

## 6. QA verdict

**Automated and browser QA pass for checklist version 5.** Release still
requires the outstanding manual checks in §4 (at minimum the clipboard success
path and a Vercel preview smoke test) and Hitesh's review.
