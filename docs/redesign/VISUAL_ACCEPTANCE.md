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

## Protected candidate and phone acceptance

The Netlify team-only [Release A preview](https://6b051fdfea499f6777ebecbf--coachd-staging.netlify.app/login) serves the combined UI and privacy code from `218b7767b3ec`. Anonymous requests to the app, health route and Actor API are denied by the hosting perimeter. After standard Netlify sign-in, the health response matched the candidate and the anonymous application Actor route returned its expected unavailable response for a synthetic missing profile.

Open the same preview in Android Chrome or iOS Safari. Complete Netlify team sign-in, then use the existing synthetic Student and Household logins from the restricted local handoff. Use the Coach’D password form and keep test screenshots free of credentials. Stay on this exact preview origin when changing roles.

1. **Lesson History.** Open Schedule, then Lesson History. Check long status labels in portrait, tap Open, compare the lesson and learner with the history row, and return. Repeat with the Household login and confirm that access matches its assigned permissions.
2. **Packages.** Open Payments and Available packages. When at least two synthetic options are available, change Lesson length, Sort and any other displayed filter. Open a package review, check the price and renewal copy, scroll to its actions, and Cancel. Keep checkout unsubmitted.
3. **Actor preview.** Once a synthetic draft is available, open Actor Page and Edit. Type a harmless temporary marker, switch to Preview page, and return to Edit to confirm it is still there. Check that the portrait fits and Edit and Close remain reachable. Discard the edit without saving, submitting, or publishing. Check the separate Preview draft action if present.

The staging fixture now has two purchasable durations, a historical lesson with a long payment-status label, and a synthetic published Actor profile with a private draft and placeholder portrait. Signed-in hosted Chromium checks at 390 CSS px verified the Student lesson target, package filter and purchase-review cancel, and private preview with unsaved text. Household verified its linked learner, exact lesson and authorized payment views. The owner confirmed the Android checklist. Physical iOS Safari remains outstanding because no iOS device was available. The separate local WebKit matrix passed. The review stopped before submitting checkout, saving Actor edits, or invoking a provider.

## Release B foundation pilots

These actual application captures use loopback synthetic fixtures at 390, 768 and 1440 CSS px. Every included image was visually inspected against the approved Coach and button references. The role fixture supplies package options and historical status labels; no production records, credentials or transactions appear. Coach identity is replaced in the fixture with Candidate Coach. Actor examples use the existing local synthetic workspace.

| Pilot                         | Phone                                       | Tablet                                      | Desktop                                       |
| ----------------------------- | ------------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| Coach Today                   | [390](evidence/b/coach-390.png)             | [768](evidence/b/coach-768.png)             | [1440](evidence/b/coach-1440.png)             |
| Student schedule/history      | [390](evidence/b/student-390.png)           | [768](evidence/b/student-768.png)           | [1440](evidence/b/student-1440.png)           |
| Household packages            | [390](evidence/b/guardian-packages-390.png) | [768](evidence/b/guardian-packages-768.png) | [1440](evidence/b/guardian-packages-1440.png) |
| Private Actor Builder/preview | [dark 390](evidence/b/actor-dark-390.png)   | [light 768](evidence/b/actor-light-768.png) | [dark 1440](evidence/b/actor-dark-1440.png)   |

The candidate passed 18 foundation cases (three roles × three widths × Chromium/WebKit), the 38 existing Lesson History/package/direct-lesson browser cases, 16 Actor preview cases across eight widths in both engines, and both original Actor contrast checks at 390/1440 in light and dark themes. TypeScript, three branding tests and 21 existing primitive/content/Actor tests passed. Focused ESLint has no errors; existing label/autofocus warnings remain. The new Coach action-word and private preview title-fit assertions cover issues found during visual review. The targeted Coach cases were rerun after responsive action changes; the Actor matrix was rerun after the private tablet fix.

The references' warm canvas, forest navigation, serif hierarchy, inset priority card and neutral controls are present. Existing route labels, Today title, preparation/financial context, and current Actor editor architecture are retained. Body font requests are blocked by synthetic network fencing, so these captures use the declared sans-serif fallback; the system serif heading needs no network. Hosted font rendering needs acceptance. Full-page captures place fixed bottom navigation at the capture viewport's fold, which can cross below-fold content in the exported image; the page scrolls behind it and existing bottom padding preserves access to the final controls.

The dim student heading behind the dark Builder is outside the inspected modal and remains a broader Coach dark-theme follow-up. No serious/critical Axe failures remain inside the checked purchase-review dialogs or the two tracked Actor checks. Other routes and arbitrary custom palettes have not received exhaustive contrast certification. The accessible brand resolver and its tests are preserved, including computed foregrounds for light/dark custom brand fills and the configured canvas override.

B is ready for draft review and protected hosted acceptance after integration onto the final Release A revision. This local evidence does not claim hosted or physical-device B acceptance. On the protected candidate, repeat the existing phone checklist plus Coach Up next/action wrapping and sidebar navigation, test long Actor names at tablet width, and verify pending/disabled controls with keyboard and reduced motion. Android and physical iOS Safari B checks remain outstanding. Revert the B source commits together to return to the accepted A presentation; keep every privacy fix and Calendar repair in place.

The production-mode build, bundle budget gate, and repository secret scan also passed. CSS gzip is 22,972 bytes, above the existing 22 KB warning and below its 25 KB failure budget; no dependency was added.

After Release A #125 published at main `f9fc64d10558f44e467eb096fcdc0e83a480fa5b`, B integrated its ancestry with an unchanged A tree and now targets main. The 18 pilot cases passed after the navigation palette refinement; two additional custom-brand sidebar Axe cases passed across five light/dark/mid-gray palettes in Chromium and WebKit. Palette checks use reduced motion so sequential theme transitions cannot contaminate color measurements. The fills mix toward the resolver's existing hover tint, preserving text contrast for custom colors. This adds coverage rather than repeating the unchanged A integration suite.
