# AIPE Labs — Free Lead-Magnet Tools

Next.js App Router application that hosts the AIPE Labs free public tools.

## Current tools

- **AI Idea Validator** — route: `/tools/idea-validator`
- **Founder Launch Checklist** — route: `/tools/launch-checklist`
  - Shared reports — route: `/tools/launch-checklist/report` (see [Share links](#founder-launch-checklist-share-links))

A sibling route is reserved for the remaining Track A tool (parent issue #59), to be added as follow-up work:

- `/tools/issue-generator` — GitHub Issue Generator for AI-built apps (not yet built)

## Stack

- Next.js 15 (App Router) · React 19 · TypeScript 5 · Tailwind CSS 3
- Node 22 LTS (see `.nvmrc`)
- No database, no authentication, no payments, no external AI APIs
- The Founder Launch Checklist saves answers in the browser's `localStorage`
  and can put them in share-link URL fragments; nothing is sent to a server

## Founder Launch Checklist share links

After calculating a result, **Copy share link** creates a link like:

```text
/tools/launch-checklist/report#r=<base64url payload>
```

- **Self-contained.** The payload holds the assessment *input* only — product
  name, one-line description, product types, the payment setup answers, and
  every checklist answer. (Whether a marketplace pays sellers, and whether
  users sign in, are implied by whether the seller-payout and sign-in items
  were answered, so they need no fields of their own.) The score, verdict,
  gaps, and actions are never stored; the report page recomputes them with the
  same scoring engine (`lib/launch-checklist/calculate.ts`).
- **Nothing is uploaded.** The payload sits in the URL fragment (after `#`),
  which browsers never send to a server. There is no API route or database.
- **Public to anyone with the link.** Anyone who has it can read the product
  name, description, and every answer. Links cannot be revoked or expired.
- **Not indexed.** The report page is `noindex` and shows a self-assessment
  disclaimer. Product text is rendered as plain text and never placed in page
  metadata.
- **Strictly validated.** `parseShareFragment` in `lib/launch-checklist/share.ts`
  rejects anything malformed or tampered with as a single "invalid" state.

### Checklist version rule

`CHECKLIST_VERSION` in `lib/launch-checklist/catalogue.ts` records what an
assessment *means*. Every share link stores the version it was created with; a
link from a different version shows an "outdated report" message and is never
re-scored under the new rules.

The current version is **5**. Version 5 made a hard blocker answered
"Partial" cap the verdict at "Not ready" (it no longer counts as done enough
for "Ready to launch"); partial blockers do not trigger "Prototype". Version 2
added per-item "Not applicable" control, a redefined live-payment test, and
seller-payout applicability;
version 3 added account applicability (the "Do people sign in?" setup question
controls six account items); version 4 made mobile store approval a yes-or-no
item — it stays Missing until the app is approved on the public stores it
launches on (submitted, in review, and TestFlight all count as Missing). Every
link created under an earlier version shows as outdated. The version history
is documented next to the constant.

- **Increment it** for any scoring-relevant change: adding, removing, or
  re-purposing items; item weights, hard blockers, or applicability; category
  weights; answer points; category, verdict, or gap-ranking thresholds; or any
  other scoring logic that changes what an assessment means.
- **Do not increment it** for cosmetic or UI-only changes such as rewording
  copy without changing meaning, reordering how items are displayed, or styling.
- **When adding an item**, also append its id to the end of `SHARE_ITEM_TABLE`
  in `lib/launch-checklist/share.ts` (never reorder or reuse slots). A test
  fails until you do.

## Local development

Requirements: Node 22 LTS and npm.

```bash
cd tools/free-leadmagnets
nvm use              # switches to Node 22 per .nvmrc
npm ci               # reproducible install from package-lock.json
npm run dev          # http://localhost:3000
```

Then open:

- <http://localhost:3000/> — tools index
- <http://localhost:3000/tools/idea-validator> — AI Idea Validator
- <http://localhost:3000/tools/launch-checklist> — Founder Launch Checklist
- <http://localhost:3000/tools/launch-checklist/report> — shared report (needs a `#r=` link)

## npm scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build locally |
| `npm run lint` | ESLint via `next lint` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, one run |
| `npm run test:watch` | Vitest in watch mode |

## Documentation

**AI Idea Validator** (Issue #70) — `idea-validator/`:
`product-brief.md`, `technical-plan.md`, `qa-report.md`, `deployment.md`, and
Skool/X drafts in `launch/`.

**Founder Launch Checklist** (Track A tool #2) — `launch-checklist/`:

- `product-brief.md` — what the tool does: categories, scoring, hard blockers,
  verdict rules, setup questions, saved answers, share links, limitations
- `technical-plan.md` — architecture, validation layers, persistence, share
  encoding, versioning, privacy
- `qa-report.md` — automated tests, browser QA performed, manual checks
  outstanding
- `deployment.md` — Vercel configuration and the production smoke test

## Launch decisions / deferred

Both tools collect nothing server-side. These are open decisions, not gaps to
fill quietly:

| Decision | Status |
|---|---|
| Analytics | Deferred pending approval and a privacy decision |
| Email capture | Deferred pending approval and a privacy decision |
| AIPE Labs / Skool call to action | Decision still pending |
