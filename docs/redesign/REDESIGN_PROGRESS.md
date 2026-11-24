# Redesign progress

| Work                                       | Status                                                                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1 · Lesson History                        | [Draft #118](https://github.com/coach-sudo/Studio-Portal/pull/118). The 20 local browser cases and all required GitHub checks passed. The 10 broader failures match baseline by test and assertion.                                  |
| A2 · Package and payment layout            | [Draft #119](https://github.com/coach-sudo/Studio-Portal/pull/119). The 16 responsive cases, two existing direct-lesson browser cases, and 23 existing unit tests passed locally.                                                    |
| A3 · Actor preview                         | [Draft #120](https://github.com/coach-sudo/Studio-Portal/pull/120). All 16 focused browser cases passed locally. Two existing contrast checks still fail, with the same affected desktop controls and fewer affected phone controls. |
| Actor API privacy                          | Independent patch and synthetic results ready for private review. Expedite approval ahead of the UI release. Review legacy media compatibility privately.                                                                            |
| Release B · Shared foundations             | Await Release A acceptance and separate implementation authorization. Reuse existing tokens, controls, and overlay primitives.                                                                                                       |
| Roles, connected workspaces, notifications | Follow approval of shared foundations. Use the audit route inventory and preserve delivery controls.                                                                                                                                 |

The combined local UI checkout passed 54 browser cases and TypeScript. The three UI drafts started from `8dd3be699fcde54cb6d5f190597d14681c6f64b1`, verified against production and GitHub main.

Hosted acceptance and physical Android Chrome and iOS Safari checks are outstanding. Review GitHub checks on the A2 and A3 drafts before merging. After approval, release the privacy fix first, then A1, A2, and A3. See [visual acceptance](VISUAL_ACCEPTANCE.md) for the synthetic comparisons and local verification.
