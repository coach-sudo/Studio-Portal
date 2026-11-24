# Release A visual acceptance

## A1 Lesson History

Baseline `8dd3be699fcde54cb6d5f190597d14681c6f64b1` matched the production health response and GitHub main on November 23, 2026. The browser fixture supplies synthetic lesson records and runs on loopback.

### Before and after

| Browser  | 320 and 390 CSS pixels                              | 768 and 1440 CSS pixels                                                  |
| -------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| Chromium | [Phone comparison](evidence/a1/chromium-phones.jpg) | [Tablet and desktop comparison](evidence/a1/chromium-tablet-desktop.jpg) |
| WebKit   | [Phone comparison](evidence/a1/webkit-phones.jpg)   | [Tablet and desktop comparison](evidence/a1/webkit-tablet-desktop.jpg)   |

The baseline put the status group into the 20 px icon track on phones. A1 gives the group the content width, and moves Open below the chips on phones. At 320 px, Scheduled and Payment processing occupy separate lines as complete chips. At 390 px they can sit together. On wider screens the title and date read as separate lines and Open stays intact. The mockup depicts a full-width Open button. This patch keeps the original whole-row link and the existing Open label. Shorter rows change the amount of content visible above the history card in the scrolled comparisons.

### Checks

The new browser spec covers 320, 375, 390, 428, 768, 1024, 1280, and 1440 px in both engines. It checks actual rendered word fragments and horizontal bounds, exact learner and lesson URLs, keyboard and emulated touch activation, the fixed navigation edge, the empty state, and finance visibility for a schedule-only Household contact.

- The same regression suite produced 18 failures and 2 passes on the original layout. On A1 all 20 passed.
- Five relevant existing unit and component suites passed all 91 tests. TypeScript and the repository secret scan passed.
- The broader local candidate spec produced 34 passes and 10 failures on both the original and patched revisions. Its existing failures cover the Coach finance label, Coach search opener, Coach unavailable-record redirect, and exact URL assertions which omit the learner query parameter for Student and Household lesson routes.

Run the focused matrix in PowerShell with Chromium and WebKit installed. Set the output directory to an existing absolute path outside the checkout.

```powershell
$env:CANDIDATE_QUERY_MODE = 'true'
$env:HOSTED_ACCEPTANCE_DIRECTORY = 'C:\path\to\local-evidence'
npx playwright test --config=playwright.candidate.config.ts e2e/candidate-local/lesson-history.spec.ts --project=desktop --project=webkit
```

Physical Android Chrome and iOS Safari device checks require access to a test device. The browser results use synthetic accounts and cover the application UI.

### Rollback

While in draft, close the PR if the candidate is rejected. If the patch is later released, revert the A1 source and its paired browser test together through the normal reviewed Git release process. The patch adds no data or deployment dependency.

## A2 and A3 visual acceptance

| Patch | Sanitized comparison at 390 px                                            | Local browser verification                                                                                            |
| ----- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A2    | [Package filters and purchase review](evidence/a2/package-layout-390.jpg) | 16 responsive cases passed. Eight phone cases failed on the original layout. Two existing direct-lesson cases passed. |
| A3    | [Private Actor Builder preview](evidence/a3/actor-preview-390.jpg)        | 16 responsive cases passed. Ten cases failed on the original layout.                                                  |

Both matrices use the same eight widths as A1 and run on Chromium and WebKit. The A2 comparison shows the filters stacked at full width and the purchase dialog using the shared content inset. A3 shows one preview width on mobile and space for more content below the portrait. Desktop retains both preview sizes.

The combined checkout passed all 54 focused and existing direct-lesson browser cases and TypeScript. Two older Actor contrast checks still flag controls present in the original layout. The desktop selectors changed with the viewport-control class and button type. The two removed phone controls no longer appear in its contrast findings.

Hosted candidate and physical-device acceptance are outstanding. Each UI patch has its own revert instructions in the draft PR.
