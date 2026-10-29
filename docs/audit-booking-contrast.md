# SP-15: branded public booking contrast

Independent branch from audited/current main `fb2fcb63f7ac6f06dc8ee9d954e519bdde5773cb`; no dependency on worker PR #69. Affects B01, F04/F06 and X13. Revert application/CSS changes independently; no schema, financial, scheduling or external-provider change.

Cause: booking.css put the summary on the configured `--forest` background, then explicitly gave its text `--ink`/`--muted`. public.css also owned a conflicting background for the same summary. The CSS load order could change the background without changing the foreground. The original production screenshot measured 1.35:1 and 1.89:1.

The summary now owns its branded background and uses a paired opaque foreground derived from the configured primary hex color. Public shared-card styling no longer changes that background. Buttons use the secondary color's paired foreground; progress and focus indicators receive readable foreground/focus pairs. Summary heading scale is bounded for wrapping without changing the booking task structure.

Production-equivalent public color values, read without mutation: primary #37129b, secondary #a7d3eb, accent #cf1b96, canvas #c2daff. The browser matrix uses only synthetic local/demo records and blocks non-loopback network requests. It is visual/interaction evidence, not proof of real booking, payment, Calendar or email completion. Required checks: catalog, setup, time selection, customer details, errors, disabled controls and demo confirmation at 320/390/768/1440 in Chromium and WebKit; measured computed text contrast, overflow, focus, keyboard and accessible labels. Live authenticated/provider gates remain outside this focused fix.

## Executed evidence

`node node_modules/@playwright/test/cli.js test --config e2e/audit-contrast-local/playwright.config.ts`: **8/8 passed**, 47.3 seconds on Windows. Each combination checked catalog, setup, no-slot-selected, customer details, disabled payment, simulated 503/retry and confirmation. All checked WCAG A/AA axe rules passed, no horizontal overflow was observed, controls were operated by keyboard and form labels were exercised. Native required-field validation and input preservation after a recoverable failure passed. This is automated accessibility evidence, not a manual screen-reader session or a full touch task test.

Computed sidebar contrast is **12.19:1 minimum**, using white on #37129b, above both normal and large-text targets. Before screenshots are unaltered embedded production evidence from the original audit at 1363 × 936. After screenshots are local synthetic 30-minute-service UI at the requested widths. Their different source/viewports are explicit; they are not portrayed as production after a deployment. See [evidence](audit-contrast/evidence/) and [all computed pairs](audit-contrast/evidence/computed-contrast.json).

The original five mocked audit reproductions still pass against the unchanged baseline booking handler. They were run transiently with the original transcript's shell wrapping normalized; no defect-asserting test was added to the shipped suite. Branding unit checks passed. Production data/configuration, payments, email and Calendar remain untouched.

The first full browser CI picked up this dedicated loopback harness with the unrelated deployed-suite configuration, whose port differs; those four cases failed before navigation. The harness is now excluded from that runner and explicitly executed in its own Chromium/WebKit configuration in the same CI job. Existing authenticated journeys and required smoke checks are retained. Initial production checks passed; corrected-head browser CI remains required.
