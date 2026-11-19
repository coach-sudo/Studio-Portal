# Coach’D integrated training candidate

**Release status is NO-GO until protected acceptance and production approval.**

## Integration

| Draft | Responsibility | Order and overlap |
| --- | --- | --- |
| [#101](https://github.com/coach-sudo/Studio-Portal/pull/101) | Lesson payment state, exact selection, invoice reservations and settlement | Base for the other drafts. Automatic charges use the same reservation and ledger. |
| [#103](https://github.com/coach-sudo/Studio-Portal/pull/103) | Coach-controlled invoice preparation from verified terms | Follows #101. Linked pay-later bookings use the same studio policy and invoice ledger. |
| [#102](https://github.com/coach-sudo/Studio-Portal/pull/102) | Payment timing preview and calendar billing distinction | Follows #101. The integrated arrangement reuses the page and distinguishes preview, pending setup, active, paused and ended states. |
| [#104](https://github.com/coach-sudo/Studio-Portal/pull/104) | Verified series continuation | Follows #101. Retains the exact held dates and adds a read-only review before confirmation. |
| [#106](https://github.com/coach-sudo/Studio-Portal/pull/106) | Learner dashboard and payment handoffs | Retains the exact next-lesson and upcoming-only filters alongside verified invoice preparation. |
| [#105](https://github.com/coach-sudo/Studio-Portal/pull/105) | Rendered accessibility and script source switching | Retains input stability and readable activity controls. The integrated tests also cover the payment-consent form. |

The combined checkout first integrated #103, #102 and #104 over #101, followed by #106 and #105. The merge points were the Schedule actions, invoice selection filters, TypeScript project inputs, and shared browser tests. The original six drafts remain independently reviewable.

The household credit drafts remain a separate release dependency. Compatibility can be checked in a disposable database containing those migrations. The portal shows paid or covered state using the existing lesson and invoice status. It has no new access to the raw household ledger.

## Financial boundaries

- Booking confirmation and permission to charge are separate. The booking step saves the dates and, when the studio enables it, prepares the exact invoice. The payment step records explicit consent and saves the payment method through Stripe Checkout.
- A payment authorization starts only after a signed test-mode Stripe event verifies the Checkout Session, SetupIntent, customer and payment method. The app stores scoped identifiers and a display label. Changes to scope, lead time or pricing terms use a fresh approval.
- The worker requires a prior eligible plan, a current payer and studio policy, and the existing full-balance invoice reservation. It binds one Stripe PaymentIntent to each reserved attempt. A failed attempt releases the invoice for deliberate payment and pauses the arrangement.
- A booking addition or move inside the lead-time window leaves that lesson available for Pay now. Dates use the studio calendar. Ambiguous or missing local times require review.
- Both test checkout paths require recognized test-mode credentials and an explicit test flag. The supported contexts are a disposable loopback stack and the exact unpublished staging preview. The scheduled worker requires its own opt-in. The candidate has no live payment path.

## Before protected acceptance

Use the exact reviewed candidate SHA, the existing Netlify team-login perimeter, and the matching isolated staging database after migration review. Record the deployment ID and confirm it is unpublished before opening application sessions. Use synthetic coach, student, designated payer and restricted guardian accounts. Keep test-mode credentials and role session files outside Git. Keep outbound notifications and provider jobs disabled except for separately reviewed synthetic acceptance.
