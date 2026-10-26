# Wave 6 final quality checkpoint

> Historical implementation checkpoint. Current production was confirmed on October 26 at `078f3f83a456d049b28c287b69d4e4a46c3f6056`, deploy `6ad8e4ee73c3bc97c37dd94f`, publication locked. See [the weekly remediation report](weekly-audit-2026-10-26.md) for current operational evidence and pending gates. The baseline and remaining-gate wording below records the earlier checkpoint and is retained as history.

Baseline: published main `1080950f9c9b8252979c90ac44e0b4a6960932c0`, deployment `6ad86c4f9894f6a2e8111e33`. Reverified on October 21, 2026: production health matches, publication locked, builds stopped, Git-only production enabled; 69 production migrations. This document records implementation evidence, not authorization to bypass pending release gates.

## Targeted corrections

- Student/guardian first access could strand active queries at “Preparing your workspace…” while the default student was written to the URL. Compare the authorized selected identity, preserve queries for that initialization, and reset/refetch observed queries when permissions actually change.
- Student/guardian More/Search openers now explicitly receive focus, matching the coach shell. This repairs WebKit Escape-to-opener restoration.
- Provider identity matching no longer chooses the first sibling sharing a guardian address/name or preferred name. A unique full student name can resolve shared contact data; existing name-only learners remain supported.
- Superprof discovery, classification, attribution and display are supported alongside Lessonface, Wyzant, Lessons.com, Calendar and direct bookings. Unknown Calendar identities require existing coach review.
- Gmail changes require review of an exact lesson/version rather than nearest-date guessing. Reviewed emails are not reopened by repeated scans. Cross-student provider/time matches cannot suppress another student's lesson; Calendar signals matching existing occurrences go to review.
- The existing review command is one transaction using existing operation receipts/audit records: create/link/ignore, approved calendar intent, credit recovery and occurrence changes. It preserves provider classroom URLs, never invents an email or grants portal access, and refuses ambiguous/shared-record reassignment. Calendar and Gmail payloads are both understood. Group IDs/timestamps are frozen in the reviewed request; new matches are not added. Stable browser request keys permit safe retries.

The one required additive migration is `20261021135617_provider_intake_review_safety.sql`. It extends provider CHECK constraints and adds the transaction behind the existing command; no historical data is rewritten. The invoker RPC delegates to a private helper with explicit authenticated coach checks, empty search paths and restricted execution grants. Existing occurrence, ledger, invoice, class, notification and calendar safeguards remain authoritative.

## Evidence completed locally

- 50 focused unit/integration tests: provider parsing/classification/recovery, selected-context cache behavior, permission-change refresh and existing route-query behavior.
- Native PostgreSQL 17: 31 intake assertions; the existing 21 occurrence-safety and 32 lesson/security assertions pass against the changed command path. Late audit failure rolls back all preceding writes; the same key succeeds after rollback. Two separate sessions prove exactly-once replay; owned fixtures and coverage jobs are removed.
- Large rollback-only PostgreSQL fixture: 1,000 students, 10,000 historical lessons, 1,000 canonical resources, 200 legacy assignments, 20 packages, two authorized guardian relationships and 4,000 messages. Ten bounded-read/permission assertions pass; complete setup/assertions/rollback took about seven seconds locally (not a production latency claim).
- Six focused Chromium/WebKit shell journeys at 320/390/768/1440 and 720 CSS-pixel reflow equivalent to a 1440-pixel window at 200% zoom. Includes 320×568 More sheets, keyboard trap/Escape/restoration, visible logout, no horizontal overflow and no eager PDF assets. Zero serious/critical axe findings. Reflow equivalence is not a claim of native browser-toolbar zoom or assistive-technology testing.
- Two focused Chromium/WebKit provider-review journeys: exact occurrence selection, unavailable create action for changes, visible command failure and stable retry key; zero serious/critical axe findings.
- Public schema types generated from the isolated stack. Typecheck/build and bundle failure budgets pass: ordinary JS ≤130 KB, CSS ≤25 KB, PDF renderer ≤250 KB and worker ≤500 KB gzip. Existing CSS warning threshold is still exceeded; no stylesheet growth in this change.

## Evidence reused and limits

PRs #63–65 are the release truth. Reuse their unchanged 132 responsive page states, real disposable branding upload/reload/new-session/replacement/removal/renewal checks, Settings consumer coverage, guardian denial/revocation, financial/recurrence, private annotations, public compatibility and controlled cleanup evidence. Do not interpret historical pending wording in earlier checkpoint documents as current release status. No owner branding or live student records were edited here.

Gmail/Calendar live connectivity is **not verified**: supported existing Netlify credential retrieval returned absent/redacted values. No replacement credentials, provider messages, invitations, charges, calendar edits or workers were invoked. Provider acceptance here uses intercepted fixtures and PostgreSQL transactions; integration health must retain configured/unverified or unavailable status.

Explicit bounded search, resource, activity, financial and summary reads are retained. Legacy route snapshots still aggregate visible domain collections; this existing scaling constraint is not a claim of universally bounded retrieval, and Wave 6 does not introduce a broad query-layer rewrite. Keyboard/semantics checks and axe do not establish a full screen-reader conformance audit.

## Remaining release gates

One coordinated PR; exact candidate CI and focused protected-staging acceptance; staging migration/history and cleanup verification; current recovery/backup review; held Git-built production artifact identity; one conditional publication with post-publication health and protection checks. Production remains on the baseline until these pass. Preserve additive schema on application recovery; do not delete financial/audit history.
