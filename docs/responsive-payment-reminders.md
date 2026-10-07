# Responsive workflows and coach-approved payment reminders

October 5, 2026. Follow-up to PR #28 head `a48dc016a5f4164436e5e2f917a1eb51169d33e8`.

The coach reported clipped controls/card copy and unreachable sidebar links,
and requested actionable payment next steps and improved automation/email logic.
They explicitly selected **coach approval, with visible scheduled/sent status**.

## Behavior

- Coach and portal sidebars scroll on short screens. Settings categories wrap;
  the 768px shell breakpoint is consistent, card/header actions wrap, and action
  labels remain visible. Drawer action groups scroll with their content instead
  of overlapping one another. Mobile controls have scroll clearance above the
  fixed navigation.
- Shared Section cards have side padding at every nesting depth. Campaign
  recipients stack name/email instead of squeezing both into a narrow row.
  Student contact/overview cards have consistent separation. Automation and
  communication cards retain their system padding after lazy stylesheet loads.
  Package/material rows wrap links, statuses and actions while reserving space
  for the name. The spacing sweep waits for lazy record content to finish loading
  and also measures long email addresses without changing any studio records.
- Student Payments loads booking and reminder context. Next steps show the next
  five upcoming lessons, real financial coverage, pending approval, scheduled
  date, sent, failed and cancelled states. Paid PAYG, package-covered, waived,
  processing and unknown balances do not receive a payment-demand action.
- Eligible unpaid lessons offer a non-sending rule preview showing current
  recipients and proposed dates. Preparing reminders creates reviewable drafts.
  Each exact message has a separate scheduled-approval action. Existing financial
  rules must be enabled; this work does not silently turn rules on.
- Payer `payment_due` and `payment_past_due` messages require coach approval even
  when their rule uses automatic evaluation. Coach escalation retains its existing
  mode. Legacy unapproved queued payer reminders can be approved in place, and
  the worker returns any claimed unapproved payer reminder to draft without
  acquiring Gmail credentials.
- Approval preserves a future `send_at`; an elapsed proposed time becomes the
  approval time. Existing send-now/retry actions remain explicit coach actions.
  Approval checks scope, current eligibility and version, then performs a guarded
  update; a race reports a conflict instead of claiming success.
- Pre-lesson reminders stop at lesson start. Recorded amount changes invalidate
  old quoted balances. Balance-specific dedupe allows a fresh reviewable draft
  after a partial payment while preserving history and rejecting repeats for an
  unchanged balance. Cancellation, package/payment resolution, recipient access,
  preference and master-switch checks remain in force at delivery.
- Emails have a responsive, email-client-friendly table layout, clear primary
  button, readable paragraphs, bottom branding, escaped content, safe asset/CTA
  URLs and a plain-text alternative. Authored instructions around an inline CTA
  URL are retained. Lesson templates receive recipient, time, timezone, location,
  stage hours and recorded amount variables. No early Meet link is introduced.

No schema/migration, RLS, calendar synchronization, financial ledger, refund or
booking-policy change is included. Tests use isolated recipients and do not send
customer email. Production is not published and PR #28 is not merged.

## Verification

- Vitest: 81 files / 470 tests passed locally, including workflow separation,
  financial truth, recipient/permission suppression, approval/version/race handling,
  scheduling retention, stale balances, dedupe and email content preservation.
- TypeScript, ESLint (0 errors; existing 618 warnings), Prettier, production build,
  secret scan and bundle budgets passed locally.
- Main CSS: **22,739 → 22,989 gzip bytes**, retaining **2,011 bytes** below the
  unchanged 25,000-byte hard budget. The unchanged 22,000-byte warning remains.
  Relative to the original reviewed redesign: **24,967 → 22,989**, a 1,978-byte
  reduction. Entry JavaScript is approximately 94.8 KB gzip.
- `scripts/review-responsive-workflows.mjs`: 58 checks passed. All seven Settings
  panels at 320, 390, 700, 768, 900, 1024 and 1440px (600px height), short-sidebar
  keyboard/scroll access, hit-tested controls, visible action text, no horizontal
  overflow; serious/critical axe checks at every width and both email widths.
- Existing 90-state local desktop/mobile route, drawer, keyboard and axe review
  passed. Evidence: `test-results/redesign/` and `test-results/responsive/`.
- `scripts/review-page-spacing.mjs`: **455 scenarios passed**, with no card-edge
  text violations or horizontal overflow. It covers every route in the design inventory,
  all record and Bookings tabs, minor-student/household views, all seven Settings
  panels and long-address stress cases at 320, 390, 700, 768, 900, 1024 and 1440px.
  It measures text line boxes against card content edges, requires Section side
  insets and checks document overflow; deliberate ellipsis and horizontal scroll
  controls retain their behavior. Screenshots and the result manifest are saved
  under `test-results/page-spacing/`. This sweep caught and corrected the package
  and material action overflow at 1024px that document-overflow checks missed.
- The deployed operational journey now covers the payment-preview drawer on
  desktop/mobile, keyboard trapping/Escape/focus return, preparing drafts and
  approving a scheduled reminder in Payments. Its fixtures restore rule snapshots
  and preserve the existing public/storage/auth cleanup checks.
  Cleanup includes approval audits for generated message IDs discovered only
  within the namespaced test students.

Deployed browser and migration/RLS results are recorded on PR #28 after CI.
Remaining visual debt: live provider/permission/error states continue using
compatibility styling; real mail-client delivery has not been tested by sending
an email. The browser suite's separate Stripe checkout still requires a test key.
