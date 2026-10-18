# Independent Wave 1 hosted UI executor

October 18, 2026, Eastern. **Implemented and validated locally; NOT authorized or executed on hosted staging.** The application pin is `f5324b203387a158df3c050569b95a9044368bc0`; the new run is `e2e-wave1-ui-20261017-a`. Read the [candidate report](wave-one-final-ui-candidate.md), [prepared manifest/code seal](wave-one-ui-mutation-executor-plan.json), [validation evidence](wave-one-final-ui-evidence.json) and [historical proposal](wave-one-ui-browser-mutation-proposal.md).

## Components and authority

`scripts/staging/hosted-ui.mjs` has explicit `--prepare`, `--execute` and `--resume-cleanup` modes; no default execution. Preparation is offline and writes no approval. `ui/policy.mjs` supplies exact targets, deterministic ownership, budgets and payload checks. `journal.mjs` implements a private fsynced hash chain and exclusive run lock. `engine.mjs` verifies all 76 tables, original rows, schema/function/trigger seal, command consequences and durable receipts. `fixtures.mjs` contains the fixed setup, exact-job processor and cleanup. `cases.mjs` supplies the ordered UI01–UI09 assertions. `browser.mjs` drives the actual forms; `network.mjs` blocks unapproved browser and Node endpoints. `hosted.mjs` is the separately gated real Auth/perimeter/HTTP adapter. `private.mjs` enforces canonical external paths and Owner/SYSTEM or owner-only permissions. `artifacts.mjs` augments the offline Linux static-file receipt. `postcheck.mjs` independently verifies cleanup without importing the engine or cleanup implementation.

`local-http.mjs`, `local-browser.mjs` and `validate.mjs` exist only for disposable validation. They are never imported by the hosted adapter. They exercise the real V2 handler, Supabase SDK, PostgreSQL RLS/functions/triggers and built React application; Auth and the REST protocol adapter remain local substitutes. No code or authority is imported from the H01–H16 engine, policy, receipt or journal. The shared read-only schema-fingerprint SQL and 76-table inventory are sealed inputs, not H-run authorization.

The normalized fixture manifest explicitly changes the historical proposal's invalid lesson payment label `unpaid` to the installed schema's `due`. IDs, dates, ownership, budgets and financial policy are unchanged. New memberships have deterministic IDs; the existing contact trigger creates the relationship UUID, which is captured and validated by its exact new user/student relationship. The only generated lesson comes from the actual native create response. No file is silently overwritten or rebaselined.

Windows permission checks use the available PowerShell 7 `pwsh.exe`; the older Windows PowerShell process could not load its Security module in this environment and failed closed. A real, secret-free local file probe now passes canonical-path, Owner/SYSTEM write and independent read checks. An unavailable PowerShell runtime or invalid ACL stops before any hosted operation.

The executor source seal canonicalizes physical CRLF to LF before hashing each sealed text file, matching Git's text representation. A regression test verifies both checkout styles produce the same seal and actual text changes do not. Application commits, deployment bundles, private journals and retained row/artifact hashes keep their exact identities; historical migrations are untouched.

## Immutable budgets

| Resource                                                        |                                         Hard ceiling |
| --------------------------------------------------------------- | ---------------------------------------------------: |
| New confirmed Auth identities                                   |                                                    4 |
| Students / contact / relationship / memberships / service / lot |                                2 / 1 / 1 / 3 / 1 / 1 |
| Lessons                                                         |  13 cumulative: 12 seeds and exactly one UI creation |
| Granted lesson credits / cash                                   |                                               4 / $0 |
| Items per reviewed job / persisted previews                     |                                               13 / 4 |
| HTTP mutation/session attempts                                  | 30 total; at most 24 business and 6 session requests |
| Canonical SQL mutation requests                                 |                                                   60 |
| Read requests                                                   |                                                  600 |
| Cleanup transactions / Auth admin writes                        |        40 / 8 (create four, delete three, ban coach) |
| Peak owned rows / cumulative row identities                     |                                            384 / 512 |
| Provider calls / delivered messages / scheduled workers         |                                            0 / 0 / 0 |

