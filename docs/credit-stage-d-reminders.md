# Stage D credit reminders

Stage D is stacked on Stage C draft PR #96. Its first migration adds durable, private shortage conditions. A service-only refresh uses the existing lesson eligibility evaluator and billing-recipient resolver. It reads confirmed prepaid bookings and suppresses conditions for payments in progress, review states, ambiguous pools and missing authorized contacts. A compatible available credit or a valid reservation ends a shortage. Bookings that are past, canceled or otherwise no longer actionable resolve their condition.

A student's lesson has one stable condition. Repeated evaluation retains its identity and initial due time. Once an acknowledged delivery is recorded, the next due time is 72 hours later. Recipient revocation clears the due time and recipient reference. Coverage and recipient eligibility must be checked again at delivery.

## Next implementation

1. Add low-credit conditions using the existing individual and shared credit projections. Add studio, package and student settings with clear precedence. Suppress overlapping low-credit conditions when a lesson shortage provides the action.
2. Add concurrency-safe dispatch claims and channel-specific receipts. Integrate with the existing outbox and delivery eligibility checks. Treat ambiguous provider acknowledgements as requiring review. Add configurable authorized student copies.
3. Add template editing and synthetic previews, student and guardian histories, and coach suppression and delivery monitoring in Credit Attention.
4. Add isolated end-to-end delivery and authorization coverage. Verify protected-hosted acceptance separately, including exact-head schema, synthetic roles and test provider configuration.

This branch's refresh command is unconnected to any scheduler or delivery service. No reminder messages can be queued by the migration or refresh. Keep deployment, migrations, provider changes and sending subject to explicit release authorization. On rollback, retain persisted condition records and remove the caller integration. No financial or credit ledger records are modified by refresh.
