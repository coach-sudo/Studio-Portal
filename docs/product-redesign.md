# Coach’D product redesign

Starting point: `bf22833`, `codex/lesson-operational-intelligence`. The existing
operational intelligence implementation is the design baseline. No financial,
permission, booking, automation, integration, or database rules are rewritten.

## Route inventory, recorded before implementation

| Family                   | Routes and major states                                                                                                                                         | Design archetype                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Coach overview           | `/coach`, `/coach/today`; next/current lesson, preparation, readiness, follow-up, approvals, import review                                                      | Studio overview / day timeline              |
| People                   | `/coach/students`; search, status filters, pagination, new student, import, merge                                                                               | People workspace                            |
| Relationship             | `/coach/students/:id`; overview, lessons, lesson detail, work, notes, account, household contact, payments, actor page                                          | Profile and relationship workspace          |
| Scheduling               | `/coach/bookings`; calendar, overview, services, availability, setup, classes, series; booking detail, manual booking, service editor, weekly hours, exceptions | Scheduling workspace                        |
| Content                  | `/coach/materials`, legacy notes/lessons redirects                                                                                                              | Teaching library                            |
| Finance                  | `/coach/finance`; balances, packages, discounts, history, configuration                                                                                         | Financial operations                        |
| Messaging                | `/coach/inbox`, `/coach/campaigns`, student communication timeline                                                                                              | Conversation / editorial / delivery history |
| Publishing               | `/coach/actor-pages`, student actor management                                                                                                                  | Creative publishing                         |
| Configuration            | `/coach/settings`; studio, portal, appearance, connections, automation, data/recovery and existing local categories                                             | Configuration index / rules workspace       |
| Other coach              | `/coach/referrals`, `/coach/classes/:offeringId`                                                                                                                | Referral and class workspace                |
| Portal                   | `/portal`; home, work, bookings, lessons/:id, notes, classes/:id, inbox, payments, referrals, actor-page, settings                                              | Personal coaching workspace                 |
| Guardian                 | Same portal routes, household context and existing access checks; finance/work/scheduling permissions independent                                               | Household workspace                         |
| Public booking           | `/book`, `/book/:slug`, `/booking/:token`; catalog, format, time, details, payment, confirmation, manage, cancel/reschedule                                     | Guided booking                              |
| Public portfolio         | `/actors/:slug`; published, unavailable, media and document views                                                                                               | Creative portfolio                          |
| Public packages          | `/gift/:id`, `/gift/claim/:token`, `/gift/thanks`, `/package/:id`                                                                                               | Purchase / gift                             |
| Authentication / utility | `/login`, `/coach/login`, `/auth/callback`, `/change-password`, `/terms`; error/success/loading                                                                 | Focused single task                         |
| Shared states            | Activity center, daily popup, navigation/collapse, command menu, dialogs, notices, empty/loading/error states                                                   | Shared system                               |

## Design system

Warm ivory canvas, warm white surfaces, forest actions, sage success, restrained
gold attention, burgundy danger. Branding overrides remain authoritative. CSS
custom properties define spacing (4–64), radii (8–24), type, weights, control
heights, widths, motion, layers, and elevations. Existing DM Sans and Lucide
remain; no new fonts, imagery, UI framework, or animation dependencies.

Ownership: `styles/tokens.css` owns tokens; `styles/product.css` owns shared
presentation and page archetypes; `styles/public.css` and `styles/appearance.css`
load with their respective route families. Existing CSS remains the compatibility layer
for feature-specific states; it is not deleted without proof of non-use.

Page introductions establish hierarchy without decorative boxed headers.
Cards group related decisions. Timeline, people, finance, messaging, settings,
and creative publishing retain distinct compositions. One dominant action per
workflow; secondary actions are outlined or quiet; danger is explicitly labeled.

## Interaction and accessibility

Short decisions stay dialogs. Complex edit/context surfaces opt into the shared
Drawer. Both use named dialog semantics, unique IDs, focus trapping, disabled and
hidden control exclusion, Escape, scroll lock, and focus restoration. Drawers
become full-height sheets on mobile; action footers remain reachable. Route
destinations remain unchanged. Command search reuses existing navigation.

Coach Bookings calendar selection opens the related booking in a contextual
drawer, retaining the selected occurrence's date and lesson link. Group
appointments offer explicit participant booking choices. Unbooked lessons have
their own detail drawer. Booking/lesson deep links remain supported; dismissal
returns to Bookings. Existing student, lesson, message, location, refund and cancel
capabilities remain authoritative; no new booking command is introduced.

Controls have visible focus and touch-friendly heights. Reduced motion disables
transitions. Portal dark appearance uses the same semantic tokens. Mobile uses
stacked layouts, scrollable local navigation, safe-area spacing, and readable
agenda cards. Errors and persistent operational notices remain in context.

## Before / after decisions

- Large decorated headers → open editorial introductions; student home remains personal.
- Heavy dark navigation → light sidebar and soft sage active states, closer to the supplied reference.
- Gold buttons everywhere → forest primary actions; gold reserved for attention.
- Uniform bordered records → softer surfaces, people rows, schedule timeline and quiet metadata.
- Centered complex edits → side sheets; confirmations remain small dialogs.
- Equal overview metrics → prominent operational summary and secondary studio metrics.
- Generic loading text → shared structural skeleton with the original accessible status text.

## Verification and limitations

See the accompanying verification record for measured results and screenshot
coverage. Local demo screenshots are isolated examples, not proof of live provider
or guardian authorization behavior. Existing deployed fixture suites remain the
authority for those checks. No production publication or mutation is authorized.
