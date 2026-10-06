# Unified credits and invoices

This feature branch is based on approved PR #28 head `ef0b6910e07c3b8a5ab633376d47e9ec00c29273`. PR #28 is unchanged. No production deploy, database mutation, real email, or live payment has been performed.

## Result

- Student payment workspaces show Remaining, Reserved, and Available lesson credits. Coaches set a new remaining total with a required reason. Reservations are protected; adjustments append to the existing ledger.
- One lesson credit covers any service or duration, including one credit per student participation in a group. Scheduling reserves credits; completion does not debit them again. Earliest-expiring valid credits are used first.
- A single coach-managed automatic-use setting replaces package toggles. Enabling it previews upcoming lessons and requires confirmation. Disabling it preserves reservations. Existing mixed settings remain pending review.
- Coach cancellation offers Return credit (default) or Use credit. Student cancellations at/before the cutoff return lesson credits or actual paid dollars as account credit. Late cancellation retains payment/consumes the credit. Returned expired credits have 30 days; other returns preserve expiry. Group cancellations settle only the cancelling student's balance and notifications.
- Payments support branded virtual invoices and PDF downloads, drafts, issue, reviewed send, service/package quantities and prices, coverage dates, optional existing lesson links, custom introduction/notes/footer, partial cash/bank/online payments, and account/lesson credits. Fully paid package lines grant their snapshotted credits once. No lesson is automatically created by an invoice.
- Issued branding, recipient, line pricing, package quantity/expiry, and text are snapshots. Pending Stripe checkout locks overlapping financial actions and can be checked/recovered/cancelled. Provider settlement is amount/session checked and idempotent. Saving never sends email.
- Payments and campaign cards wrap long text while retaining padding. Mobile financial amounts stay readable.

## Verification

- Vitest: 491 tests across 82 files passed. Includes 20 tests executing the actual migration in PostgreSQL/PGlite: opening balance preservation, reserved floors, stale versions, earliest-expiry use, cancellation, group ownership, recurring series, safe legacy reconciliation, partial payments, package fulfillment, checkout exclusivity, invoice linking/voiding, and RLS/privileged-command denial.
- TypeScript and production build: passed.
- Bundle budgets passed unchanged: global CSS 22,989 → 23,085 gzip bytes (+96); 1,915 bytes below the 25,000-byte hard ceiling. The existing 22,000-byte warning remains active. Largest JS chunk 111,672 gzip bytes; invoice/PDF code is lazy-loaded.
- ESLint: zero errors; existing warning baseline remains.
- Prettier, secret scan, and `git diff --check`: passed.
- Targeted browser review: 20 route/journey scenarios at 1440, 768, 390, and 320 px. Payments, campaigns, student payments/contact record, long-address card text bounds, invoice editor/virtual document, zero axe violations, no page overflow, trapped keyboard focus, Escape/focus restoration, PDF download, and reload persistence passed.
- Production PDF renderer sample was rendered with Poppler and visually inspected: one page, intact font glyphs, branded header, coverage/quantities, totals, custom text and footer. Evidence: `test-results/credit-invoices/sample-invoice.pdf`, `pdf-final-1.png`, route/invoice screenshots, and `report.json` (generated locally; not committed).
- Added isolated deployed acceptance for draft privacy, issuance/partial payment, student PDF download, unrelated-student denial, direct write denial, accessibility and mobile layout. Fixture cleanup removes invoices, settlements, dynamically granted credit lots, and credit accounts belonging only to fixture students.
- GitHub Actions has passed the full Supabase reset, SQL lint, and pgTAP/RLS checks. Its generated-type comparison detected a view return-type/format mismatch; the committed types were replaced with the authoritative CI-generated file. The final exact-head comparison and isolated deployed browser execution remain required before rollout. Local Podman is unavailable; PGlite is additional coverage.

## Rollout requirements

1. Run the isolated migration/type/RLS and deployed-browser CI gates. Keep production closed until they pass.
2. Apply only the new additive `20261006204647_unified_credits_and_invoices.sql` migration during an approved release; do not rerun older production migrations.
3. Run service-only `credit_reconciliation()` and review flagged historical records before activation. Existing purchases/ledger/expiry remain unchanged. The explicit coach review action can append matching reservations only when an older credit-paid series exactly matches its lessons; ambiguous data is left unchanged for manual review.
4. Verify existing totals, pending invoices, provider webhook idempotency and authorized recipients in the release environment. No production seeding or real test payments/email.

## Remaining debt

Global CSS still exceeds the existing 22,000-byte warning, with the 25,000-byte hard budget unchanged. Repository ESLint warnings and low-severity DOMPurify audit advisory predate this work. Non-Latin glyphs unsupported by the supplied invoice font require a future font choice. Full production/provider release verification is intentionally outstanding.
