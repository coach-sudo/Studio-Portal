# Waves 1 + 2 coordinated release

This is the single release report for the authorization supplied October 18, 2026. Production has not been changed. The combined implementation starts from PR #57 `cef1ff83dfbdfaac1af991ef2552f3d47d62ccfa`, application `95188fbf08206aca8d47adfc729e12a82f7e0d60`, based on unchanged PR #56 `e0567286feeb3d2a8b8314aebb833e0f89fb3aa3`. Remote main remains `6df35d700cc13d60ceab3e92293635575479ec4d`.

## Phase A — original-run cleanup PASS

Completed at `2026-10-19T03:53:15.893Z` (October 18, 11:53 p.m. Eastern). The original UI authorization, journal, IDs and exhausted budgets remain intact. No UI01–UI08 workflow was rerun on staging and no completion markers were manufactured.

A separate cleanup-only receipt binds the exact project/studio/run, original manifest/executor/approval/journal/baseline, current row/Auth preimages and reviewed recovery code. Its issue/expiry are `2026-10-19T03:52:32.015Z` / `2026-10-20T03:52:32.015Z`; the original UI expiry was not altered. Executed recovery code seal: `ec1ed40a4e22c2e7c5b6388b45348b3394a2642c0ca9d5d6469317eab320995c`.

Fresh inspection verified the actual 280-row inventory against the complete original journal, not counts alone: 215 original rows and 65 owned rows. All original fingerprints, four full manual Auth rows, the original all-account fingerprint (which also includes earlier retained acceptance identity history), and all 57 full migration records matched. A denied local ACL check and failed conservative account-count check were retained and charged before correcting the checks; neither attempted a hosted mutation or weakened the fingerprint assertions.

The minimal incomplete-run adapter reuses existing transactional cleanup and canonical occurrence cancellation. The one pending deletion item was changed to `skipped` with an exact JSON preimage and explicit cleanup reason. All three jobs, review requests and history remain. `job.state` is constrained to reviewed/running, so it is not falsified as a terminal enum: terminal item states make progress derive completion and prevent any further claiming/retry. No global processor ran.

Both owned students have automatic use off, terminal lessons and inactive/hidden/unlinked portal records. Only exact undelivered operational scaffolding, ephemeral access/contact/membership/service rows were removed. Three disposable Auth identities were removed through Auth Admin; the retained synthetic coach was banned and has no membership. Thirteen lessons, package/ledger, receipts, bulk history and audits remain intentionally retained. No financial history or deletion snapshot was erased.

The independent read-only postcheck matched all 76 tables against original plus retained fingerprints. It proved no active owned lessons, memberships, automatic coverage, runnable bulk items, projections, outbox messages, effects or coverage jobs. Original accounts and full migration history were read back unchanged. Final owned retained rows: 79. The original journal's byte hash was unchanged.

Separate recovery consumption: **156/300 reads, 18/60 canonical SQL requests, 10/40 cleanup transactions, 4/4 Auth cleanup operations**. New users/students/lessons/credits/cash/provider calls/messages/global workers: **zero**. The original 600-read UI budget was neither reset nor extended.

Evidence: [sanitized independent live proof](waves-one-two-cleanup-verification.json), [eight focused PostgreSQL scenarios](waves-one-two-recovery-local.json). These replayed 57 migrations, executed the genuine local UI01–UI04/partial-UI05 setup, tested original-row drift, interrupted commits and partial cleanup recovery, then independently verified preserved data. All 53 original executor guards also passed; scoped lint has zero errors. Local Auth adapters are not represented as hosted Auth evidence.

## Subsequent gates

Linux/Node 22 CI-equivalent validation and fresh 58-migration/policy/type checks are in progress. The staging migration, combined deployment, new focused hosted acceptance/cleanup, production integration/migration/publication remain unexecuted until their preceding gates pass. Existing Wave 1 UI01–UI04 and other unchanged regression evidence remain retained. The full six-wave master plan remains required; no Wave 3 work is included.
