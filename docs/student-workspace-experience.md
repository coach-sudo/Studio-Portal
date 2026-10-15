# PR 1.6 — Student Overview, Household, Payments and credit controls

## Dependency and release boundary

Direct base: PR #40, `codex/bulk-lesson-interface`, exact head `c162fc292d4b9ba8d78c9ae2eb4c0c08485119ee`. Verified October 15, 2026: #36 `f99f8cc0b7ae209e27562014e0743f39052f1dad` → #37 `0badcc648ec715e20c2be7849d0bdbd8ec0955e0` → #38 `c894f7f51f26aae0e9c396a4d791d2bbc0c1a545` → #39 `8b8a0aa173bfbc03f0bdb01a3a8953459f86cd0f` → #40. All remain open drafts. None of their migrations is assumed applied to production. GitHub #41 belongs to Dependabot; this implementation receives its own draft number.

Source of truth: [master plan](studio-portal-modernization-master-plan.md), especially section 8, and the credit diagnostics/lifecycle, occurrence safety, bulk backend/interface delivery notes. No Wave 2 work is included. Every commit and PR title uses `[skip netlify]`; no merge, publication, deployment, production migration, reconciliation, payment or live message is authorized.

## Information hierarchy and workflows

Overview reads a coach-only, bounded `student_workspace_summary`: one exact upcoming lesson, latest coaching takeaway, at most five canonical resources and five practices, question/approval counts and financial exceptions. Goals/private context require disclosure. The coach's private takeaway never enters portal financial responses. The primary record sections are Overview, Lessons, My Work, Notes, Household and Payments. Account administration and Actor Page remain in the record menu with their existing URLs. One Add menu offers lesson, note, practice and resource actions, alongside Message.

Household defaults to identifiable contact rows with relationship, contact information, payer/scheduling responsibility, invitation delivery and portal access. Identity/responsibility editing is separate from expanded access controls. Manage Access opens the existing contact command form with permissions and notifications deliberately exposed. Sending to a delivery provider is not presented as account activation. Activation remains explicitly unverified; the current model has no authoritative first-access event. Existing minor restrictions, mandatory notification policy and access revocation remain server-controlled.

Payments starts with known financial obligations and separately labeled dollar credit, followed by remaining/available/reserved lesson credits. Unknown balances say Review required. Invoice-linked lessons are counted through issued invoices; shared bookings are counted once. Currency totals stay separate. Ambiguous invoice/shared-booking associations require review. Invoices, packages/history/adjustments, reminders and pricing/forecasts are secondary disclosures. Dollar credits never silently reduce displayed obligations.

## Authoritative credits and refresh

The live credit panel reads #36's `student_credit_coverage`; frontend simulations are confined to the demo component. It shows covered and uncovered rows with actual reason codes, bounded pagination, automatic On/Off/Needs review, expired credits and recovery state. The enablement review uses the backend preview across the entire relevant set before pagination.

Settings saves and #37's applied/already-covered/skipped/failed outcomes are separate messages. A malformed response does not fabricate successful application. Manual Apply eligible credits now does not enable automatic use. During implementation, #37's account command was found to reject this action while automatic use was off. The additive migration uses the existing manual evaluator/allocator, retains manual recovery intent in the existing queue, and preserves receipt replay, lock order and audit. An explicit disable cancels queued manual intent. No competing allocator is introduced.

Mutation invalidation refreshes workspace/financial summaries and credit coverage. Recovery polls while pending; other active reads refresh every 30 seconds and on focus. Queries include actor/student identity. Credit forms remount on identity changes; failed authorized reads suppress cached previews. Credit history uses a guarded bounded RPC and excludes lesson logistics and free-form reasons from finance-only roles.

## Context and privacy

Next lesson opens the exact existing hub. Notes support exact note links; Today links to the intended lesson draft and reuses a matching draft. Practice links preserve its ID. Resource links validate resource, assignment and student together before using the existing resource detail component. Account and actor URLs remain compatible. No private file URLs are added to summary contracts.

The financial public facade remains invoker; its narrow private definer validates the same finance/minor/disabled-workspace predicate as credit diagnostics before aggregating totals independent of schedule RLS. It returns no topics, dates, lesson identities or note bodies. The coach summary/resource functions retain invoker RLS and explicit current-coach checks. Student/guardian credit controls remain read-only.

## Verification and evidence

Validation is in progress. Final-head run links, exact results, changed-file inventory and before/after evidence will be recorded in the draft description after checks finish. The new browser comparison builds pinned #40 locally and captures the same isolated fixture before and after at desktop/mobile widths. No production browser session or preview publication is used. Database tests include partial/invoice obligations, empty/unknown context, ownership denial and failed manual work recovering without enabling automatic use. Full-schema pgTAP and observed separate-session races remain required, alongside all #36–40 regressions.

## Known limits and Wave 1 checkpoint

Legacy query mode and global activity reads remain broad. Payments' secondary legacy administration still requests its existing snapshot domains; the new Overview and financial/credit summary contracts are bounded. Provider delivery is not exercised without isolated credentials. Large histories in remaining legacy surfaces, whole-product accessibility/WebKit and navigation consolidation remain later-wave work. No measured task-time/click improvement is claimed.

Stop at PR 1.6 review. Once all six Wave 1 drafts pass review, run coordinated staging/integration acceptance across the actual PR numbers (#36–40 plus this draft) before requesting any production release. Recheck heads, migration ordering, target IDs, worker cadence, shared-booking invariants, private reads and rollback controls. All later waves remain required.
