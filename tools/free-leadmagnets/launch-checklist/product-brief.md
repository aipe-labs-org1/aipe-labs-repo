# Product Brief — Founder Launch Checklist

Related issue: not yet assigned (Track A tool #2)
Parent issue: #59 — Announce Three-Product Build Lab and Boilerplate Track
Companion docs: `technical-plan.md`, `qa-report.md`, `deployment.md` (this folder)

Track: A — Free lead-magnet tools
Folder: `tools/free-leadmagnets`
Routes: `/tools/launch-checklist`, `/tools/launch-checklist/report`
Owner: AIPE Labs
Reviewer: Hitesh — @hiteshiat1

Checklist version: **5** (`CHECKLIST_VERSION` in `lib/launch-checklist/catalogue.ts`)
Share format version: **1** (`SHARE_VERSION` in `lib/launch-checklist/share.ts`)
Status: implemented, not yet committed, reviewed, or deployed

This brief describes the product **as currently implemented**. Where a number
or rule is stated, the code is the source of truth; the file that owns it is
named so it can be checked.

---

## 1. Purpose

Founders who can build a working product often cannot tell whether it is ready
to launch publicly. The Founder Launch Checklist asks a tailored set of
launch-readiness questions across eight areas, scores the answers out of 100,
flags hard blockers that rule out launching, and returns a verdict with the top
gaps and next actions.

The result is a **self-assessment** built only from the founder's own answers.
It is not an audit, and the shared report says so.

## 2. Target users

- AI-assisted builders and founders about to launch a web app, mobile app, API,
  AI product, marketplace, or SaaS.
- Readers of AIPE Labs content (Skool, X) looking for a practical pre-launch
  check.
- People who receive a shared report from a founder.

## 3. User journey

1. Open `/tools/launch-checklist`, or click **Load Threadloom example** to see a
   filled-in sample (AI + SaaS).
2. **Setup:** product name (1–80 characters), one-line description (1–200),
   product types (one or more), then the setup questions in §6.
3. The checklist appears once product type, the sign-in question, and the
   money question are answered. Items are grouped by category, with progress
   counts ("answered · remaining").
4. Answer every item: **Missing**, **Partial**, **Done**, or **Not applicable**
   (only the answers each item allows are offered — see §7).
5. Click **Calculate launch readiness**. Validation errors appear inline and
   focus moves to the first problem.
6. Read the result: score, verdict, missing and partial hard blockers,
   category breakdown, top five gaps, next actions, and every item answered
   Missing.
7. Optionally **Copy launch report** (plain text) or **Copy share link**.
8. Editing any answer after calculating marks the result stale until
   recalculated. **Start again** clears everything, including saved answers.

## 4. Product types

`web` (Web app), `mobile` (Mobile app), `api` (API), `ai` (AI product),
`marketplace` (Marketplace), `saas` (SaaS). A product may select several; an
item applies when **any** selected type matches it.

Items shown for a single type (paying product without digital goods or seller
payouts / free product), with sign-in Yes / No:

| Type | Paid, sign-in Yes | Paid, sign-in No | Free, sign-in Yes | Free, sign-in No |
|---|---:|---:|---:|---:|
| Web | 39 | 36 | 35 | 32 |
| Mobile | 43 | 40 | 39 | 36 |
| API | 40 | 38 | 35 | 33 |
| AI | 47 | 44 | 43 | 40 |
| Marketplace | 42 | 39 | 38 | 35 |
| SaaS | 44 | 38 | 39 | 33 |

Across every combination of types and setup answers, an assessment shows
between 32 and 69 items, and no category is ever empty.

## 5. Categories and weights

Owned by `CATEGORIES` in `catalogue.ts`. Weights sum to 100.

| Category | Weight | Items | Hard blockers |
|---|---:|---:|---:|
| Product & positioning | 15 | 7 | 1 |
| Onboarding & activation | 15 | 9 | 1 |
| Reliability & quality | 15 | 10 | 1 |
| Security & auth | 15 | 11 | 3 |
| Data & privacy | 10 | 8 | 1 |
| Payments & billing | 10 | 8 | 3 |
| Analytics & feedback | 10 | 7 | 0 |
| Launch readiness & GTM | 10 | 9 | 1 |
| **Total** | **100** | **69** | **11** |

Item weights: 18 items at weight 1, 40 at weight 2, 11 at weight 3. Every
weight-3 item is a hard blocker, and every hard blocker is weight 3.

## 6. Setup questions

| Question (as shown) | Field | Shown when | Effect |
|---|---|---|---|
| Do people sign in to use your product? | `hasUserAccounts` | always | Controls six account items (below) |
| Does money change hands through your product? | `paymentsApplicable` | always | No removes the whole Payments & billing category |
| Do you sell digital goods or subscriptions inside the mobile app? | `sellsDigitalGoodsInApp` | money changes hands **and** Mobile is selected | Yes adds the in-app purchase blocker |
| Does your marketplace pay sellers or providers? | `paysOutSellers` | money changes hands **and** Marketplace is selected | Yes adds the seller-payout blocker |

**`hasUserAccounts`** — "Any sign-in counts: email and password, magic link,
Google or Apple login, SSO, or invite-only. If developers sign up to get an API
key, answer Yes. Answer No if people use it without signing in, or if only you
sign in to an admin area." It controls exactly six items: sign-up speed, proven
sign-in, account deletion, team invites, team roles, and data export. It does
**not** control the authorization blocker, which applies to every product (the
risk is about stored per-person data, not accounts).

**`paymentsApplicable`** — covers purchases, subscriptions, usage-based
billing, fees, commissions, or any other paid transaction, whoever pays.

**`sellsDigitalGoodsInApp`** — physical goods and real-world services do not
count.

**`paysOutSellers`** — Yes if buyers pay through the product and it passes
money on to sellers or providers; No for listing-fee, subscription, or
lead-fee marketplaces where buyers pay sellers directly.

## 7. Answers

| Answer | Points | Meaning |
|---|---:|---|
| Missing | 0 | Not in place |
| Partial | 1 | Started but not complete |
| Done | 2 | In place |
| Not applicable | — | Excluded from scoring |

Per-item controls (explicit on every item in `catalogue.ts`):

- **`allowNotApplicable`** — N/A is allowed on 17 items and prohibited on 52.
  Every hard blocker prohibits N/A except `rq-backups-enabled` (a product may
  store no user data).
- **`allowPartial`** — Partial is allowed on every item except
  `lg-mobile-store-approved`, which is Missing or Done only.

Disallowed answers are not offered in the UI, are rejected by the scoring
engine, and make a share link invalid.

## 8. Scoring model

Owned by `calculate.ts`.

- **Category score** = Σ(answer points × item weight) ÷ Σ(2 × item weight),
  over the category's scored (non-N/A) items, as a percentage.
- **Overall score** = category scores weighted by category weight.
- **Payments N/A:** when no money changes hands, Payments & billing is excluded
  and its 10 points are redistributed proportionally across the other seven
  categories. Payments is the only category that may be excluded; a category
  other than Payments with every item N/A is a validation error (in practice
  unreachable, because every such category contains items that prohibit N/A).
- **Precision:** scores are kept at full precision (to six decimal places).
  Every verdict threshold uses the unrounded score; only the displayed score
  and category percentages are rounded to whole numbers.

## 9. Hard blockers

| Item | Category | Applies to | N/A | Partial |
|---|---|---|---|---|
| `pp-core-job-works` — The core job works end to end | Product & positioning | all | no | yes |
| `oa-api-reference-docs` — API reference documentation is published | Onboarding & activation | API | no | yes |
| `rq-backups-enabled` — Production data is backed up | Reliability & quality | all | **yes** | yes |
| `sa-https-everywhere` — All traffic uses HTTPS | Security & auth | all | no | yes |
| `sa-no-exposed-secrets` — No secrets are exposed | Security & auth | all | no | yes |
| `sa-authorization-enforced` — Users can only access their own data | Security & auth | all | no | yes |
| `dp-privacy-policy` — A privacy policy is published | Data & privacy | all | no | yes |
| `pb-live-payment-tested` — Paying works end to end with your real payment setup | Payments & billing | all, when money changes hands | no | yes |
| `pb-mobile-in-app-purchase` — In-app purchases follow store rules | Payments & billing | mobile, when selling digital goods in the app | no | yes |
| `pb-marketplace-payouts` — Seller payouts are set up and tested | Payments & billing | marketplace, when it pays sellers | no | yes |
| `lg-mobile-store-approved` — The app has passed store review | Launch readiness & GTM | mobile | no | **no** |

- A hard blocker answered **Missing** is a *hard blocker* in the result.
- A hard blocker answered **Partial** is a *partial blocker* ("Hard blockers
  not fully done"). Since checklist version 5 it caps the verdict at
  **Not ready**, but it does **not** count towards the Prototype rule.

## 10. Verdict rules

Evaluated in this order; the first match wins (`deriveVerdict`).

| Verdict (label) | Rule |
|---|---|
| **Prototype** | score < 50, **or** 2+ hard blockers answered Missing |
| **Not ready** | score < 70, **or** 2+ categories below 60, **or** exactly 1 hard blocker answered Missing, **or** any hard blocker answered Partial |
| **Launch with caveats** | score < 85, **or** any category below 70 (with no blockers of either kind, and at most one category below 60) |
| **Ready to launch** | score ≥ 85, no hard or partial blockers, every category ≥ 70 |

Top gaps: up to five, ranked Missing hard blockers first, then by
weight × (2 − points), then category order, then catalogue order. Next actions
are each top gap's catalogue action text, word for word.

## 11. Mobile store approval

`lg-mobile-store-approved` stays a mobile-only, weight-3 hard blocker with no
N/A and **no Partial**. Done means the launch build is approved on each public
store the product is launching on and ready to release. Not yet submitted,
submitted and waiting, in review, TestFlight only, and internal testing only
are all **Missing**. The payment test (`pb-live-payment-tested`) can still be
Done before public release through a TestFlight or Google Play internal-testing
purchase.

## 12. Saved answers (localStorage)

- Key `aipe-launch-checklist:v1` (versioned envelope, storage version 1).
- Saves **inputs only**: name, one-liner, product types, the four setup
  answers, and the checklist answers. The calculated result is never saved.
- Restored after the page loads; no result is shown until the user
  recalculates. A small note says answers were restored.
- Malformed or incompatible saved data is ignored and removed. Setup answers
  added in later versions (payouts, sign-in) restore as unanswered, never
  guessed.
- A saved answer the current checklist no longer allows (N/A, or Partial on
  store approval) is dropped and flagged with a specific message on Calculate.
- **Start again** clears the saved answers.

## 13. Share links

- **Copy share link** creates
  `/tools/launch-checklist/report#r=<base64url payload>` from the exact input
  that produced the displayed result (disabled while the result is stale).
- The payload holds the assessment input only — never the score, verdict, or
  gaps. The report page recomputes the result with the same scoring engine.
- It sits in the URL fragment, so it is never sent to a server; there is no
  backend. Anyone with the link can read the product name, description, and
  every answer. Links cannot be revoked or expire.
- The report page is `noindex`, shows a self-assessment disclaimer, and never
  reads or writes the visitor's saved answers.
- A link from a different checklist version shows **"This report is out of
  date"** and is never re-scored. A malformed or tampered link shows **"This
  report link isn't valid"**.

## 14. Versions

- **Checklist version 5** — records what an assessment means. History: 1
  initial; 2 per-item N/A control, live-payment redefinition, seller-payout
  condition; 3 sign-in applicability; 4 no Partial on store approval; 5 Partial
  hard blockers cap at Not ready.
- **Share format version 1** — the payload encoding. Unchanged since share
  links were introduced; whether users sign in and whether a marketplace pays
  sellers are implied by whether their controlling items were answered.
- **Storage version 1** — the saved-answers envelope (`aipe-launch-checklist:v1`).

## 15. Current limitations

- **Self-assessment only.** Anyone can answer dishonestly; the verdict only
  reflects the answers.
- **Public launch only.** Private, enterprise, or TestFlight-only mobile
  distribution cannot honestly reach Ready (store approval has no N/A or
  Partial).
- **No per-platform readiness.** A web + mobile product is Ready only when the
  mobile build is also store-approved.
- **Admin-only sign-in** answers "No" to the sign-in question, so no sign-in
  security item applies to an admin login.
- **Share links are public, permanent, and version-bound** — every checklist
  version bump makes earlier links show as out of date.
- **Browser-only persistence** — saved answers live in one browser profile and
  do not sync.
- **Long form** — up to 69 items on one page, with no sticky progress bar.

## 16. Launch decisions / deferred

| Decision | Status |
|---|---|
| Analytics | **Deferred** pending approval and a privacy decision. Nothing is tracked today. |
| Email capture | **Deferred** pending approval and a privacy decision. No lead form exists. |
| AIPE Labs / Skool call to action | **Decision still pending.** No call to action exists today; the only link is the shared report's "Run the checklist for your product". |

Also deferred (from the content audit, not scheduled): coverage for email
deliverability, infrastructure account security, cost guardrails, common web
attacks, accessibility, AI output safety, marketplace disputes, admin login
security, and merchant-of-record wording; distribution-model applicability;
per-platform readiness; an explicit flags field (share format 2).
