# Wave 1 final UI candidate and hosted test preparation

October 18, 2026, Eastern. **Local implementation checkpoint; no deployment or hosted business mutation performed. Production remains NO-GO.**

This work is directly based on draft [PR #53](https://github.com/coach-sudo/Studio-Portal/pull/53), branch `codex/wave-one-hosted-browser-acceptance`, reviewed head `825d5f2db33a3a3d2749e4fa45e54873faeee838`. Fresh GitHub verification confirmed it remains an open draft at that head. PR #52 remains its base. Preserve the complete Wave 1 chain and the [master plan](studio-portal-modernization-master-plan.md); Wave 2 has not started.

Read alongside the [machine evidence](wave-one-final-ui-evidence.json), [executor review](wave-one-ui-mutation-executor.md), [normalized executor manifest](wave-one-ui-mutation-executor-plan.json), [historical hosted browser findings](wave-one-candidate-browser-acceptance.md), [release procedure](wave-one-staging-release-candidate.md), [deployment checkpoint](wave-one-candidate-deployment.md), [Auth checkpoint](wave-one-candidate-auth.md), and [completed backend execution](wave-one-hosted-execution-checkpoint.md). Historical reports retain their original outcomes.

## Application pin and changes

**New application candidate: `f5324b203387a158df3c050569b95a9044368bc0`.** Later executor/report commits are intentionally different. The application, migration, dependency and function source still exactly matches this pin; no new financial, integration or schema code was added.

| Finding                 | Candidate behavior                                                                                     | Local evidence                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| B01, inherited from #53 | Distinct `Studio sidebar` and `Student context` complementary landmark names in live and demo Overview | Both query modes, Chromium and WebKit; no duplicate-landmark findings in the retained audits                                                |
| B02, inherited from #53 | Guardian banner reserves 72 px for the bell; identity and relationship text wrap                       | Short/long names on Home, Work and Payments at Chromium 320/390/768/1440 and WebKit 320/1440; geometry, text-overflow and screenshot checks |
| B03, added here         | Portal account-summary values and explanatory text wrap rather than ellipsize                          | Scoped seven-line CSS override in `src/styles/product.css`; student and guardian Home checks and separate Payments labels                   |

The other application-source difference from the deployed `830c762bdaf085f5e20a91f4e6a7afbef4afa627` is #53's narrow, read-only missing-lesson delivery classifier and its regression tests. It is acceptance tooling, not permission to send anything. No backend, ledger, payment, function, package-lock or migration changes separate the two application pins.

App commits are `6d92a159753628e67e7d2d3043d74a635e00c201` and the final fixture correction `f5324b203387a158df3c050569b95a9044368bc0`. The latter ensures long-name tests change `preferred_name` as well as `full_name`; the initial six fixture failures remain private diagnostic evidence.

## Local validation

| Check                                 | Result / environment                                                                                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete unit/integration suite       | 818/818 tests, 117 files; no application change after this run                                                                                                        |
| Final candidate browser suite, V2     | 102/102; 17 cases across six browser/viewport projects; zero retries/skips/flakes                                                                                     |
| Final candidate browser suite, legacy | 102/102; same matrix and zero retries/skips/flakes                                                                                                                    |
| Origin regressions                    | 14/14 focused `portal-email.test.ts` tests; trusted preview origins and production-context staging rejection                                                          |
| Auth/perimeter/proposal helpers       | 8/8 offline Node tests                                                                                                                                                |
| Types, lint, formatting and secrets   | Detailed final counts and hashes in machine evidence; existing lint warnings are retained                                                                             |
| Linux V2 and legacy builds            | Clean pinned checkouts; lockfile installation, Linux x64, Node 22.22.0                                                                                                |
| Bundle failure budgets                | Both modes pass: largest JS 111,672 gzip bytes / 130,000 cap; CSS 23,156 / 25,000 cap. The 22,000-byte CSS warning remains                                            |
| Functions                             | All 23; Node 22 runtime, Linux Sharp/libvips, invoice font, local rendering and import/GET 405 with network disabled                                                  |
| Official CLI                          | Netlify CLI 27.8.0 `build --offline --context deploy-preview`; no upload; client bytes match the independent package                                                  |
| PostgreSQL                            | Full unchanged 57-migration replay, 204 pgTAP assertions, three original concurrency suites with separate sessions and observed lock contention                       |
| Dedicated executor                    | Separate disposable database scenarios, actual V2 HTTP handler/SQL/RLS, actual built-app browser actions, cleanup and independent 76-table proof; see executor report |

The browser matrix uses the actual application with loopback network fixtures. The separate database/browser lane uses the built V2 candidate, actual command wrappers, actual PostgreSQL RLS/RPCs and a local Auth/PostgREST compatibility adapter. **Neither lane is hosted Supabase Auth or hosted acceptance.** Public/invoice/delivery compatibility reads in that local adapter are explicitly identified stubs; database assertions independently establish the empty invoice and undelivered state. No provider-capable rescheduling wrapper was called.

Audits include all three permitted roles. Final loopback axe attachments contain no violations; serious/critical and duplicate-landmark assertions remain enabled. Long guardian screenshots were inspected at narrow Chromium, tablet Chromium and narrow/desktop WebKit, alongside the populated local UI screenshots. No household information was hidden to obtain a pass. Full-page screenshots alone do not prove every off-screen control remains unobscured at every scroll position.

The old hosted report still contains **139 distinct checks: 132 passed, three guardian geometry failures and four fixture blockers**, plus its duplicate-landmark and truncation findings. Its **54 platform-owned `region` occurrences** remain recorded. The preview toolbar is not removed or excluded: the new network fence permits its exact same-host `/.netlify/scripts/hud` read, and hosted axe results will retain platform findings. Local passes do not clear these hosted findings.

## Four fixture blockers

| Exact #53 blocked check                                     | Prepared and locally verified                                                                         | Remaining hosted requirement                                                                                                                                                  |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixture boundary: coach exact existing lesson`             | Owned seeded lesson plus the one generated lesson; exact coach hub, create and topic edit             | Deploy candidate, approve exact-host Auth, then separately authorize the new UI run                                                                                           |
| `fixture boundary: student exact existing lesson`           | Exact seeded student lesson hub under the new student's identity                                      | Same; no modification to original manual accounts                                                                                                                             |
| `fixture boundary: guardian exact existing lesson`          | Exact authorized guardian lesson, finance controls and post-revocation denial                         | Same; revocation uses only the new contact                                                                                                                                    |
| `fixture boundary: nonzero financial and populated history` | Four lesson credits, four reservations, append-only ledger and bulk/audit history, all with zero cash | Lesson-credit/ledger subset prepared. Nonzero invoices, cash/payment history, authored notes/material history and provider scenarios remain outside this proposal and blocked |

Fresh revocation redirects to the existing root access-claim workflow. That claim is still prohibited: the driver blocks exactly one expected guardian claim attempt before transmission, counts it against the HTTP budget, verifies absence of student content and verifies authoritative fresh server denial. It does **not** claim the root claim-access workflow succeeds. Account-access claims need separate review; the allowlist was not broadened to make this case pass.

## Staging preservation

Read-only revalidation confirmed the existing deployment `6ad39275e099502cb54a8f64` remains ready, protected, unpublished and `deploy-preview`, with the same deployment list and publication `6ace53e7f850061d7c49b711`. Automatic builds remain stopped. The supported Netlify project read reports team login for **all** deployments. Shared team variables are empty; ten site variables remain preview-only, providers absent, and service credentials function-only.

Verified direct PostgreSQL TLS, all 57 migrations, all 76 business-table fingerprints / **215 rows**, and all four original manual accounts and roles remain unchanged. Existing H01–H16 artifacts are part of the preserved baseline. Anonymous root and health requests still return 401. The original Auth URL and exact callback pair remain unchanged. No current application session was established during this phase.

Targets remain staging Netlify `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`, Supabase `lrxrivfqjpkvygozphoz`, studio `4ceff683-e72f-4b2e-96ce-85db2dca4eb2`. Production services were excluded.

## One-deployment preparation

**Recommendation: GO for one separately authorized protected, unpublished V2 staging deployment; NO-GO for production or hosted UI mutations now.** Recheck the draft dependency head, source, protection, publication, preview environment and schema immediately before any future upload. Today's offline artifacts are preparation evidence, not an upload receipt or an excuse to reuse an expired function manifest.

On the existing approved Linux x64 / Node 22 environment:

1. Use a clean detached checkout at the exact application pin; `npm ci`; verify lockfile hash `c1de2bdb184e932b9647d5d0648e6243ed185b58f755f377e31031c7cabaa3e9`.
2. Reverify preview-only public staging configuration, V2 true, function-only secrets, no shared/provider variables, all-deploy team login and stopped builds. Stop if any differs.
3. Set `COMMIT_REF=f5324b203387a158df3c050569b95a9044368bc0` for the reviewed integrated CLI procedure. Only after authorization run exactly once:

   ```sh
   netlify deploy --draft --context deploy-preview --site d83ff6cb-f57b-4741-8c3c-3eaae7adab19 --message "Wave 1 UI candidate f5324b203387a158df3c050569b95a9044368bc0" --json
   ```

4. Capture a private durable one-attempt marker before upload. Revalidate the fresh official manifest's 23 functions, Linux invoice package, client hashes, release context and source identity. Do not use `--prod`, an alias, `--no-build --context`, Windows-native bundles, or a push/merge to main.
5. Verify the actual returned ID/origin, ready/preview/unpublished state, exact function digests and protected health marker. Anonymous access must remain blocked. Recheck the old publication and Auth hash. An ambiguous result requires receipt/list inspection, never automatic re-upload.

Do not invent the new origin. After it exists, `prepare-auth-config.mjs ACTUAL_PRIVATE_RECEIPT PRIVATE_CONFIG_DIRECTORY f5324b203387a158df3c050569b95a9044368bc0` can prepare the external minimal TOML. Any subsequent Auth update requires separate explicit approval and a diff limited to `site_url` plus the exact `/auth/callback` and `/auth/callback\?**` pair. No wildcard hosts, original draft, localhost, provider changes or Auth messages are included.

Rollback/stop means leave the unpublished candidate unused and keep the original publication. No publication or database rollback is part of this checkpoint. Both local query modes pass; hosted legacy remains untested. A separate legacy preview and Auth/perimeter plan would need independent authorization and must not change the V2 preview variables.

## Independent authorization gates

**A. Authorize exactly one protected, unpublished V2 staging deployment of `f5324b203387a158df3c050569b95a9044368bc0` to site `d83ff6cb-f57b-4741-8c3c-3eaae7adab19`, using the fresh integrated Linux/Node 22 CLI build and verification above.** This excludes Auth changes, application sign-ins, fixtures and business mutations.

**B. Later, after reviewing the actual new deployment, separately authorizing its minimal exact-host Auth update, and refreshing all safety proofs, authorize the independent `e2e-wave1-ui-20261017-a` UI01–UI09 fixture/HTTP/cleanup run described in the executor report.** Bind the receipt to the actual new deployment, approved executor/manifest/artifact/baseline hashes and an explicit unexpired window. No H receipt, account or journal may be reused. Deployment approval does not grant this permission.
