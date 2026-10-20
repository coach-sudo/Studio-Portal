# Wave 5 — Studio Operations release record

Status: implementation and isolated validation in progress in draft PR #63. Five additive staging migrations and one protected, unpublished staging draft have been verified. No hosted acceptance fixtures, production migration, merge or publication has occurred. This is not yet a release recommendation. Wave 6 is excluded.

Branch: `codex/studio-operations-wave-five`, based on merged Wave 4 `d9643d208c406b5f5c8f18c372dac6e45dcf04a1`. The approved Wave 5 request and modernization master plan remain the scope. The October 20 usage pause has ended; `wave-five-pause-checkpoint.md` is historical.

## Implemented locally

- One Add Student entry, name-only Quick Add, authorized duplicate review, same-record Guided Setup, durable drafts, frozen action review and atomic database receipts. Interrupted committed actions recover their receipts; unknown invitation outcomes stop for review. Responsibilities and access remain independent.
- Day/week slot selection, drag/move and resize proposals; existing occurrence change review remains authoritative. Source event positions stay unchanged until execution. Calendar configuration is grouped separately.
- Authorized financial facts shared by dashboard totals and 25-row drill-downs. Cash receipts and refunds use payment entries once; invoice settlements are not added again. Currencies stay separate. Periods use studio-local calendar months, while liabilities/checkout/credit metrics are snapshots. Negative dollar-credit exceptions do not offset another student's prepaid credit.
- Conversation selection preserves URL context. Searchable/filterable, bounded activity and actionable attention; exact conversation/message and Household links. Account provisioning/sign-in evidence is distinct from invitation delivery and current access. Active portal context refreshes every 15 seconds/on focus, clears affected cached student data on permission changes, and relies on current server authorization for subsequent operations.
- One Actor renderer for public pages and private visual editing. Classic preserves legacy layout; Spotlight and ordered approved sections are versioned JSON. Draft status is separate from the live revision. Approval, publication, media snapshot, audit and replay receipt commit atomically. Public media remains subject to current approval/access checks.
- Campaign blocks, three starting templates, legacy text compatibility, durable drafts, content/audience/schedule-bound review and transactional outbox queueing. Preview and delivery use the same HTML/plain-text renderer. Consent is checked again at queueing and delivery. Draft saves/preview do not queue messages.
- Seven canonical Settings categories, legacy URL aliases, dirty/cancel handling and authorized nested patches with conflict detection. Default pricing does not overwrite service-specific overrides or issued agreements. Health observes configuration and stored success evidence without provider probes. Project retention is operator-managed; workspace export is explicitly not a full database/Auth/Storage backup.

## Additive migration order

1. `20261020153417_studio_operations_workflows.sql`
2. `20261020183938_studio_operations_reads.sql`
3. `20261020184422_studio_publication_workflows.sql`
4. `20261020185011_studio_campaign_drafts.sql`
5. `20261020185650_studio_settings_patches.sql`
6. `20261020201048_studio_actor_legacy_draft_compatibility.sql`

No existing financial balances or issued prices are rewritten. The previous application remains compatible during the schema transition. Schema recovery is forward-only; application rollback must retain additive schema and immutable receipts.

## Evidence so far

- Native disposable PostgreSQL 17: complete 66-migration replay and focused workflows passed, including real separate-session reservation-command replay; duplicate/foreign authorization; stale review; reused contacts; recurring conflict rollback; finance metric/drill-down parity and timezone boundaries; stable Actor publication; campaign consent/replay/suppression; nested Settings conflicts and cross-session persistence; interrupted setup recovery; guardian context/direct-read/command denial after revocation. No provider calls or hosted operations.
- New focused rendering/component tests: 9 passed (safe shared campaign preview/delivery, Actor layout compatibility, immutable calendar proposals, financial supporting links/error state, nested Settings patches, URL aliases and provider-free health).
- Complete unit run: **863 passed, zero failed**. Focused regression checks also cover shared campaign preview/delivery, authoring safety, immutable calendar proposals, exact financial links, canonical Settings URLs and provider-free health. Image blocks reject account/unsubscribe macros so image loading cannot invoke an account action.
- Linux Supabase PostgreSQL 17: **66 migrations replayed; 260 pgTAP assertions passed across 10 files**; migration lint has zero errors. Generated public types come from this isolated stack. All four existing real-session concurrency suites passed (credits, occurrence changes, bulk management and study notes).
- Typecheck and formatting passed. Lint has zero errors (892 warnings, including existing debt). Dependency audit has no high/critical findings; one low-severity DOMPurify finding remains in the unchanged dependency. Ordinary shell output was approximately 99.47 KB JS and 24.03 KB CSS gzip; lazy PDF artifacts remained separate. Final Linux configured-client/package checks remain required.

The Settings matrix is in `wave-five-settings-coverage.md`. Final CI, responsive/contrast/accessibility review and protected hosted acceptance are pending. The full earlier Waves 1–4 acceptance evidence is reused for unaffected paths. Fresh read-only infrastructure checks confirmed both sites' stopped builds, staging all-deployment team login, no staging provider keys, function-only service secrets, `VITE_QUERY_LAYER_V2=true`, disabled staging Auth hooks and the unchanged Wave 4 production publication.

## Staging checkpoint and runtime corrections

The first protected draft, `6ad7c70c473cc2d071f77fd3`, packages commit `2d8e54af0fbce7a48705043745d0d53aab823b5e` with 23 Linux/Node 22 functions. It is ready, unpublished and in `deploy-preview`; anonymous health returns 401. Existing staging publication and Auth URLs remain unchanged. Staging has 66 migrations; all 114 pre-existing business/Auth/Storage table baselines and prior migration history were preserved.

Production checks passed for that commit, but deployed browser CI identified two runtime corrections required before acceptance: an Actor save rejected preserved legacy `bio`/`sections` draft metadata, and the mobile Inbox composer could sit beneath navigation. The sixth additive migration validates incoming portfolio fields while retaining legacy content; unknown new keys still fail. Inbox now sizes the conversation against visible navigation/viewport bounds and puts secondary activity below conversations. Local deployed-test discovery and stale Settings/lesson action selectors were corrected without dropping the affected journeys. A replacement protected draft is required for these genuine runtime fixes.

Fresh read-only production backup and independent PostgreSQL 17 restore verification passed on October 20: 125 tables, 2,360 rows, 61 migration records, and 15 separately checksummed Storage files. Restricted backup location and integrity/restore evidence are retained outside Git. Logical database and Storage snapshots are not an atomic point-in-time backup; managed Auth/provider settings and external services remain separate recovery dependencies. This does not authorize using the backup-only database credential for writes.

## Release gates

Use only staging Supabase `lrxrivfqjpkvygozphoz`, staging Netlify `d83ff6cb-f57b-4741-8c3c-3eaae7adab19` and run-owned synthetic records during hosted acceptance. Preserve existing team-login protection, stopped automatic builds, manual accounts and unrelated baseline records. Hosted finance verification is read-only; charges, invoice issuance, reconciliation and ledger adjustment are excluded. Test immediate delivery/provider behavior locally with intercepted networking; hosted acceptance must not contact recipients or providers.

Before the one coordinated publication: complete mandatory checks and exact fixture cleanup, pin the candidate, verify a protected unpublished staging deployment, reverify production identity/CI/migration compatibility, create and independently restore a fresh restricted database backup, verify Storage recovery, and verify rollback controls. Production targets are excluded until those gates pass. Do not reuse expired earlier acceptance receipts or repurpose a password authorized solely for read-only backup.
