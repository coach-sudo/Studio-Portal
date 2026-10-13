# Invoice delivery and credit usability

Creating an issued invoice now addresses it to the student's designated primary payer and automatically queues an email with an immediate delivery attempt. Drafts remain unsent. The invoice, PDF, and email greeting use the payer's name; the student's name and payment record remain associated with the services. Adult students without a designated household payer bill themselves. Missing, ambiguous, disabled, or opted-out payers block issuance with an explanation while allowing a draft.

Invoice emails and exported PDFs have a Pay invoice link to the specific invoice in the secure portal. The invoice view has a Pay invoice button that uses the existing server-validated checkout flow. Login redirects preserve the invoice ID. The payer sees the current balance before checkout; PDFs contain a durable invoice link rather than an expiring checkout URL.

The invoice list and detail view display email delivery status. Queued messages are refreshed until delivery succeeds or fails. The existing outbox dispatcher rechecks permissions and invoice approval before sending and retries delivery failures. Repeating a save reuses its operation key and does not create a duplicate invoice or issue email. A queue failure reports that the invoice was saved and offers a reviewed retry. Explicitly sending an older invoice refreshes its addressee to the current permitted payer using an invoice version check.

Credit adjustments offer Add credits, Remove available credits, Set available balance, and Set remaining total. Every adjustment previews the resulting balance and preserves credits reserved for existing lessons. Available, reserved, and total remaining are shown separately. The existing version-protected ledger procedures and adjustment reasons remain authoritative.

Automatic use now scans enabled student accounts across all upcoming lessons, rather than the first 100 unassigned lessons within 45 days. Accounts without available credits or requiring legacy reconciliation are preserved. Expiration dates, existing cash coverage, payment processing, and chronological allocation remain enforced by the database reservation procedure. The coach can also apply available credits immediately from the student's payment workspace without changing an off setting.

## Evidence and release checks

Read-only production inspection found an open invoice but no invoice-issued outbox messages. Other mail types were being delivered. It also showed credit totals that included existing reservations: a remaining total is not an unallocated balance. No production credit balances, invoices, or email queues were modified during development.

Local tests cover payer routing, drafts, blocked recipients, background dispatch, save deduplication, queue failures, delivery status isolation, credit adjustments, account pagination, manual application permissions, invoice login redirects, and PDF link annotations. The existing PostgreSQL credit/invoice tests also pass. The PDF was rendered and visually reviewed, and the credit dialog and payer invoice were checked in the local demo browser.

After publishing through the protected main workflow, issue an approved invoice for a configured payer, confirm actual inbox delivery and the Pay invoice button, then test an enabled student with valid available credits and future unpaid lessons. Verify cash-covered lessons are preserved. The separate invalid Supabase Google OAuth secret still needs the repair described in [login recovery](login-recovery-2026-10-13.md).
