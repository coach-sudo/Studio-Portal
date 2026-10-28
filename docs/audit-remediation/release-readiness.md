# Release readiness — active remediation

The portal is **not certified**. This document is updated per validated draft PR. No merge, hosted migration, deployment, provider invocation or financial repair has occurred.

| Work                              | Local evidence                                                                                                           | Release requirement                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SP-01/14 operational observations | 17 targeted unit tests and two PGlite database cases passed during implementation; expanded UI/regression checks running | Full-schema migration/type parity and PostgreSQL concurrency CI; authenticated Settings acceptance; controlled Calendar/Gmail failures/recovery and three real completed scheduled runs |
| SP-15 public contrast             | Pending                                                                                                                  | Computed branding colors and interaction/screenshots in 320/390/768/1440 Chromium and WebKit                                                                                            |
| Other SP findings                 | Causes and original evidence preserved in register                                                                       | Focused implementation and relevant downstream gates; no resolution inferred                                                                                                            |

Production intake remains `WORKER_PROVIDER_INTAKE_ENABLED=false`. Re-enablement requires controlled provider verification and separate approval. Compromised-password protection remains a proposal until production Auth approval. Existing production balances, lesson outcomes, history and migrations are untouched.

Pending migration: `20261028041034_worker_run_observations.sql` (private operational observations only). It may be retained if the application is reverted. No hosted migration is authorized by a draft PR.

Required identities and infrastructure: approved synthetic staging coach/student/guardian/unrelated-user sessions; controlled Calendar/Gmail and Stripe test fixtures; separate authorization to publish an immutable staging candidate; read-only backup configuration and an approved isolated restore drill. Local mock/component/PGlite evidence cannot satisfy these gates.

Actual environment failures are retained: unfiltered Windows Vitest discovered ignored diagnostic specs and ran out of memory; a later broad Windows run also exhausted native/WASM code memory. Focused single-worker tests run successfully. WSL/Docker was detected, but isolated setup failed with `Wsl/Service/E_UNEXPECTED` and `ERROR_NETNAME_DELETED`; no existing database was reset. Full PostgreSQL execution is delegated to the repository's isolated migration CI, with results to be recorded rather than assumed.
