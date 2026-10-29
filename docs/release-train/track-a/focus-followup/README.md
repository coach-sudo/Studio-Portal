# Public booking focus: unpublished follow-up

Implementation source: `368fe3453ffa55ca38ab1a119f5e6ee9c50f5e9c`, based on released main `9b1b57fb187797370621663a2fde6057a8e28667`. The original approved release ref remains `ad8c81952ea9dabbbedcea6065d3618ade9a0e6c`. This follow-up is a separate local branch, `codex/release-a-focus-followup`; it has not been pushed, made into a PR, merged or published.

The customer benefit is a clear keyboard-focus indicator on public booking controls. The deployed sidebar text repair remains intact. No booking step, price, scheduling command, permission, identity, accounting record or provider behavior changes. Affected audit inventory: SP-15, B01, F04/F06, X13. The coordinator owns the central 19-finding/42-workflow/20-connection registers; this focused evidence does not award complete workflow or portal acceptance.

## Cause and ownership

Production observation of released `9b1b57fb1877` found a global `*:focus-visible` declaration in `src/styles.css:3` using a translucent pink outline with `!important`. It overrode the intended black outline in the public stylesheet. Compositing the measured outline against the white and recurrence backgrounds gave **1.705:1** and **1.642:1**, below the 3:1 indicator target. The previous automated check established that a visible outline existed; it did not establish which declaration won or measure its contrast. See [measured production evidence](evidence/production-before-focus.json).

There is now one priority owner: the existing global focus rule consumes inherited `--focus-outline`, preserving its exact prior `3px solid #ef5d5173` fallback. `.booking-public` alone supplies an opaque two-pixel black outline and a white three-pixel halo token. The ineffective duplicate public outline declaration is removed. The shared priority delegates to its scope; a second competing `!important` rule is not added. Non-booking routes keep the same fallback and visual treatment.

The production changes are limited to one value substitution in the existing global rule and scoped tokens in `src/styles/public.css`. No global stylesheet reformat, component redesign, migration or server change is included. Revert the two stylesheet changes together if needed; no data or schema recovery is required. The remaining legacy global fallback is intentional compatibility work, rather than an unreviewed portal-wide focus redesign.

## Executed validation

The existing Vite application and its complete real stylesheet cascade run in the loopback browser harness. External requests are blocked; synthetic public-service/availability/confirmation responses are explicit fixtures. Tests do not load an isolated CSS subset or inject the fix into the document.

- **8/8 cases passed**, zero retries: Chromium/WebKit at 320, 390, 768 and 1440 pixels.
- **128 focused-control observations** cover the branded dark footer, translucent topbar links, meeting choices, recurrence controls, time slot/continue, customer inputs, terms checkbox and enabled confirmation.
- Actual ancestor backgrounds are alpha-composited before measuring the rendered outline and halo. The effective indicator contrast is **12.193:1 minimum**, above 3:1 in every measured state. On the dark footer the white halo provides contrast; on light backgrounds the black outline does. The dark-footer black outline alone is 1.722:1 and is not represented as passing independently.
- WebKit's native terms checkbox omits the halo. Its actual opaque black outline independently measures **21:1**, so the browser's native appearance is preserved. Other controls retain the two-tone treatment.
- **56 state checks** preserve the existing catalog/setup/time/details/disabled/error/confirmation journey, axe A/AA scans, no-overflow assertions, native required-field behavior and input recovery. Keyboard modality precedes named-control focus, and existing actions are activated with Enter. This is automated keyboard evidence, not a manual screen-reader session.
- The actual non-booking sign-in route is also visited without submitting credentials: all eight combinations retain the exact prior three-pixel pink fallback, with no inherited public outline token. This checks the CSS scope boundary; it does not certify authenticated coach/student/guardian workflows.
- Forced `tsc -b --force --pretty false`, targeted ESLint, configured production build, bundle budget and secret scanning passed. Dependency/package manifests are unchanged. Worktree caches are isolated; no install or dependency mutation occurred.

[Machine-readable evidence](evidence/verification.json) records every focused control and composite background, including native-control exceptions and the non-public fallback. [Screenshots](evidence/screenshots/) show light setup controls and dark footer focus at each width in both engines. The before image is actual public production; after images use the synthetic local service and are labelled accordingly. Full-page footer-focus screenshots retain sticky-header positioning at the scrolled focus offset; they are not evidence of a new header-layout defect.

The first scoped-priority prototype passed Chromium but four WebKit cases rejected a test assumption that every native checkbox paints a box-shadow. The failure log is retained at [initial-browser-halo-assumption.log](evidence/initial-browser-halo-assumption.log). The final test requires measured contrast from the actual rendered indicator: the outline remains mandatory opaque black and two pixels; an absent native halo is accepted only when that outline itself exceeds 3:1. The complete final semantic-owner matrix then passed. No failed run is relabelled a pass.

## Release gates

| Class           | Outstanding requirement                                                                                                                      | Why it applies                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — direct      | Coordinator review and final exact-candidate protected CI/packaging.                                                                         | Local targeted evidence is complete, but this unpublished source has not run the mandatory final infrastructure gates.                                           |
| B — shared      | Preserve the existing global fallback and required repository-wide checks.                                                                   | The source delegates a shared property; the fallback is unchanged and the non-public scope test passed. A real mandatory-gate failure remains blocking.          |
| C — independent | Stripe test credentials, Calendar/Gmail operational acceptance, booking/finance/identity integration and full authenticated-role acceptance. | No changes to their commands, migrations, access boundaries or provider calls are present. Their unverified work is not promoted by this fix.                    |
| D — operational | Separate authorization to merge/publish this new source and repeat read-only production checks afterward.                                    | The earlier authorization applied to `ad8c819` only. No new publication, hosted configuration, provider call or financial action is performed by this follow-up. |

Recommendation: review this small focus-owner correction as the next independent accessibility candidate. Keep the deployed release and operational controls unchanged until its exact source passes required gates and receives authorization.
