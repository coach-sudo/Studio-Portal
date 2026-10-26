# Weekly audit remediation — October 26, 2026

## Phase 0 findings (before implementation)

Production confirmed through the Netlify project and deploy APIs: `078f3f83a456d049b28c287b69d4e4a46c3f6056`, deploy `6ad8e4ee73c3bc97c37dd94f`, published October 21, locked. The local checkout was clean at `883fe70` on the prior Wave 6 branch. Remediation starts from `origin/main` on `codex/weekly-audit-remediation-2026-10-26`.

### Confirmed problems

- Production intake: 18/18 scheduler requests returned 499 in 12:00–15:00 UTC October 26. Request `01M5WB1KJAQ40KFBQX2DCEWA5B` identifies the client as **Netlify Functions Scheduler**, function operation `provider-intake`, 14.976 seconds, no completed invocation telemetry. This does not prove Lambda never started.
- Maintenance also has repeated scheduler 499 attempts, followed in some slots by 200 responses around 13.5–14.1 seconds. Request `01M5F4F5Y18Q61NRREX441886W` on October 21 returned 502 after 9.292 seconds with an opaque thrown object. Existing code throws PostgREST objects without a worker error boundary.
- Intake performs the full provider scan in the synchronous scheduled handler. The background entry is a separate coach-authenticated route, with no dispatch from the scheduler. Its caught error becomes a returned response even though background return values are discarded, suppressing platform retries.
- Maintenance makes repeated sequential per-booking, per-lesson and per-package reads. Several reads/writes ignore returned database errors. There is no whole-run lease; individual financial/effect jobs have their own claims and locks.
- Installed DOMPurify is pinned to 3.4.15. CSS thresholds are 22,000 advisory / 25,000 failure bytes gzip; the audit reports 24.04 KB. Lint currently has no non-increasing warning inventory.

### Suspected causes, not proven

The synchronous intake workload is inappropriate for a short scheduler request. However, official Netlify documentation specifies a 30-second scheduled limit, whereas observed cancellations are about 15 seconds. Scheduler/client cancellation, cold start and platform routing behavior remain possible contributors. Do not describe this as a proven 15-second Lambda timeout.

Maintenance database statistics inspected read-only: `extend_ongoing_series` mean 19.09 ms / max 776.62 ms; `expire_booking_holds` mean 11.35 ms / max 745.42 ms. These aggregate statistics do not identify the failing October 21 stage. Repeated cross-region HTTP round trips are a plausible latency contributor, not a measured stage attribution.

### Ruled out / existing protections

The deployed artifact includes all four correct schedules: intake every ten minutes; maintenance, calendar and outbox every five minutes. Intake is `stream`; `provider-intake-background` is `background` and has only `/api/v2/admin/provider-intake`. No deployed edge functions. One non-forced SPA rewrite. No demonstrated naming collision or missing artifact. Runtime is Node 22 in us-east-1; production Supabase is us-west-2. Preserve these settings pending measured justification.

Production has all 70 repository migrations, through `20261021135617_provider_intake_review_safety`. Preserve PR #66's transactional review/replay, identity ambiguity rules, occurrence mapping, credit locks, effect leases, Stripe idempotency, fixture denial, protected provider health, secret scanning, generated types and required `verify`, `migrations`, `smoke` gates. No production worker or provider was manually invoked during investigation.

### Unverified risks / release gates

No approved production coach/student/guardian test sessions have been established. Live authenticated checks and provider review-record tests remain blocked until an approved safe identity/provider path is available. Three real scheduled executions require a published candidate and remain pending explicit publication authorization. Staging is SSO protected and currently points to an older deployment. The production deploy API reports `deploy_source: api` / `manual_deploy: false`; current Git-only build policy must be checked separately before release.

## Official references

- [Scheduled functions](https://docs.netlify.com/build/functions/scheduled-functions/): synchronous entry, 30-second limit, schedules run only on published deploys.
- [Background functions](https://docs.netlify.com/build/functions/background-functions/): awaited 202 means invocation accepted, not processing success; up to 15 minutes, error retries after one and two minutes.

## Verification and release status

Implementation and evidence are in progress. **NO-GO** until candidate checks, migration verification, isolated acceptance, safe provider evidence and release provenance are satisfied. Post-release scheduler verification cannot be claimed before authorized publication.
