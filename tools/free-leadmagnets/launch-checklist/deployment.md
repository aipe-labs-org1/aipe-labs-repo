# Founder Launch Checklist — Deployment

Related issue: not yet assigned (Track A tool #2)
Companion docs: `product-brief.md`, `technical-plan.md`, `qa-report.md` (this folder)
Tool #1 deployment guide: `../idea-validator/deployment.md` (same Vercel project)

---

## 1. Production URL

**[NOT DEPLOYED]** — the work is not yet committed, reviewed, or merged (§5).
Replace this line with the real URL once §4 and §6 complete. Do not assume a URL
until then.

## 2. Hosting

Vercel, as **one project shared with the AI Idea Validator**. Deploying Tool #2
redeploys the whole app, so the Tool #1 checks in §6.5 run on every deploy.

Every route is statically prerendered. There are no API routes, middleware,
server actions, or environment variables, and nothing is stored server-side.

## 3. Project configuration

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Root directory | `tools/free-leadmagnets` |
| Node.js version | **22.x** (`.nvmrc` = 22; `engines` = `>=20 <23`) |
| Package manager | npm |
| Install command | `npm ci` |
| Build command | `npm run build` (runs `next build`) |
| Output directory | `.next` (default) |
| Environment variables | **None** |

**Why 22.x:** it is the only currently-supported Node line inside the declared
`engines` range (`>=20 <23`), and it is the runtime every validation run used.
Node 20 reached end of life in April 2026; Node 24 falls outside `engines` and
would require a `package.json` change. Vercel does not read `.nvmrc` — the
version must be set in the project settings.

Routes produced by the build (all static):

| Route | Purpose |
|---|---|
| `/` | Tools index (links to both tools) |
| `/tools/idea-validator` | AI Idea Validator (Tool #1) |
| `/tools/launch-checklist` | Founder Launch Checklist (Tool #2) |
| `/tools/launch-checklist/report` | Shared report (reads the `#r=` fragment; `noindex`) |
| `/_not-found` | Default 404 page |

No deployment URL needs configuring: share links use `window.location.origin`
at click time.

## 4. Deployment procedure

1. **Pre-deploy gates** (all required):
   - Tool #2 work committed on `feature/tool-02-launch-checklist` and a PR
     opened into `main` (branch protection requires a PR).
   - Hitesh reviews and approves. Review points: saved answers in
     `localStorage`, user-entered text in public share URLs, the hard-blocker
     definitions and verdict rules, and the deferred launch decisions in
     `product-brief.md` §16.
   - `npm ci && npm run typecheck && npm run lint && npm test && npm run build`
     pass on Node 22.
2. **Preview:** Vercel builds a preview for the PR. Run the full smoke test in
   §6 against the preview URL (HTTPS — needed for the clipboard check).
3. **Merge:** after approval and a clean preview smoke test, merge the PR.
   Vercel deploys `main` to production.
4. **Production:** re-run §6 against the production URL, then record the URL in
   §1 in a small docs PR.

If the Vercel project does not exist yet, create it once as described in
`../idea-validator/deployment.md` §4.2 (the same settings as §3 above).

## 5. Status

- Engineering: checklist version 5 implemented; automated and browser QA pass
  (`qa-report.md`).
- **Blocking:** not committed; no PR; no review; manual checks outstanding
  (clipboard success path, Vercel preview smoke test).
- Deferred by decision, not blocking: analytics, email capture, and the
  AIPE Labs / Skool call to action (`product-brief.md` §16).

## 6. Production smoke test (Tool #2)

Record each step as PASS / FAIL / NOT TESTED. A NOT TESTED is better than an
assumed PASS.

### 6.1 Checklist and result

- [ ] Open `/tools/launch-checklist`; the page loads with no console errors.
- [ ] Complete setup: name, one-liner, a product type, "Do people sign in?",
      "Does money change hands?"; the checklist appears only after all are
      answered.
- [ ] Answer every item Done and click **Calculate launch readiness** →
      100 / 100, **Ready to launch**.
- [ ] Change one hard blocker (e.g. "All traffic uses HTTPS") to **Missing** and
      recalculate → **Not ready**, listed under "Hard blockers (1)".
- [ ] Change it to **Partial** and recalculate → **Not ready**, listed under
      "Hard blockers not fully done (1)" with "Answered Partial".
- [ ] Load the Threadloom example and calculate → **61 / 100, Not ready**,
      privacy-policy hard blocker.

### 6.2 Saved answers

- [ ] With answers entered, refresh the page → answers restored, the "Restored
      your answers" note shown, and **no result** shown until recalculating.
- [ ] Click **Start again**, refresh → the form stays empty.

### 6.3 Share links

- [ ] Calculate a result and click **Copy share link** → "Link copied!" (this is
      also the clipboard check).
- [ ] Open the link in a fresh private window → the report matches the original
      score, verdict, blockers, category breakdown, and answers, with the
      self-assessment disclaimer.
- [ ] Confirm opening the link did not change the saved answers in the original
      window.
- [ ] Open an old version-4 link → **"This report is out of date"**, no score.
      Example (Threadloom, checklist version 4):
      `/tools/launch-checklist/report#r=eyJ2IjoxLCJjIjo0LCJ0IjpbImFpIiwic2FhcyJdLCJwIjoxLCJkIjowLCJhIjoiZGRkZC1wLWRtcC0tLXAtbmRwbXBkZC0tbXBkZGRkcG0tcGQtbm1wcHBkLXBkZGRtcC0tLXBwbWRtbS0tZHBwbWRtZC1tIiwibiI6IlRocmVhZGxvb20iLCJvIjoiVHVybiBsb25nLWZvcm0gYmxvZyBwb3N0cyBpbnRvIHJlYWR5LXRvLXB1Ymxpc2ggc29jaWFsIHRocmVhZHMuIn0`
- [ ] Edit a character in the middle of a link's `#r=` value → **"This report
      link isn't valid"**.

### 6.4 Clipboard, mobile, console

- [ ] **Copy launch report** on HTTPS → "Copied!" and the pasted text contains
      the score, verdict, "Hard blockers", "Hard blockers not fully done", top
      gaps, and next actions.
- [ ] At 375px width (or a real phone): no horizontal scrolling; answer buttons
      easy to tap; result page readable.
- [ ] Browser console: no errors or hydration warnings on the checklist and
      report pages.

### 6.5 Tool #1 and index regression

- [ ] `/` shows both tool cards and each link opens its tool.
- [ ] `/tools/idea-validator`: load Sample #1 and calculate → 79, "Validate with
      landing page/interviews".

## 7. Rollback

Promote the previous production deployment in the Vercel dashboard, or
`git revert` the merge commit and let Vercel redeploy. Saved answers and share
links need no data migration: nothing is stored server-side, and old links keep
showing as outdated or valid according to their checklist version.
