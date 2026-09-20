# Verification baseline — 2026-09-19

Commit: `9aae3dc`

| Check                       | Baseline                                                                    |
| --------------------------- | --------------------------------------------------------------------------- |
| Vitest                      | 38 files, 227 tests passed                                                  |
| TypeScript                  | Passed                                                                      |
| Production build            | Passed                                                                      |
| Production dependency audit | 0 vulnerabilities                                                           |
| Main JavaScript             | 418.49 KB / 124.05 KB gzip                                                  |
| Global stylesheet           | 133.48 KB / 23.79 KB gzip                                                   |
| Live studio snapshot        | 33 table reads, auth lookup, and up to four storage signing operations      |
| Automatic refresh           | Coach 10 seconds; student/guardian 15 seconds; forced mount/focus/reconnect |

The initial sandbox attempt could not spawn Vite's helper process; the same test and build commands passed when permitted to spawn the local build helper. No source changes were required for that environment-only failure.

## Current branch verification

Branch: `codex/pr1-release-safety`

| Check                                  | Result                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| Vitest                                 | Passed: 39 files, 229 tests                                                    |
| TypeScript                             | Passed                                                                         |
| ESLint                                 | Passed with no errors; existing migration warnings remain non-blocking         |
| Prettier                               | Passed                                                                         |
| Production build                       | Passed                                                                         |
| Dependency audit                       | Passed: 0 vulnerabilities                                                      |
| Tracked and untracked file secret scan | Passed: 224 files                                                              |
| Deployed Playwright smoke              | Infrastructure-blocked pending the dedicated staging site                      |
| Entry JavaScript                       | 418.49 KB / 124.05 KB gzip                                                     |
| Global stylesheet                      | 133.48 KB / 23.79 KB gzip                                                      |
| Bundle budget                          | Passed with warnings; below failure thresholds                                 |
| Supabase reset, lint, and pgTAP tests  | Infrastructure-blocked locally: container runtime requires administrator setup |
| GitHub authentication                  | Repaired and verified with `repo` and `workflow` scopes                        |
| GitHub ruleset                         | Pending until the new required checks are present on the remote branch         |
| Netlify/Supabase/Stripe staging setup  | Pending; production remains untouched                                          |

The audit discovered a newly disclosed path-traversal advisory affecting Vitest 4.1.9. The branch uses the fixed 4.1.11 patch; this is a security gate repair, not a Vitest major-version modernization.
