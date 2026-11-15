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
