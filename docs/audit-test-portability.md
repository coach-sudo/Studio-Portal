# SP-19: timezone-independent booking fixtures

Independent branch from current/audited main. Affects B01 and F07; no production behavior, schema or provider change. The two availability fixtures mixed offset-free local Dates with New York rules and local-hour assertions. They now pin UTC instants corresponding to an explicit New York calendar date and assert UTC slot identities. The buffer case first verifies that the unblocked window has slots, preventing an empty-window false pass. All seven existing booking-rule cases are retained.

The `verify` CI gate also runs these seven tests under New York, UTC, Los Angeles, Tokyo and Honolulu host timezones. Vitest excludes ignored temporary diagnostics/build/test outputs, so an old Playwright `.tmp/*.spec.ts` cannot enter the application suite. No test failure budget or application assertion is removed.

Rollback is application-independent: revert this test/config PR. Production timezone controls and DST input behavior remain SP-03 work; passing these fixtures does not resolve that application defect or certify provider behavior.

Windows execution: `node scripts/test-booking-timezones.mjs` passed **35/35** checks (seven original cases × five host timezones) on Node 24.14.1. Full New York and CI gates are tracked separately.
