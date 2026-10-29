# Release B: scheduling and financial integrity

Preimplementation scope, 2026-10-29: preserve #82 ancestry (#71 → #73 → #77 → #78 → #82), merge #75 installment settlement and #81 complete-request/session isolation once. The branch owns no shared release register. Coach-visible changes are atomic booking, explicit historical recording, accurate timezone inputs, audited corrections and truthful overlap/recovery.

Affected inventory: B03/B04/B06/B07/B08/B09/B10, C05/C06, D01/D03/D05/D06, E05/F05; X01/X02/X04/X05/X06/X08/X09/X13/X14/X19/X20. The complete original 19/42/20 register remains coordinator-owned. No workflow is promoted to end-to-end PASS here.

Assembly: fast-forward to #82 28a32d114f00dd605c1b1c1e9f580e73e6fc50b2, merge #75 e4ffa489ef54454b44b219926fe49b0874b00cac (108e55c), merge #81 9dc30cde4a1920f88cdda11175226cea3071eaad (8e4f995). Only CI concurrency-list conflict required resolution; all three booking/correction/Stripe scripts retained. Existing migration filenames and contents are preserved.

## Newly verified boundary gap before implementation

The generic booking-admin create/update/delete fallback still targets bookings and skips the atomic create_manual command. Read-only production catalog inspection confirmed authenticated/anon INSERT/UPDATE/DELETE/TRUNCATE grants and authenticated bookings_coach_write ALL policy, alongside separate bookings_access SELECT policy. No production write was attempted.

Supported call sites were inspected: BookingCenter uses create_manual/confirm_location/cancel/refund; repository, booking-portal access and booking-admin access use userClient reads. Their writes use serviceClient or existing SECURITY DEFINER commands, including cancellation, confirmation, manual booking and audited correction. Public checkout, webhook and local fixture writes use service clients. No supported source caller uses direct authenticated bookings CRUD.

Minimum fix: reject generic booking CRUD before the fallback, revoke direct I/U/D/TRUNCATE from PUBLIC/anon/authenticated, remove the obsolete coach write policy while retaining the separate SELECT policy and all service/command authority. New CLI-generated additive migration: 20261029052836_booking_command_write_boundary.sql. Existing unrelated tables and service grants are untouched. Required actual PostgreSQL assertions cover denied direct writes, retained role reads and canonical paid creation; catalog shape does not change.

Rollback keeps committed bookings, ledger, receipts, holds and pending intents. Application rollback may retain these reviewed commands; reverting before atomic creation would make manual creation unavailable under the new boundary, so do not restore old fragmented CRUD or regrant writes as a quick rollback. Hosted migration and release remain unauthorized.
