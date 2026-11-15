# Stage C decisions 33–35 continuation

The previous reminder-readiness audit described three open product decisions. The continuation prompt now supplies those policies. The work here implements parts of their Stage C workflows. The Stage D gate remains open because the remaining implementation needs to be finished and verified.

## Shared billing contact · decision 33

In Payments, expand the household and open **Pool billing contact** on the shared package. A coach can select a verified contact, review the proposed route by student, supply a reason, confirm, or clear the designation. Exact retries use a durable receipt. The private audit retains the actor, prior designation and new designation.

`credit_internal.shared_pool_billing_contact(pool, student)` accepts an already established pool and affected student. It uses the selected identity only while both its originating link and the affected student's link continue to permit finance access and notifications. An eligible student's designated payer is the fallback. The helper returns no contact if that student is outside the pool or no authorized contact exists. It does not choose the pool for a shortage. Ambiguous-pool detection and the coach routing alert still need integration before any Stage D delivery uses this helper. Communication preferences beyond the linked contact permission must be evaluated by delivery.

## Manual lessons · decision 34

For a studio-entered lesson with no service and no confirmed booking establishing billing, the guarded coverage read reports **Under Review** when a prior authoritative state does not already identify another outcome. It preserves lesson records and creates no financial obligation. This closes the misleading fallback to separate payment for that subset of legacy lessons.

The coach editor still needs the draft-and-confirm workflow. Both Student Workspace and calendar proposal entry points call the legacy create command. Add a private recoverable draft store, then require classification and route confirmation through the existing booking, eligibility and reservation transaction. The existing manual booking command records a service and uses pay-later, so sending prepaid confirmations through that command without an explicit policy change would misclassify them. Existing manually entered lessons should receive reviewed classification only where evidence supports it.

## Discretionary grants · decision 35

In student Payments, **Grant discretionary credits** uses the existing coach grant command with explicit studio service, duration, quantity and optional expiry. The command captures these terms in the existing snapshot before the first credit entry and allocation run. The grant uses the same ledger, coach audit, visibility and replay receipt. No payment is created. Coaches can also use existing package review for defined typed lots.

Custom household ownership, the legacy untyped-grant suppression and classification path, and enforcement across the older quick-add and direct grant entry points remain open. The current legacy allocator still allows an unknown compatibility result under some older paths. No historical terms were fabricated here.

## Database and rollout

The new private pool-contact table has RLS and no direct API grants. Both additional function-only migrations reuse the existing accounting ledger and guarded contracts. Reverting the client leaves audit and financial history intact. Retain the pool contact mappings, typed snapshots and grant entries during rollback. Any change to their effective behavior requires a reviewed forward migration.

Continue on draft #96. Finish and verify manual draft confirmation, typed discretionary issuance across supported ownership and legacy paths, and ambiguous-pool routing. Then branch Stage D from the exact verified Stage C head. No new policy decision is requested.

## Follow-up implementation

- Credit Attention lists ambiguous shared pools and missing authorized recipients for upcoming credit bookings. The backend reuses the booking evaluator and exact package terms, suppresses contested or unresolved routes, and records changes to unresolved findings in private audit. A unique established pool may route through the previously approved pool override or affected-student fallback.
- The student workspace's Add lesson action now opens a coach-scoped draft editor. An incomplete save creates only a private draft. A versioned draft can be reopened and edited. On confirmation, the existing manual booking transaction checks service, duration, billing arrangement and reason. Prepaid bookings use a verified eligible credit, and the explicit uncovered exception records a credit obligation when there is no available lot. The draft locks and stable booking key prevent duplicate confirmations. Explicit separate-payment arrangements stay outside the allocator.
- In a verified single-service shared lot, coaches can add discretionary credits with matching duration and effective expiration, a reason, and portal-history visibility. The grant uses the existing bulk adjustment command and ledger. It does not mutate payments or the pool's original terms.

### Gaps carried into the completion segment

The direct calendar-proposal creation path still uses the legacy unclassified command. Its existing calendar conflict and recurrence behavior must be carried into classified confirmation before replacing it. The general legacy allocator and standalone older grant paths still admit some unverified terms. The new classified booking path requires verified terms, and reminder routing suppresses an unresolved eligible balance. The studio-wide migration away from implicit legacy eligibility still needs implementation and reconciliation evidence. Custom shared grants currently add to a selected matching single-service lot. A new shared custom lot with a different expiry or service remains open.

These gaps blocked Stage D at the prior checkpoint. No additional product decision is needed. The three new migrations reuse existing booking, ledger and audit records. Reverting the client must preserve confirmed lesson links, private drafts, shared adjustments and routing history. Leave the migrations installed and use forward corrections to reconcile any later accounting effects.

## Browser evidence

The synthetic coach workflow covers saving an incomplete draft, reopening it, and keeping confirmation disabled until its required fields are present. See [desktop](credit-stage-c-evidence/desktop/manual-lesson-draft.png), [tablet](credit-stage-c-evidence/tablet/manual-lesson-draft.png), and [mobile](credit-stage-c-evidence/mobile/manual-lesson-draft.png).

## Completion segment

- Calendar proposals require a selected service, an exact slot duration and a billing arrangement before review. The existing conflict route still checks each occurrence. The database creates the series and all occurrences in one transaction, reserves through the manual booking command for each prepaid occurrence and writes one operation receipt. Failure rolls back the series. Proposals awaiting classification stay outside the lesson and credit records. The standalone future booking form requires the same classification, and historical recording keeps its existing explicit outcome and financial treatment.
- **Grant a new shared credit lot** under **Household credits** issues a single-service lot under an approved shared package definition. The coach previews the household, eligible students, quantity, expiration and visibility. Application rechecks that preview, saves one ledger issuance and queues the existing allocator for eligible students. Exact retries return the prior lot. The grant creates no payment.
- Both availability selectors require compatible terms. An unresolved historical reservation is shown for review. Untyped discretionary grants and positive increases to untyped lots are rejected. A typed package or a new typed grant can increase a balance. Historical balances can still be reduced with a reason when reservation protections permit it. Where cancellation policy extends expired individual credits, the returned lot inherits verified terms from the original lot.

The migration `20261115201508_finish_credit_classification.sql` replaces booking and credit commands, adds the shared issuance action and validates positive coach ledger adjustments. It makes no historical data edits. Preserve new series, grant receipts and the associated ledger during rollback. Correct applied accounting through a forward migration. Reverting only the application would leave its old calendar form unable to confirm against the new contract.
