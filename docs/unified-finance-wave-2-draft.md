# Unified Finance Wave 2 draft

This branch starts at the published Wave 1 merge `9129154804e3314c26379ed031e6e287fc61398f` and its 88 migrations. The approved Finance prototype remains the reference for payment selection, review, household breakdown, and automatic-payment controls.

## Invoice-free checkout

Migration `20261120192345_invoice_free_lesson_checkout.sql` extends the existing training checkout operation. Each directly reserved lesson holds a reference to the existing checkout attempt. Under lock, a reservation checks payment authority, lesson and booking ownership, agreed price, verified prior payments, current package coverage, and the exact reviewed amount. A selection is reserved atomically. An active hold blocks invoice issuance, package allocation, and conflicting lesson changes. Existing invoices retain their current checkout path.

The existing signed Stripe webhook retrieves the current session before reconciliation. The settlement records one existing ledger entry per exact lesson using a stable operation key, then updates the authoritative lesson and booking records. Invoice creation continues to use the same records. Direct collection is limited to verified single-student obligations. Shared or multi-participant situations that require credit capabilities from Wave 3 stay in review, and invoice-backed and invoice-free items are reviewed in separate checkouts.

## Settings and household experience

- Payment Settings uses the existing payer profile, Stripe-held saved payment methods, and authorization records. Saving a card or authorizing automatic payments is optional for an eligible one-time checkout.
- Payments and lesson details show eligible invoice-free balances and link to the existing selection and review. Household payers can review several authorized lessons in one currency. Direct payment history links each settlement to its lesson.
- Existing consent review and versioned pause, resume, and end controls remain. The studio's 8,500-cent ceiling applies to a single scheduled automatic lesson charge. It is separate from the agreed price and the authorization cap a payer accepts.
- The approved selection and review layout remains in place. Recheck under lock rejects a changed price, balance, payer, or selection and requires a new review.

## Expiry and recovery

An unsubmitted reservation can be canceled and is eligible for recovery after 15 minutes. The endpoint records provider start before submitting to Stripe. After that point, the database keeps the hold until the verified session is paid, expired, or terminally failed. It never frees a provider-backed hold solely because time elapsed. An ambiguous request can be retried with the original attempt and Stripe idempotency key before the retry window closes. If Stripe's response and events are missing, an operator must reconcile the attempt against Stripe before any release. For a known open session, use Stripe's session expiration and reconcile the resulting event. Never clear lesson holds manually while money may still settle.

For rollback, disable `TRAINING_DIRECT_CHECKOUT_ENABLED` to stop new direct checkout requests. Keep the signed webhook and additive migration active while in-flight attempts drain or are reconciled. Keep confirmed payments and their allocations. Only consider a schema rollback after checking that no attempts remain unresolved and preserving the committed ledger and receipt history.

## Acceptance gates

The candidate passed 39 direct-checkout database assertions, 133 existing invoice, automatic-payment, and receipt assertions, and six separate-session database races. The targeted provider and payment-settings unit tests passed, including delayed failure and duplicate delivery handling. The connected review passed desktop and mobile browser tests using synthetic responses.

Earlier synthetic UI checks at 320, 768, and 1440 pixels and the authenticated Wave 1 coach walkthrough still apply to unchanged controls. The walkthrough on protected deploy `6b00861fe6d3dc3452106d72` opened the same $480 invoice from Account and Billing and submitted no financial command. The newly connected invoice-free controls still need protected browser and Stripe sandbox evidence, including authorized guardian checkout, add or replace or remove a saved method, and the applicable consent and failure recovery journeys.

The protected deploy must use exact baseline plus candidate migrations, synthetic users, a Stripe sandbox and matching signing secret, and disabled email delivery and unrelated jobs. Verify effective financial definitions and public/server targets before browsing. The historical staging database is outside the acceptance path.