Failures, denied attempts, duplicates and ambiguous requests consume their applicable budgets. A completed journal step returned without another network/SQL call is not a new request. SQL accounting counts each named canonical transaction and each explicitly invoked claim/process/occurrence RPC; its structural SQL preconditions are part of that bounded transaction. Independent read operations, browser assets, snapshots, seals and postchecks are counted separately. Schema plus row snapshots and the independent 76-table check are batched without reducing table coverage. No unused budget permits more scenarios.

The complete disposable browser lane uses 20 transmitted business wrappers plus one prevented post-revocation access-claim attempt, 30 canonical SQL units, nine cleanup transactions and eight Auth setup/cleanup writes. Exact final read consumption is in machine evidence; remaining headroom is for real hosted Auth/perimeter/metadata checks. The real lane has up to six additional session requests, yielding 27 combined HTTP attempts. Fresh execution must stop at 600 reads rather than relaxing the cap or hiding polling. Normal application polling is bounded by this same counter and stopped before cleanup.

## Reviewed cases

| Case | Actual UI / wrapper inventory and database proof                                                                                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI01 | New coach/student/guardian contexts and unrelated identity; owned Overview/Household/Payments/lesson reads; negative cross-student RLS. Hosted adapter additionally uses real password Auth, exact JWT identity and fresh authenticated RPC probes                                    |
| UI02 | Edit only coaching focus through the full unchanged identity form; validate owned student version and returned audit                                                                                                                                                                  |
| UI03 | Create one standalone, in-person, non-recurring lesson at the fixed date, record its actual UUID, then edit topic; preserve native `price_minor=null` and pre-coverage Review required                                                                                                |
| UI04 | Set remaining credits to four, review/enable automatic use, click live Apply eligible credits now, replay the original captured request/key once; assert four reservations, zero available and no second ledger debit                                                                 |
| UI05 | Select exact lessons across real 10-row pagination; archive two, duplicate acceptance with the original key, exact-job processing, restore two, then delete one dependency-free mistake while keeping the completed protected record; reopen saved results                            |
| UI06 | Freeze one archive review, edit its lesson through the actual UI, execute the stale review, process only that known job and verify one conflict/skip; reopen results                                                                                                                  |
| UI07 | Preview and confirm only the owned unbooked cancellation, with explicit credit policy; wait for the application's completed navigation; verify sibling/ledger/participant and notification intent isolation                                                                           |
| UI08 | Verify portal finance restrictions and refreshed nonzero coverage. Revoke only the new guardian contact through the guarded actual Manage Access form. Verify fresh server denial and absence of student content on refresh; block the root claim-access boundary before transmission |
| UI09 | Stop browser polling, verify originals, terminalize owned fixtures, clean exact temporary rows, remove three new Auth identities, ban/unlink the new coach, then independent all-table/retained-manifest/Auth readback                                                                |

UI replay probes are programmatic HTTP repeats of captured **actual UI bodies and original keys**, not a second UI click pretending to be the same request. Route transitions retain the live app/query context to avoid repeatedly downloading every chunk; pagination itself uses real controls. Fresh guardian revocation uses a full refresh. The broader browser matrices separately cover refresh/navigation, dialogs, focus and responsive behavior in both modes.

The proposed hosted side effects also include normal Supabase Auth/session/audit records for the four new identities and the application login wrapper's normal per-IP rate-limit increments. `public_endpoint_rate_limits` is the operational table excluded by the existing reviewed 76-business-table inventory; its normal login increments are not described as unchanged business rows or deleted during cleanup. The six-session ceiling counts executor/browser session attempts, including the outer application password wrapper; its normal internal Auth call is part of that session operation. Rate limiting or an unexpected Auth response stops execution without clearing buckets or automatically retrying. These side effects require the later B authorization; none occurred in this preparation phase.

The live credit component is used in both authenticated query modes; the older demo component is not substituted. Native unknown cash price remains unknown before coverage. Existing eligibility policy still allows a studio lesson credit to cover that lesson; no synthetic repricing or new policy restriction was introduced.

