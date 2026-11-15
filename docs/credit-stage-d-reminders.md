# Stage D credit reminders

Stage D is stacked on Stage C draft PR #96. Lesson shortages are derived from the existing booking coverage evaluator and billing recipient resolver. Low-credit conditions use the available balance from the authoritative package ledger and verified purchase-time service and duration. A covered reservation is never treated as a shortage. Low-credit notices require a future eligible prepaid lesson and yield to an actionable shortage in the same credit type.

## Coach and portal workflows

Open **Credit Attention** from Today. **Reminder settings and templates** manages studio, student and package thresholds. The studio default is two available credits. An explicit student threshold wins over the package threshold, then the studio default. A studio disable pauses every scope. The same panel controls authorized adult student copies and manages the low-credit, uncovered-lesson and follow-up templates. Preview uses synthetic records. Save creates a new version and keeps earlier versions available to review.

Set the issue filter to **Credit reminders** to see active and suppressed conditions, routing conflicts, and email results. Open the linked lesson or credit account to review the underlying obligation. Pause, resume, and dismissal require a reason. Dismissing an uncertain delivery releases its condition for a later cycle. It does not retry that transmission.

Authorized students and guardians receive in-portal notices in the notification bell and can view **Renewal reminders** in Credits & Lessons. Shared lots produce one condition per pool. When eligible members have different payer identities and there is no uniquely authorized route, external delivery is suppressed for review. Adult student copies use neutral text and omit shared balances and billing details.

## Delivery and rollback

- `20261115203509_credit_reminder_conditions.sql` provides the durable shortage conditions and base coverage evaluator.
- `20261115205001_credit_reminder_delivery.sql` makes additive changes to that condition table and adds private settings, template versions, scan positions, deliveries, and attempt receipts. It adds guarded worker and portal RPCs. Historical credits, bookings, payments and existing outbox records are retained.
- The existing five-minute automation worker starts reminder work only when `WORKER_CREDIT_REMINDERS_ENABLED=true` and the existing automation worker is enabled. The new flag defaults off. Deployment alone does not opt in. When active, the new condition scheduler takes ownership of low-credit and shortfall notices from legacy automation. Expiration notices retain their existing workflow.
- Stable condition IDs and per-cycle recipient/channel constraints prevent duplicate staging. A database claim locks an email before transmission. The worker rechecks eligibility, current identity, email address, preferences, template version and pause state immediately before sending with the existing Gmail adapter. A portal delivery or acknowledged email anchors a 72-hour interval. Unstarted claims can be reclaimed. Confirmed pre-send failures retry up to four times. An ambiguous or abandoned transmission needs coach review. It is excluded from retries and overlapping follow-ups.
- For rollback, leave the delivery receipt and condition tables in place, disable the release flag and remove the worker caller if reverting the application. Reconcile any in-flight email with its provider before taking further action. Avoid replaying historical notifications or deleting their receipts. Credit balances and payment records are independent of reminder activation and rollback.

## Protected hosted acceptance

A separately approved exact-head deployment, matching migrations and synthetic role sessions are required. Use a dedicated test delivery account and synthetic destinations. Confirm the scheduler/listen gate and existing provider controls through the approved release procedure. Use test-mode Stripe only if testing a verified renewal checkout. Keep real students and live delivery outside this acceptance.

Verify these scenarios and retain redacted evidence of condition IDs, channel outcomes and template versions.

- A typed package reaches its threshold after a reservation. The relevant payer receives one portal notice and a verified test email. A valid existing reservation remains Covered. A qualifying renewal or grant resolves the condition.
- A confirmed uncovered lesson triggers the shortage template. Processing, cancellation, expiration, reconciliation, and an invalid recipient all prevent a stale send.
- Two synthetic students use one shared pool. A valid pool-level payer is selected once. Conflicting payer identities require coach review. A reassigned or revoked recipient cannot receive a previously queued email.
- Delivery replay and competing claims produce one send. A failed pre-send credential operation retries. An ambiguous provider acknowledgement remains available for review. A 72-hour follow-up is eligible only while the underlying condition persists.
- Coach settings, template preview and version history, pause and resume, and failure monitoring work at desktop, tablet, and mobile widths. Students and guardians can see only their own authorized history. Cross-household and anonymous access are denied.

Collect exact-head health metadata, schema replay logs, browser screenshots, and synthetic provider acknowledgement evidence. Remove test-owned records only through the approved cleanup process after evidence is recorded.

## Responsive evidence

Each folder includes the coach template preview, coach delivery history, student history, and guardian history from the isolated browser suite.

- [Desktop screenshots](credit-stage-d-evidence/desktop)
- [Tablet screenshots](credit-stage-d-evidence/tablet)
- [Mobile screenshots](credit-stage-d-evidence/mobile)
