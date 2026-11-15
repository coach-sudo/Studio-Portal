# Stage B protected staging acceptance manifest

Status is **pending separate authorization**. This manifest describes the candidate and evidence required. It is not an executable credential file. Pin the exact 40-character head recorded in draft PR #95 when requesting acceptance. Capture that SHA and require the staging health response to match it before collecting evidence. The PR body records the exact candidate SHA for this manifest.

## Deployment and schema

- Use only the approved SSO-protected staging Netlify project and its isolated Supabase project. The runtime manifest must use context deploy-preview and the exact immutable deployment origin described by the repository's candidate-target validator.
- Before testing, verify migration history through 20261115150000_credit_reconciliation_stabilization and the earlier purchase-time terms migration. Check that the service-role preflight is private and the case table is inaccessible to portal roles.
- Prepare synthetic coach, adult student, billing guardian, schedule-only guardian, and unrelated student sessions. Bind exact-host perimeter cookies and role sessions outside the repository. The existing protected runner requires separately authorized read-only mode. Case decisions, synthetic fulfillment, and booking commits require a separately approved write itinerary.

## Acceptance scenarios

| Scenario                             | Expected outcome                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coach package and case review        | Owned lot shows its evidence, service/duration, balances, decision history, and exact linked correction.                                                                              |
| Authorized student and guardian      | Coverage labels and permitted package totals are present. Case evidence, private reasons, and unrelated accounts are denied. A finance-only guardian receives no lesson logistics.    |
| Legacy package                       | Existing supported reservation remains. Unverified historical eligibility is surfaced for review and the portal does not demand money.                                                |
| Typed package and competing bookings | Exact match previews as eligible. Wrong service, duration, or expiry does not qualify. A competing reservation invalidates the earlier advisory result without a second debit.        |
| Confirmed purchase and replay        | Verified processing issues once and a reserved lesson becomes covered. Checkout success alone remains unconfirmed. An exact duplicate reference is handled once.                      |
| Cases                                | Dismiss with a reason, repeat review with unchanged evidence, add material synthetic evidence to reopen, then resolve with a linked correction. Competing stale changes are rejected. |
| Separate payment                     | Pay-as-you-go and other independent payment arrangements are identified separately. No credit shortage is represented as a dollar amount.                                             |

Collect redacted HTTP results, migration and health metadata, row counts before and after each approved write, audit IDs, and screenshots at desktop, tablet, and mobile widths. Record denied scenarios and skips. Remove test-owned fixtures and sessions using the separately approved cleanup itinerary and verify that provider intake, live messages, and reminder jobs remained disabled. Keep raw private evidence off the PR.

## Stage boundaries

Stage B publishes the status contract for Lesson Coverage & Renewals and the booking admissibility check. Stage C owns student and guardian lesson cards, household views, renewal recommendations, verified checkout handoff, and post-purchase presentation. Stage D owns authorized notifications, templates, three-day follow-ups, and delivery logs. These later stages must consume authoritative coverage and preserve the distinction between entitlement and currency.

Blocked here by the absence of separately approved deployment, exact-host credentials, and authorization for the synthetic write scenarios. No protected runner or security controls have been changed.
