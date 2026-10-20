# Wave 5 pause checkpoint — October 20, 2026

Paused at the user's request for usage renewal. Resume the existing Wave 5 implementation; do not restart planning or repeat completed Waves 1–4 validation.

## Source and isolation

- Branch: `codex/studio-operations-wave-five`.
- Base: merged Wave 4, `d9643d208c406b5f5c8f18c372dac6e45dcf04a1`.
- Scope: all five workstreams in the approved Wave 5 plan, one coordinated PR and gated release. Do not begin Wave 6.
- Original detailed request: `C:\Users\dariu\Downloads\Coach'D Studio Portal — WAVE 5_ COMPLETE STUDIO OPERATIONS MODERNIZATION.txt`.
- No Wave 5 hosted migration, fixture, deployment, provider call, merge or publication has occurred. Production remains on Wave 4.
- This checkpoint is incomplete implementation, **not a release candidate**. No Wave 5 PR exists yet.

## Work saved

Wave 5.1 foundations: Quick Add/Guided Setup entry, authorized duplicate review, private durable setup drafts and action receipts, reviewed execution through existing commands, and an additive local migration. Calendar day/week slot selection, move/resize proposals and confirmation reuse existing occurrence-change flows. Other calendar views remain available; configuration is grouped separately.

New migration: `supabase/migrations/20261020153417_studio_operations_workflows.sql`. New setup backend: `netlify/functions/_v2/setup.ts`; domain/data/UI in `src/domain/studentSetup.ts`, `src/data/studentSetup.ts` and `src/features/coach/StudentGuidedSetup.tsx`. Calendar proposal domain/grid/dialog are new local files alongside the existing calendar integration.

## Validation already completed

- Fresh `npm run typecheck`: PASS at this pause checkpoint.
- Focused unit/component checks: 6 tests across 3 files passed (calendar proposal domain, setup domain and existing LessonCalendar component).
- `scripts/test-studio-operations.mjs`: disposable PostgreSQL 17 replay of 62 migrations passed; tested name-only creation, duplicate review, authorization, durable draft/review, stale versions, receipt replay, lesson conflicts and zero outbox delivery. The script stops its disposable server in `finally`.
- Full lint/build/browser/RLS/concurrency acceptance and release checks have **not** been completed for Wave 5.

## First work on resume

Finish and review 5.1 before expanding the implementation:

1. Fix `student_setup_context`: its package projection references `packages.status`, which does not exist. Invoke this RPC in regression tests (the existing replay tests do not exercise it).
2. Bind reused contact identity/version and exact invitation recipient to server-side review; show the actual recipient before approval and reject stale changes.
3. Complete optional email/phone editing and minor/access safeguards; preserve successful package action results rather than re-quoting completed actions.
4. Check every proposed recurring occurrence for conflicts, not only the first. Add explicit finite/range validation for rescheduling duration.
5. Add two-session concurrency, failure recovery, context/contact/minor tests and focused UI checks. Review private draft state reset on identity change.

Then implement the outstanding financial dashboard/bounded drill-downs, Inbox activity and guardian context revocation, Actor Page builder/referrals, campaign blocks/drafts/review/scheduling, and the complete Settings consumer audit. These workstreams are not implemented yet.

## Important implementation facts

- Financial tables are `studio_invoices`, `payment_entries`, `invoice_settlements`; settlements can already have matching payment entries. Do not double count. Packages have no `status`. Reuse `student_credit_summary` for lesson credits and keep currencies/receipts/refunds/snapshots distinct.
- Existing Settings updates perform read/modify/write without sufficient concurrency protection. Repair authorized patch semantics and actual consumers; do not merely redraw controls. Settings panel URLs currently initialize only the email panel.
- Existing platform-health provider calls must not be used to manufacture green health. Show configured/unverified versus actual known-success evidence without initiating delivery, payment or workers.
- Campaigns must retain the existing outbox and legacy text path; save/preview must not queue messages. Actor drafts and public revisions must remain separate.
- Keep new styles lazy where possible: ordinary bundle limits remain 130 KB JS and 25 KB CSS gzip; the existing main CSS has little spare capacity.

## Local validation and later release

Disposable PG runtime is `C:\Users\dariu\.codex\tmp\studio-pg17-runtime`; set `STUDIO_LOCAL_PG_RUNTIME` when invoking the focused script. Existing approved Ubuntu-24.04 WSL / Linux x64 Node 22 environment can build functions later. Do not upload Windows-native dependencies.

Staging Supabase: `lrxrivfqjpkvygozphoz`; staging Netlify: `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`. Keep all-deployment team-login protection and stopped automatic builds. Use restricted local credential helpers; never print secrets or copy private configuration into Git.

Before any coordinated production release, finish the entire approved scope, required checks, protected staging acceptance with exact cleanup, generated types, and fresh recovery/rollback gates. Reuse unaffected earlier evidence. Do not treat this checkpoint or earlier backups as automatic release approval evidence.
