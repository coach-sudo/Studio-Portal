# Redesign decisions

The approved product decisions are a three-region Coach Today, useful Student and Household homes, independent Payments and Messages destinations, a desktop bell popover and phone sheet, separate My Settings and Studio Settings, and a single-source library resource model.

A1 keeps the entire lesson row as the existing link. On phones the two chips can wrap as a group beneath lesson context, followed by a visible Open label. This borrows the ordering from the v4 proposal while retaining the existing label and row target. The shared `Status` primitive and permission checks are reused.

Open decisions include the final Actor publication and consent contract, Household aggregate ranking and payer scope, durable draft recovery, and final visual approval of the concept screens. The audit and [design authority](DESIGN_AUTHORITY.md) govern subsequent work.

## Release B · Shared design foundations

Implement one integrated foundation milestone after separate approval. Use the approved Coach references and the audited mobile and interaction addendum. Keep the existing route, record, permission and business contracts while updating how they are presented.

| Work                                             | Extend                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Theme, typography, spacing and responsive layout | Extend `tokens.css`, `product.css` and `app-system.css`. Use CSS variables for semantic colors, focus, typography, spacing and sizes. Move reusable patterns out of `cohesion.css` only after a pilot proves the pattern.                                                                                 |
| Controls and asynchronous feedback               | Extend existing button styles, form controls, `Toggle`, `ListControls` and `InlineNotice`. Specify labels, focus, keyboard behavior, selection, validation, disabled reasons, pending and retry states. Reuse current action handlers and prevent repeat submission through their existing pending state. |
| Status, record rows and view states              | Extend `Status`, `Section`, `PageSkeleton`, `EmptyState` and `InlineNotice`. Establish readable wrapping, predictable action placement and permission-aware empty, error, and success states across role surfaces.                                                                                        |
| Dialogs, drawers and navigation                  | Extend `Dialog`, `Drawer`, `PageHeader` and `AppShell`. Share mobile insets, scrolling, action placement and focus return. Preserve the existing route and contextual links from `recordLinks.ts` and `useWorkspaceLocation.ts`.                                                                          |

Validate the foundations in three workflows before wider adoption.

1. **Coach Today.** Use the approved schedule, Up Next and Needs Attention hierarchy to prove scan-friendly typography, status rows, contextual navigation and loading and empty states.
2. **Student and Household Lesson History and package review.** Prove responsive record rows, exact links, form controls, dialog behavior, readable errors, and permission-aware states using the Release A fixtures. Cover physical phone interaction and keyboard operation.
3. **Private Actor Builder.** Prove the dialog surface, form hierarchy, focus and selected states in both themes. Fix the existing Actor contrast findings in the two Wave 5 checks at 390 and 1440 CSS px, then run axe and check reading, focus order and focus return in both themes.

Use existing components and CSS first. Verify the pilots at narrow phone, tablet and desktop widths in Chromium and WebKit, then review evidence against the design authority before broader adoption. Keep the rich writing composer, authenticated uploads, durable draft recovery, and the larger Actor approval flow on separately scoped work after the presentation primitives stabilize. Preserve their current behavior in the pilots.

## Release B implementation decisions

Extend `tokens.css` and `product.css` as the existing presentation layers. The body uses the existing DM Sans stack and headings use the system Georgia serif stack. This follows the reference hierarchy without adding a font package. Loopback screenshot fixtures block external font requests, so those captures use the installed sans-serif fallback. Hosted font rendering remains part of subsequent acceptance.

Forest navigation, outlined controls, semantic status colors, visible focus, border contrast and paired dark surfaces now share tokens. Existing asynchronous Actor save and package checkout actions expose `aria-busy` and a motion-aware pending indicator. Their existing pending guards and request paths remain authoritative. The Today view places its existing Up next and lesson list in a responsive two-column wrapper with matching document order. Other operational sections and actions remain available below.

Intentional departures from the reference include the existing Today title, current route labels, and existing preparation and financial context. No readiness percentage, testimonial, new dashboard metric, or extra Actor publication stage was added. The full dashboard composition, writing system, uploads, and durable draft management remain separately scoped. The two tracked Actor dark-mode failures are fixed by sharing foreground tokens across Coach and portal overlays, then pairing neutral and selected preview controls with their surfaces.

Branding remains configured through the existing accessible color resolver. The sidebar uses the resolved `--forest` / `--on-forest` pair, selected navigation and sidebar controls mix toward the existing contrast-safe hover tint, and the canvas honors `--accessible-canvas`. Custom light or dark brand fills therefore retain their computed foreground. The existing branding unit suite passes. The reference's forest appearance describes the default palette, rather than a hardcoded replacement for an owner's chosen palette.

Private preview tablet inspection exposed a pre-existing long-title clipping issue: the public hero retained two columns inside the narrower drawer. The B pilot stacks that hero only inside private previews at 850px and below, with a title-fit assertion. The public Actor page remains unchanged. The dim background student heading in the dark Coach screenshot is outside the Builder surface; broader Coach dark-theme headings remain follow-up accessibility work. Disabled More navigation remains unavailable according to its existing contract.

The existing Actor preview retains its numbered section headings (including 01 Biography) and current public portfolio typography. This is an intentional boundary before the broader Actor redesign; the B work repairs private editor surfaces and responsive content containment.
