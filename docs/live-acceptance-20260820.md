# Production live acceptance — 2026-08-20

Target: `https://portal.d-a-j.com`

All checks below were executed against the production site with live Supabase data. Provider checks used the connected Google, Gmail, Stripe, and Netlify configuration. Test data is clearly named `Production Test Student` / `Prospective Test Student`.

## Coach workflows (25)

1. Google OAuth sign-in returned to the protected coach workspace — passed.
2. Coach home loaded current studio data — passed.
3. Today view loaded scheduled occurrences — passed.
4. Bookings overview loaded live services and integration health — passed.
5. Booking calendar view opened — passed.
6. Services catalog opened all published services — passed.
7. Existing service editor opened and saved pricing, delivery, and policy fields — passed.
8. Weekly availability loaded configured Tuesday–Saturday hours — passed.
9. Weekly availability saved without losing its rules — passed.
10. Blackout creation dialog opened and cancelled safely — passed.
11. New student creation persisted to Supabase — passed.
12. Student roster reload retained the new student — passed.
13. Student details, goals, tags, eligibility, and portal access saved — passed.
14. Student account view exposed Drive, portal, actor-page, and invite controls — passed.
15. Portal invitation sent through Supabase Auth and arrived in Gmail — passed.
16. Direct lesson creation persisted and queued a calendar projection — passed.
17. Assignment creation persisted to the student workspace — passed.
18. Published rich note creation persisted — passed.
19. Coach-shared material creation persisted — passed.
20. Coach-created booking confirmed, appeared in Bookings, and generated a unique Meet invitation — passed.
21. Studio identity/colors/contact settings saved — passed.
22. Student-workspace and public-booking copy settings saved — passed.
23. Pricing, reminder hours, and the $40 in-person upcharge saved — passed.
24. Email automation templates saved and all provider health cards reported connected — passed.
25. Actor draft creation, material approval, profile approval, publish, live-view, and unpublish controls completed — passed.

## Current-student workflows (15)

26. Supabase invitation acceptance established a real student session — passed.
27. `/student` loaded the correct student identity and current work — passed.
28. Book-a-lesson CTA linked to the public catalog — passed.
29. Current Work displayed the active script and reader-support action — passed.
30. Bookings displayed the confirmed coaching occurrence — passed.
31. Join action exposed the unique Google Meet URL — passed.
32. Booking management opened the accepted policy and cancellation controls — passed.
33. Practice displayed the assigned work — passed.
34. Ask-coach action persisted and became Help requested — passed.
35. Materials displayed shared studio content — passed.
36. Student submitted an actor reel link for coach review — passed.
37. Payments displayed packages, receipts, balances, and payment-method entry points — passed.
38. Actor Page editor saved a bio and submitted it for coach review — passed.
39. Student Settings loaded contact, timezone, portal preferences, and Stripe controls — passed.
40. Student changed pronouns and compact-view preferences; reload retained the change — passed.

## Interested-student/public workflows (10)

41. `/book` loaded the production catalog, branding, footer, and all published services — passed.
42. Service detail displayed duration, base price, delivery, and policy — passed.
43. In-person selection immediately applied the configured $40 upcharge — passed.
44. One-time and recurring cadence controls were visible and selectable — passed.
45. Live availability returned timezone-aware slots after Google busy-time filtering — passed.
46. Minor booking exposed and required guardian details — passed.
47. Pay-now, pay-later, and verified-credit choices rendered with policy terms — passed.
48. Pay-later confirmation created an atomic booking and secure management link — passed.
49. Token-scoped reschedule consumed the allowed change and updated the occurrence — passed.
50. Token-scoped cancellation applied the policy state and removed the booking from upcoming totals — passed.

## Supporting verification

- TypeScript: passed.
- Vitest: 11 files, 84 tests passed.
- Production Vite build: passed.
- Production health: Supabase, Stripe, Google Calendar/Meet, Gmail, and scheduled workers connected.
- Gmail delivery: coach notification, student confirmation, Supabase invite, and Google Calendar invite observed.
- Public actor page: published bio and approved YouTube material rendered as an embedded player.
- Netlify automatic builds from the obsolete Git `main` branch were paused to prevent older code from overwriting the verified manual production release.

## Final cohesion and recovery pass

- `/book` was rechecked from loading state through service and delivery selection; the configured studio name, logo, colors, copy, footer, policies, prices, and $40 in-person upcharge are live.
- A reversible production control test disabled the booking-page coach name in Settings, confirmed its removal from `/book`, restored it, and confirmed it returned after the CDN cache window.
- Connections now provides live refresh, Calendar/Gmail intake, and failed Calendar/email retry actions. Data & recovery retries failed outbox messages and refreshes the visible queue.
- Calendar/Gmail matches are grouped by recurring event and remain outside the teaching flow until reviewed. The coach can link an existing student, create an interested student, merge a matched duplicate, or ignore the full recurrence group.
- The roster now includes an audited duplicate-profile merge that transfers lessons, notes, assignments, materials, packages, payments, guardian relationships, bookings, actor data, and provider matches in one database transaction.
- The provider matcher and review UI exclude configured coach addresses, Google event identifiers, and notification senders from student-email suggestions.
- The 32 rows created by the earlier permissive intake audit were removed after confirming that their two artificial profiles had no notes, materials, payments, bookings, portal relationships, or actor data. All 32 original signals were retained in four grouped review decisions.
- Final production deploy: `6a87410b418d3c799e69029c`.
