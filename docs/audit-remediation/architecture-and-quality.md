# Architecture and code-quality changes

## Worker observations (SP-01/14)

The existing signed dispatch, service-only enqueue/claim/finish RPCs, 20-minute lease and fencing remain. An additive private RLS table captures queued, claimed and terminal transitions plus allowlisted source-stage observations. Observation RPCs validate the current token before writing stage outcomes. Existing saved terminal receipts are copied with their original timestamps; overwritten history cannot be reconstructed. No provider bodies, tokens, student identities or raw errors are recorded.

The coach-authenticated health endpoint now reads those fixed-shape receipts rather than inferring worker health from the studio query. Disabled configuration wins over an earlier success; queued dispatch, accepted dispatch, running, completed, failed and partial work have distinct meanings. A successful source stage cannot hide a failed second stage. The Settings action follows receipt outcomes instead of declaring processing successful after a 15-second timeout. The polling interval controls read frequency only.

The adapter used by older service commands is retained intentionally. No migration history, financial trigger, role permission, publication control or compatibility route was removed. Provider processing remains idempotent/retryable under its existing command protections; this PR does not claim live provider success or fix the historical Gmail incident.

## Remaining investigations

Manual scheduling still needs a single authoritative transaction/receipt/outbox command. The exclusion constraint remains authoritative for private overlaps until a reviewed structural policy exists. Provider review attendance inference, bounded multi-calendar/historical preview, Stripe installment settlement, unknown email outcomes, explicit zoned controls, query history pagination and Auth enablement remain tracked work. No financial or attendance history is automatically corrected.

History is stored append-only and read through a bounded recent-attempt summary with an indexed last-success aggregate. It currently grows with scheduled attempts; retention/archive policy requires operational review. No arbitrary cap is applied to canonical lesson or financial histories. No measured application performance improvement is claimed by this change.
