# Stage C lesson coverage and renewals

This partial Stage C draft is stacked on [Stage B #95](https://github.com/coach-sudo/Studio-Portal/pull/95) at a2bb5a46806e3c311d8556317df5e4f22ecfe6b5. The Stage B verify and migrations jobs passed. Its isolated deployed-browser job stopped before producing a test report. Protected hosted acceptance remains open.

## Portal experience

Student Home shows the existing guarded coverage response in a compact Lesson Credits card. Credits & Lessons shows package-specific balances and the Stage B lesson coverage states. Upcoming lessons retain their scheduled status when a credit is missing. The view keeps credit counts separate from package prices and amounts due.

The guardian's Household Lesson Coverage section lists the student contexts authorized by the existing portal guard. Expand a student to see permitted package balances and upcoming coverage. The page performs no household arithmetic and adds no new ownership rules. Credit history uses plain-language entry labels.

A lesson needing credit links to contextual renewal. The new server check uses the selected student and lesson, existing coverage evaluator, exact service and duration, expiration, availability, and one-time billing configuration. The selected student must be an independent adult or the signed-in contact must be the active designated payer with finance access. Checkout rechecks the actor's authority, package eligibility, and quote. A return from Checkout shows processing until the coverage endpoint reports an actual reservation. The existing verified fulfillment path continues to issue credits and reevaluate allocation when studio settings allow it.

## Database and limitations

Migration 20261115160000_portal_lesson_renewals.sql adds an authenticated authorization and eligibility RPC. It updates no records. Roll back the application before removing the RPC through a reviewed forward migration.

Shared household pools, atomic member attribution, pool administration, transfers, bulk adjustments, adjustment visibility controls, and household-wide purchase and reminder history remain open. Existing finance access continues to govern package counts. This draft does not expand finance access for minors or schedule-only guardians. These roles do not receive the new credit view without the required permission. No Stage D notification automation is included.

Only authorized exact-head staging can verify a real test-mode checkout and protected role access. That needs an immutable separately approved deployment, matching staging migrations, synthetic student and guardian credentials, and a test Stripe configuration. No hosted fixtures, reminders, or provider changes were made.

## Local screenshot evidence

Synthetic student and guardian fixtures show the home summary, both lesson coverage states, billing-contact guidance, and eligible renewal options at three widths.

| Width   | Student home                                             | Credits & Lessons                                               | Guardian household                                             | Renewal options                                               |
| ------- | -------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| Desktop | [Home](credit-stage-c-evidence/desktop/student-home.png) | [Coverage](credit-stage-c-evidence/desktop/student-renewal.png) | [Household](credit-stage-c-evidence/desktop/guardian-home.png) | [Renew](credit-stage-c-evidence/desktop/guardian-renewal.png) |
| Tablet  | [Home](credit-stage-c-evidence/tablet/student-home.png)  | [Coverage](credit-stage-c-evidence/tablet/student-renewal.png)  | [Household](credit-stage-c-evidence/tablet/guardian-home.png)  | [Renew](credit-stage-c-evidence/tablet/guardian-renewal.png)  |
| Mobile  | [Home](credit-stage-c-evidence/mobile/student-home.png)  | [Coverage](credit-stage-c-evidence/mobile/student-renewal.png)  | [Household](credit-stage-c-evidence/mobile/guardian-home.png)  | [Renew](credit-stage-c-evidence/mobile/guardian-renewal.png)  |
