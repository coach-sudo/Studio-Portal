# Worker containment and staging handoff

Implementation scope: server processing only. No hosted configuration, migrations,
identities, provider activity or deployment is performed by this change.

## Configuration

Set these **site-specific, Functions-scope** variables through Netlify, in the
intended deployment context. Do not put them in Vite/client configuration, team
defaults, request headers or `netlify.toml` build environment variables.

| Variable                             | Processing controlled                                                                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WORKER_PROVIDER_INTAKE_ENABLED`     | Scheduled/manual intake dispatch, signed background intake, Calendar/Gmail import, stale review cleanup and manual review/replay approval          |
| `WORKER_CALENDAR_ENABLED`            | Calendar projection schedule, claim and provider synchronization; calendar failed-work requeue                                                     |
| `WORKER_BOOKING_MAINTENANCE_ENABLED` | Maintenance dispatch/background, bulk recovery, lesson effects, holds/series, credits, gifts, renewal billing and retention                        |
| `WORKER_AUTOMATIONS_ENABLED`         | Rule evaluation/manual execution and notification outbox delivery, including delivery requested by user commands and webhooks; outbox retry routes |

Intake's Calendar **read/import** belongs to the intake pipeline, so its schedule
and processor share one control. Calendar projection is a separate pipeline.
Maintenance also checks the automation control before its explicit notification
processing. The combined integration-retry command requires both Calendar and
automation controls, preventing a partially requeued command.

Precedence in `worker-controls.ts`:

1. A present per-worker setting wins. Only the exact string `true` enables work.
   `false`, empty, whitespace, other casing and malformed values disable it.
2. Without a setting, trusted Netlify `SITE_ID` identifies dedicated staging
   `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`: **disabled in every context**, including
   its primary `production` context.
3. Missing settings preserve enabled defaults only for the existing production
   site `93829451-dbcf-4863-a07f-fa448cb17494` in `production` context. Unknown or
   missing primary site identity fails closed. Hosted previews require opt-in.
4. Unlinked local/dev/preview execution retains its existing defaults. This is
   not a hosted isolation attestation. Runtime `CONTEXT` takes precedence over
   generated build context; neither request URLs nor headers participate.

Netlify supplies the reserved site/deploy metadata. These settings are execution
controls, not authorization: coach authorization, HMAC/worker/deploy binding,
RLS and production-context fixture denial remain enforced. Normal booking,
calendar viewing, materials, payment interfaces and transaction-created queued
intents remain available; disabled delivery leaves those intents pending.

## Disabled execution and recovery

Disabled schedules and authorized manual routes return HTTP200 with
`{ok:true,status:"disabled",worker:...}` before constructing a service client or
claiming/dispatching work. Background handlers still validate their signed
delivery before checking enablement; no key or invalid signature never grants
access. Netlify discards background return bodies and returns its own202: use
the `worker.disabled` invocation log and unchanged database state as evidence,
never202 alone. Disabled shared processors also enforce containment.

The settings are deployment-scoped snapshots. Changing a Netlify variable
**requires a new deployment**; this is not immediate cancellation of an old
invocation or an old immutable deployment. Rechecks occur before dispatch, after
claiming, between intake studios/items/pages, maintenance stages/accounts,
automation entities/recipients, and before Calendar writes/Gmail sends. An
already-started item/transaction/provider operation settles normally, retaining
idempotency keys and authoritative success records; do not interrupt its
financial settlement or erase its pending intent.

- Intake/maintenance receipts stopped after claiming are finished as failed with
  the safe `configuration` category and the existing token fence. They remain
  recoverable. If persistence is unavailable, the original20-minute lease remains
  authoritative; never force expiry while the original worker can still run.
- Unstarted bulk and lesson-effect claims retain their existing expiring leases.
  Credit account checkpoints occur between atomic account RPCs.
- Calendar stops before new provider writes. Interrupted owned projections are
  finished as failed using their existing claim token; untouched claimed items
  recover through existing lease expiry. No newer projection is cleared.
- Unstarted outbox claims are restored to queued only when ID, sending status,
  version and claim timestamp still match. Containment does not record failed
  delivery attempts. Once Gmail starts, persist the original delivery result.
- Unstarted renewal claims are released only when claim timestamp and attempt
  key match; the same renewal idempotency key remains for recovery. Once a
  renewal starts, finish its existing Stripe/idempotent settlement before
  stopping the next item.

These application controls do not revoke direct database administrator access.
No database privilege or concurrency mechanism is changed, and no migration is
needed.

## Staging deployment runbook — not executed

1. **Prepare isolated configuration.** Target only staging site UUID above and
   Supabase `lrxrivfqjpkvygozphoz`. Preserve all-deploy SSO, Git-only primary
   publication and fixture denial. Bind a dedicated `codex/` staging branch to
   the verified PR head; do not alter production `main` or production site
   settings. Record exact SHA and before-settings privately. Initially leave
   **all Functions-scope Supabase/provider/payment credentials absent** and set
   all four worker settings to `false` in staging's `production` context. Public
   staging URL/anon client configuration may be supplied in Builds scope; never
   copy a production service key, Google grant, Stripe key or real contact.
2. **Replace legacy timers before adding powerful credentials.** The minimum
   documented platform operation is a Git-derived primary publication of this
   exact all-disabled candidate to the dedicated staging site. Netlify schedules
   attach to the published deployment. A build stop/publication lock does not
   pause old timers, and these switches do not retrofit the old artifact.
   There is no verified independent timer-pause operation in the available
   platform interface. If credential-free replacement cannot be performed,
   obtain a supported staging-site timer suspension from Netlify before
   proceeding; do not guess an API or weaken SSO.
3. **Verify the new primary artifact.** Rebuild in primary context if required;
   independently check source SHA, build logs, health identity, function
   digests/modes/schedules, headers, bundle budgets and the four disabled values.
   Keep runtime DB/provider credentials absent during this bootstrap publish.
   Never substitute an old deploy or treat the prior preview package as this
   primary artifact.
4. **Prove disabled behavior and legacy quiescence.** Observe native scheduler
   invocations pinned to the new deploy: HTTP200 plus `worker.disabled`, no
   background dispatch/provider calls and no receipts/business-state changes.
   Capture request/deploy IDs and logs for all four schedules. Verify no further
   old-deploy scheduler starts across three ten-minute slots, and drain any old
   invocations/background retries for at least20minutes after the last old
   start, confirming terminal logs. Publication success alone is insufficient.
   If old timers continue or identity is ambiguous, stop here and add no service
   credentials. Do not manually invoke legacy workers to test containment.
5. **Add staging service access while still all-disabled.** After the previous
   gate passes, securely provision/verify the staging-only service credential
   and required primary configuration; leave Google/Stripe absent. Rebuild the
   same exact SHA with all four controls false and independently verify this
   artifact too. Using approved sessions, check authorized manual containment,
   denied unauthorized access and production-context fixture403 without fixture
   setup. Snapshot/compare receipts and protected records with read-only access.
   A valid signed background diagnostic, if separately authorized, must produce
   a disabled log with no claim; a transport202 proves nothing by itself.
6. **Enable individually.** Only after complete two-studio synthetic provenance,
   approved role identities and owned provider fixtures are established, set
   one appropriate control to exact `true` and redeploy the verified source.
   Reverify artifact/configuration and actual scheduler-origin processing with
   receipts and replay/credit invariants. Intake needs isolated readonly Google
   access; projection/outbox require separately approved write/send containment.
   Maintenance includes renewal billing: enable only with approved synthetic
   financial scope and required sandbox credentials. Stripe checkout/webhooks
   require test-only key/event provenance, signatures and supported delivery
   through the unchanged perimeter. Missing credentials remain BLOCKED journeys.
7. **Contain a misbehaving worker.** Set its control (or all four) to `false` and
   deploy the same verified source through staging's Git pipeline. Confirm new
   disabled logs and drain the previous artifact's invocations as in step4.
   Preserve all pending work, fences and histories; never force leases, restore
   the unrelated legacy deploy, or claim instant cancellation. Keep production
   untouched. If quiescence cannot be demonstrated, stop further testing and
   obtain supported platform suspension.

Platform references: [scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/),
[immutable functions](https://docs.netlify.com/build/functions/overview/), and
[function environment variables](https://docs.netlify.com/build/functions/environment-variables/).
