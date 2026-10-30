# Release train dependency and ownership inventory

Observed October 29, 2026. This inventory includes all authors, including Dependabot. Main and the locked ready production deploy remain `fb2fcb63f7ac6f06dc8ee9d954e519bdde5773cb`. PR #89 began this cycle at `6dbc9db98d27e205520fad839e3003c836e4b9bc`. No main merge, publication or hosted mutation was performed.

## Consolidation graph

- A: main → #70 + #72 + #76; reuse #70. No migrations or handler changes.
- B: Release A foundation plus main → #71 → #73 → #77 → #78 → #82, plus #75 and #81; reuse #82.
- C: Release A foundation plus main → #74 → #79 → #83 → #84 → **#86**, plus #80; combine with #69 → #87 → #88 → #89 and #85. #88 already carries a patch-equivalent cherry-pick of #81. Reuse #89.

#86 is required for historical canonical linking/creation and was omitted from the earlier short readiness list. It is not a duplicate of #84 decisions. #85 branches from worker diagnostics, not the Calendar family. Original stacked commits are preserved once through ancestry-aware local assembly. Existing source PRs stay open as provenance; integration candidates supersede their separate release sequencing, not their evidence.

The frozen A foundation is `ad8c81952ea9dabbbedcea6065d3618ade9a0e6c`, now in existing draft #70. B/C incorporate it before their final CI milestone so later releases preserve its theme and patched tooling. A does not depend on B/C. B/C are not certified compatible together by their separate results; their shared files need a reviewed union if both release together. The zoned-input module has identical blob `8675355f2a310d03b8e2fa151b55f659721e8263` in both original assemblies. The #81 in-flight session helper is preserved; surrounding booking/integration callers have legitimate track-specific changes.

## Cross-track contracts

The coordinator alone updates integration PR heads, central registers and shared release decisions. Each agent owns its named worktree, branch and `docs/release-train/track-{a,b,c}`. B owns booking/financial changes and any justified additive booking boundary migration; C owns provider/identity assembly. Shared #81 command transport, receipt hashes and session authority stay equivalent. Shared zoned-input source in #73/#80 must agree. Preserve all historical migration filenames and bytes; never apply the same migration twice. CI conflict resolution must retain the union of all applicable concurrency scripts, grants, schema lint and generated types. Separate worktree package caches are required.

## Additive migration ownership

| Migration                                                         | Track | Source PRs                   |
| ----------------------------------------------------------------- | ----- | ---------------------------- |
| `20261028043447_manual_booking_command.sql`                       | B     | #71, #73, #77, #78, #82      |
| `20261028045708_coach_historical_booking.sql`                     | B     | #73, #77, #78, #82           |
| `20261028114720_stripe_booking_invoice_receipts.sql`              | B     | #75                          |
| `20261028121606_audited_lesson_datetime_corrections.sql`          | B     | #77, #78, #82                |
| `20261028041034_worker_run_observations.sql`                      | C     | #69, #85, #87, #88, #89      |
| `20261028051408_provider_attendance_separation.sql`               | C     | #74, #79, #80, #83, #84, #86 |
| `20261028131000_calendar_discovery_previews.sql`                  | C     | #79, #80, #83, #84, #86      |
| `20261028173500_historical_calendar_source_protection.sql`        | C     | #83, #84, #86                |
| `20261028183000_historical_calendar_review_decisions.sql`         | C     | #84, #86                     |
| `20261028193000_historical_calendar_canonical_reconciliation.sql` | C     | #86                          |
| `20261028230000_student_identity_groups.sql`                      | C     | #87, #88, #89                |

The list reflects original heads, before any new B boundary repair. All remain unapplied to hosted projects. Release A requires none. B/C can coexist by additive version order, but a combined candidate still requires real catalog/upgrade/concurrency proof. Retain observations, receipts and historical records when reverting application behavior. Do not restore superseded financial writers or physical profile merging.

B discovered an additional legacy bypass: generic booking CRUD and broad authenticated table privileges can evade the new atomic command. B owns the handler rejection and additive `20261029052836_booking_command_write_boundary.sql`, with caller compatibility review and actual role/command PostgreSQL proof required before acceptance. No historical migration is rewritten. This raises the total pending candidate migrations to twelve if that repair is retained. No hosted change is authorized.

## All still-open proposals