## HTTP safety matrix

| Boundary                                  | Permitted payload / prohibition                                                                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v2/students`, `update`         | Own target only; focus-only or exactly the independently reconstructed full form with every identity/delivery field unchanged                                               |
| Same, `save_linked_contact`               | Exact new contact, unchanged identity/responsibilities/preferences; only portal revocation and optional notifications off                                                   |
| `POST /api/v2/credits`                    | Own target, total exactly four, boolean automatic setting, apply; reconciliation/grant/package/payment routes blocked                                                       |
| `POST /api/v2/lessons`, `create`          | Exact target/email, one fixed one-hour in-person occurrence, no price/external/recurrence fields; only one submission ever                                                  |
| Same, `update_details`                    | Known lesson, approved topic, unchanged in-person location and no join URL                                                                                                  |
| Same, `preview_change` / `execute_change` | Only known `lesson-cancel`, cancellation, occurrence scope, no whole class, exact student context and review token                                                          |
| Same, bulk preview/execute                | Four approved archive/restore/delete reviews, explicit owned IDs, no matching/future/series/class expansion; exact frozen job/token for execution                           |
| Bulk/coverage/summary/delivery reads      | Explicit read commands/RPCs, bounded lists and known job/lesson IDs; delivery read sends nothing                                                                            |
| Session endpoints                         | Four new normal app-password logins, unrelated identity's separately counted negative-session fallback, guardian logout; no refresh, claim, OTP, reset, invitation or OAuth |
| Everything else                           | Blocked before transmission, including rescheduling, booking administration, providers, workers, fixtures, publications and arbitrary Node control-plane paths              |

Static assets bind to the approved artifact paths and hashes; the preview HUD read remains permitted. External decorative font requests are blocked and recorded; local geometry uses fallback fonts. This does not remove the Netlify toolbar or conceal its accessibility findings. Service keys never enter browser storage, assets, route fulfillment or journal events. Browser transport sends only the new role's access token to the exact host.

An existing wrapper audit limitation remains explicit: some V2 service-side audit inserts omit `actor_id`. The guard accepts only the **exact returned audit UUID**, source `studio_command`, correct entity ID/type and expected action for that specific submitted wrapper. Canonical financial/occurrence/bulk audits and SQL execution receipts must bind to the new coach and submitted correlation key or known job. This task does not silently repair or waive the underlying audit helper.

## Preflight and authorization

The executor requires a new private config, new exact-host perimeter state, approved fresh artifact receipt and a new UI01–UI09 approval with exact target, candidate, manifest hash, executor hash, all-table baseline hash, issue/expiry times, explicit cleanup and approver. Maximum window is 24 hours; future/expired/mismatched receipts fail. There is no timestamp extension, H-run fallback or auto-generated approval.

Config binds the exact staging site/project/studio. Direct PostgreSQL is the exact staging host/5432/postgres with `rejectUnauthorized=true`, default hostname verification and the previously authenticated Supabase Root 2021 CA. No pooler, alternate host, global trust change or insecure TLS option is accepted. The existing legacy anon/service JWT formats must carry the staging ref/roles and valid expiry; real Auth admin reads additionally validate the service credential server-side. New-format secret keys, placeholders, rotations and new credentials are not substituted. See [Supabase's documented admin confirmation](https://supabase.com/docs/reference/javascript/auth-admin-createuser) and [database TLS guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

Before fixtures: verify ready/preview/unpublished source and function digests, all-deploy team-login evidence, stopped builds, unchanged old publication, empty shared variables, exact ten preview-only site variables and absence of provider credentials; verify exact-host Site URL/callback pair and unchanged Auth hash with hooks/OAuth/custom SMTP absent; verify the 57-migration digest, complete schema seal, original Auth identities and all-table baseline. A protected health request must pass **before** any new Auth/business fixture. All four proposed Auth IDs/emails and all business IDs/JSON references must be absent before provisioning.

Receipt, config, connection and ownership checks run before every operation. Live infrastructure and protected-health attestations have a maximum 30-second freshness interval; supported all-deploy protection evidence expires after ten minutes. Original Auth identities are rechecked before every Auth admin write and at live attestations. Session/token expiry, baseline drift, unknown records, unexpected worker attempts or delivery activity stop the run. A private config change requires a new process/review; it cannot be silently adopted mid-run.

The present staging origin/Auth configuration has **not** been changed. The future real origin is unknown. Do not create a receipt until deployment identity, minimal Auth approval and fresh proof have actually been reviewed.

## Cleanup SQL and retained artifacts

Service processing locks only a known owned job and validates actor/studio/frozen items before calling the existing `claim_lesson_bulk_items(13, exact_job)` and `process_lesson_bulk_item(exact_item, exact_token)` functions. It never invokes a global sweep or scheduled worker. Each processing transaction rechecks all originals and runs under deterministic ownership and serializable/NOWAIT protections.

Cleanup SQL has this exact blast radius:

1. Disable automatic use for the two exact new students. Preview/execute canonical cancellation only for their remaining owned scheduled occurrences, using the retained-credit policy and journaled keys. Mark those two students inactive, hidden, portal-disabled and unlinked. Preserve their lessons and financial associations.
2. For run-owned outbox/effect/projection/coverage scaffolding, require zero delivery/attempt/claim/external identity. Delete by exact primary key **and complete JSON preimage**. Any conflict rolls back that transaction. No blanket studio deletion, trigger disabling or cascade policy is used.
3. Remove only the exact new relationship/contact, three memberships and service after baseline/dependency checks. No original/manual/H record is eligible.
4. Remove the three new disposable portal/unrelated Auth users; ban the retained coach for the documented duration with its memberships removed. Confirmed writes and exact-ID readback are required.

**Retain** the two terminal students, package/ledger, required lessons/participants, credit/occurrence receipts, record states, four reviews/jobs/items/requests, deletion snapshot and all audit evidence. Never remove financial history to obtain zero counts. The single UI-approved dependency-free deletion is performed by the existing authoritative bulk backend and leaves its deletion snapshot/audit. Cleanup performs no other physical lesson or ledger deletion.

Before completion, independent read-only code compares every original and allowed retained row fingerprint across all 76 tables, then verifies terminal students, no active lessons or memberships, automatic use off, no runnable jobs/leases/notifications and exact Auth cleanup. Retained ID/hash manifests and full journals stay private; sanitized table counts/hashes are suitable for the report.

## Recovery and local adversarial evidence

The final local database suite covers the successful wrapper lane, the actual built-app browser lane, unknown records, original-row changes, monetary/credit budgets, attempted Calendar work, durable HTTP recovery without resend, lost non-idempotent create responses, partial cleanup, a separate concurrent writer, denied roles, forged receipts, simultaneous executor calls, wrong baseline approval, ambiguous Auth creation and Auth identity drift. All are isolated new PostgreSQL 17 databases with the complete migration stack and ordinary constraints/RLS/triggers; none is a staging reset.

Intent is fsynced before submission. Responses, generated IDs, unchanged original keys, frozen IDs/tokens, snapshots and results are durable before marking a step committed. An interrupted confirmed SQL/HTTP result can be adopted only if the server snapshot exactly matches. A missing result, changed payload, unknown commit outcome, lost create response or ambiguous Auth action quarantines the run for exact-ID/receipt inspection. There is no automatic resubmission, new run, key replacement or broad cleanup.

`--resume-cleanup` requires all eight workflow case markers, the same target/code/journal and a still-valid authorization. It resumes only confirmed cleanup steps; unresolved Auth actions require readback/review. Reusing an already completed run for more mutations is prohibited. Cleanup failure preserves evidence and stops; renewed authorization cannot retroactively rewrite an expired receipt.

The real Netlify perimeter, hosted Supabase Auth/admin semantics, new artifact identity and hosted provider absence still require the later live gates. The native Auth stub and protocol adapter do not prove these vendor behaviors. The new executor remains a reviewable draft, not permission to run it.