| PR  | Base                                         | Initial head   | Disposition                                                                                  |
| --- | -------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| #89 | `codex/audit-student-identity-interface`     | `6dbc9db98d27` | retained remediation source; integration track below                                         |
| #88 | `codex/audit-student-identity-groups`        | `41a6ec66cae7` | retained remediation source; integration track below                                         |
| #87 | `codex/audit-worker-observability`           | `1005903cabdf` | retained remediation source; integration track below                                         |
| #86 | `codex/audit-historical-review-decisions`    | `d8e1927859bb` | retained remediation source; integration track below                                         |
| #85 | `codex/audit-worker-observability`           | `b51dd6830a81` | retained remediation source; integration track below                                         |
| #84 | `codex/audit-calendar-source-protection`     | `acef7bd3debd` | retained remediation source; integration track below                                         |
| #83 | `codex/audit-calendar-discovery-preview`     | `3779d0ceaae9` | retained remediation source; integration track below                                         |
| #82 | `codex/audit-correction-interface`           | `28a32d114f00` | retained remediation source; integration track below                                         |
| #81 | `main`                                       | `9dc30cde4a19` | retained remediation source; integration track below                                         |
| #80 | `codex/audit-calendar-discovery-preview`     | `69d6eaa87468` | retained remediation source; integration track below                                         |
| #79 | `codex/audit-provider-attendance`            | `9925be4c1953` | retained remediation source; integration track below                                         |
| #78 | `codex/audit-historical-corrections`         | `3d07af6547fd` | retained remediation source; integration track below                                         |
| #77 | `codex/audit-coach-historical-datetime`      | `7c181d2f24f2` | retained remediation source; integration track below                                         |
| #76 | `main`                                       | `da2605b9efcd` | retained remediation source; integration track below                                         |
| #75 | `main`                                       | `e4ffa489ef54` | retained remediation source; integration track below                                         |
| #74 | `main`                                       | `9ba9d3d0fad2` | retained remediation source; integration track below                                         |
| #73 | `codex/audit-manual-booking-transaction`     | `56c9fa9871e5` | retained remediation source; integration track below                                         |
| #72 | `main`                                       | `49d1c755edec` | retained remediation source; integration track below                                         |
| #71 | `main`                                       | `de39cd9f6948` | retained remediation source; integration track below                                         |
| #70 | `main`                                       | `ce11181bfa1e` | retained remediation source; integration track below                                         |
| #69 | `main`                                       | `d06539dbba3b` | retained remediation source; integration track below                                         |
| #68 | `main`                                       | `3309e8e2c070` | overlapping dependency proposal; not included without compatibility review                   |
| #59 | `main`                                       | `de9cbdaef3bb` | overlapping dependency proposal; not included without compatibility review                   |
| #57 | `codex/wave-one-finalization`                | `98eb7a8d55b5` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #56 | `codex/wave-one-final-ui-deployment`         | `e0567286feeb` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #55 | `codex/wave-one-final-ui-candidate`          | `06e51be1eaad` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #54 | `codex/wave-one-hosted-browser-acceptance`   | `49a945147291` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #53 | `codex/wave-one-candidate-auth`              | `825d5f2db33a` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #52 | `codex/wave-one-candidate-deployment`        | `fdb84120602a` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #51 | `codex/wave-one-staging-release-candidate`   | `91c47042f1c5` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #50 | `codex/wave-one-hosted-execution-checkpoint` | `1842f4f51a1c` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #49 | `codex/wave-one-hosted-mutation-executor`    | `025fe0fd6efd` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #48 | `codex/wave-one-hosted-acceptance`           | `9b10d19c1fb4` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #47 | `codex/wave-one-first-deployment-gate`       | `3057d6cbdde6` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #46 | `codex/wave-one-staging-configuration`       | `451e409e1726` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #45 | `codex/wave-one-staging-proposal`            | `04768d281b0e` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #44 | `codex/wave-one-integrated-acceptance`       | `5be0de2a8a2d` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #43 | `codex/student-workspace-experience`         | `fe63c57e928b` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #42 | `codex/bulk-lesson-interface`                | `2470adf349cb` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #40 | `codex/bulk-lesson-management`               | `c162fc292d4b` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #39 | `codex/occurrence-safe-lesson-changes`       | `8b8a0aa173bf` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #38 | `codex/credit-lifecycle-reliability`         | `c894f7f51f26` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #37 | `codex/credit-coverage-diagnostics`          | `0badcc648ec7` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #36 | `main`                                       | `f99f8cc0b7ae` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #23 | `main`                                       | `2059d165498b` | overlapping dependency proposal; not included without compatibility review                   |
| #18 | `codex/pr7-performance-styles`               | `ce310228611c` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #17 | `codex/pr6-product-polish`                   | `e747fb71675e` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #16 | `codex/pr5-server-contracts`                 | `c5a49ce95af5` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #15 | `codex/pr4-client-decomposition`             | `e480516333c4` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #14 | `codex/pr3-deployed-e2e`                     | `357b9ba03884` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #13 | `codex/pr2-query-layer`                      | `1a6a44d00970` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #12 | `codex/pr1-release-safety`                   | `14108449ecf3` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #11 | `main`                                       | `aa0f86ea2376` | older divergent/squashed family; do not replay wholesale; no blanket patch-equivalence claim |
| #4  | `main`                                       | `8380c48a580b` | overlapping dependency proposal; not included without compatibility review                   |
| #3  | `main`                                       | `fbcbc3df4a7e` | overlapping dependency proposal; not included without compatibility review                   |

Older open Wave1/2 and PR1–8 branches diverge from the later main release history. Main includes the released Waves1/2 aggregate at `231bbc6`, then subsequent Waves3–6 through the audited baseline. They are neither prerequisites to reapply nor declared byte-equivalent merely from titles. The machine inventory records exact ancestry/divergence and changed migration paths. No old draft is closed, replayed or assumed safe. Dependabot #59 overlaps A tooling; #68 and Actions #3/#4/#23 remain separate proposals.

## Release gate classification

A direct blocker affects changed behavior or required acceptance. B shared blocker affects a dependency actually used. C independent issues are absent from the candidate and do not waive any mandatory global check. D operational actions require separate owner authorization. Stripe sandbox absence is direct for #75 settlement and independent for A because no settlement handler/schema enters A. Google controlled-provider acceptance and disabled intake are direct/operational for C, independent for A. No isolated pass establishes external delivery or whole-portal certification.
