# Redesign progress

| Work                                       | Status                                                                                                                                                                                        |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 · Lesson History                        | [Scoped #118](https://github.com/coach-sudo/Studio-Portal/pull/118). Local matrix and required GitHub checks passed. The 10 broader failures match the original layout by test and assertion. |
| A2 · Package and payment layout            | [Scoped #119](https://github.com/coach-sudo/Studio-Portal/pull/119). The local matrix, all required GitHub checks, ephemeral browser job and artifact packaging passed.                       |
| A3 · Actor preview                         | [Scoped #120](https://github.com/coach-sudo/Studio-Portal/pull/120). The local matrix, all required GitHub checks, ephemeral browser job and artifact packaging passed.                       |
| Actor API privacy                          | Published independently on main `8a0925e`; privacy-safe production containment remains in force.                                                                                              |
| Release B · Shared foundations             | [Merged #126](https://github.com/coach-sudo/Studio-Portal/pull/126). Hosted and mobile acceptance are recorded below.                                                                         |
| Roles, connected workspaces, notifications | Follow approval of shared foundations. Use the existing route inventory and preserve delivery controls.                                                                                       |

The exact combined candidate `218b7767b3ec` passed 54 local browser cases in Chromium and WebKit, 57 finance, booking, and publication checks, and the protected Linux build. The staging health response confirmed the revision. Authenticated Student and Household staging journeys passed, and the owner confirmed the Android checklist. The physical iOS Safari check remains outstanding. See the [preview, phone checklist and screenshot evidence](VISUAL_ACCEPTANCE.md#protected-candidate-and-phone-acceptance).

The two tracked dark-mode Actor Builder Axe checks are repaired in the Release B candidate. The `Wave 5 authoring and contrast` checks at 390 and 1440 CSS px now pass in light and dark themes. Paired foreground/surface tokens fix the title, Edit tab, form controls and viewport buttons. Visual inspection also caught a clipped long private-preview title at tablet width; a scoped stacked hero and title-fit regression cover that case.

Release B extends existing tokens and components with editorial headings, warm canvas, forest navigation, paired disabled states, pending actions, wrapping record rows, and responsive Coach priorities. The 18 new role/width/browser cases and 38 existing lesson/package contracts passed together; all 16 Actor preview cases, both Actor contrast checks, 21 primitive/content/Actor tests and branding tests passed. No production changes were made from this branch. See [B evidence and limits](VISUAL_ACCEPTANCE.md#release-b-foundation-pilots).

Release A integration [#125](https://github.com/coach-sudo/Studio-Portal/pull/125) merged by rebase into main `f9fc64d10558f44e467eb096fcdc0e83a480fa5b`; its tree matches the verified combined candidate `a04aba2`. The coordinated production deploy `6b0871c359ec737f4657d524` is published and verified; automatic builds remain stopped and the published revision is locked. Its privacy function bundle matches the independent privacy release. Release B preserved that tree through its separate approval and publication. If a UI repair regresses, revert its scoped change or restore a known privacy-safe deploy. Keep the privacy and Calendar repairs in place.

## Release B · Published

[PR #126](https://github.com/coach-sudo/Studio-Portal/pull/126) passed the required verification, migrations and browser smoke checks. The owner approved the actual protected preview and mobile experience. The squash merge `73693d9ab316` matches the approved source tree.

The single production deployment `6b089767d3f364a950eac72e` is published and locked. Production health reports `73693d9ab316`, and automated builds are stopped. The Actor API function digest matches the privacy-safe Release A deployment. The previous production deploy URL returned 404 under historical deployment containment, and the staging candidate returned 401 without team sign-in. The Calendar tests passed as part of required browser CI. The preceding privacy-safe production deployment `6b0871c359ec737f4657d524` is the independent UI rollback target.

## Release C · Writing and interaction pilots

On November 26, 2026, the owner reviewed and approved the visual appearance and interaction direction of the pilots at `4362852`. This approval covers unchanged pilots. Review new visuals only where later work materially changes the approved experience. Assignment access, draft recovery, device behavior and release readiness have separate technical gates.

Release C branches from the approved Release B tree. The coach lesson composer reuses the current note format and the shared overlay. The plain-text `WritingArea` serves the Actor biography and simple fields. Journal responses can switch to the shared rich editor and retain their plain-text response alongside formatted content in the existing response record. The Professional canvas adds exact lesson context, focus mode, a full-screen phone layout, explicit private save and publication review, and access to the existing resource picker.

Confirmed lesson draft saves use the existing note record. An interrupted create retries against the same note ID. Version conflicts keep the writer's text in view and require reconciliation with the current note. Draft saves leave lesson status, credits and recommendations alone. The publication review shows the intended student, lesson and attached resources before the separate confirm action.

Coach attachment flows reuse the existing authenticated file assets and the resource command. The file queue reports byte progress while transferring, reports attachment separately, and reuses the retained object when only attachment needs a retry. The existing hash and ownership scope still govern reuse. New resources attached to a note stay scoped to that note.

Assignment attachments use a private bucket with the existing studio formats and 50 MB file limit. The upload and attachment are separate. Hash reuse is scoped to the exact assignment. The student owns pending files and can remove their links before submission. An explicit assignment completion makes those files available to the authorized coach and household members with work access. Reopening preserves prior submissions. Storage rechecks the same relationship on download. Unlinking revokes access and retains the object for safe retry. Assignment files stay outside the shared Library and Actor media.

Private note recovery uses a separate record scoped to the authenticated coach, studio, student and note. Debounced changes have versioned write receipts. A recovery record can precede the first explicit save or hold unpublished changes to an existing live note. It expires after 30 days without a new save, and a service-only maintenance routine can prune expired rows. A live note remains readable from its published record until explicit publication. The application keeps unacknowledged changes in memory.

The additive migrations are `20261126204459_release_c_lesson_note_recovery.sql` and `20261126204511_assignment_attachment_access.sql`. For a UI rollback, deploy the accepted Release B revision and retain the additive records and private storage policies. Review retention before any later removal. Dropping an attachment link or recovery table would discard recorded state. Review the production migration separately before enabling Release C.

TypeScript, the production-mode build, bundle gates, 67 focused tests and ten browser cases across Chromium and WebKit passed for the approved pilots. The browser cases included a loopback upload with actual multipart bytes and retry of the same uploaded asset after attachment failed. See [Release C pilot captures](VISUAL_ACCEPTANCE.md#release-c-writing-and-upload-evidence). Physical keyboard tests and real staged file authorization remain integration checks before broader use in dashboards or the full Actor Page redesign.

### Gmail connection recovery

Studio Settings → Integrations → Gmail reports the sender account once verified, the latest Gmail provider acceptance recorded by the portal, and the automated delivery hold. The authorization check refreshes a token and sends no message. A legacy token refresh cannot establish the sender identity or prove Gmail API acceptance. Coach access is scoped to the deployment's configured studio.

Gmail reauthorization uses a separate Google Web OAuth client with offline consent, PKCE, one-time browser-bound state, and a verified match to the configured sender. The additive `20261126223935_gmail_delivery_oauth.sql` migration stores the refresh grant in Vault and restricts access to the service role. Calendar and Gmail inbox import continue to use their existing credentials. Outbox sender recovery uses the dedicated grant for the configured studio after consent. If an existing dedicated grant cannot be verified, the worker fails closed for that studio.

Before production enablement, separately approve Vault migration application and enable the Gmail API for the dedicated Google OAuth Web application. Configure the consent audience and any applicable verification for the `gmail.send` scope, plus `openid` and `email` for sender identity. Register the exact canonical HTTPS callback at `/api/v2/gmail/oauth/callback`. Set server-side `GOOGLE_GMAIL_OAUTH_CLIENT_ID`, `GOOGLE_GMAIL_OAUTH_CLIENT_SECRET`, `GOOGLE_GMAIL_OAUTH_REDIRECT_URI`, and `GOOGLE_GMAIL_ACCOUNT_EMAIL` for the intended deployment. Keep the existing email delivery hold in force during consent and verification. The portal does not modify preferences, queue status, or worker configuration. Real Google consent requires a separately configured test client and account for hosted acceptance.

For rollback, retain the delivery hold, the prior accepted privacy-safe deployment, and the additive Vault migration. A pre-Gmail build uses the legacy sender, so verify the intended sender before any separately approved delivery activation. Credentials can be revoked in Google and later removed from Vault under separate authorization if the dedicated feature is retired.

## Release F · Smart Notification Batching

Reserved for Release F. The mailing workflows, existing preferences, and holds carry through Releases C and D.

- Start a configurable collection window with the first qualifying event. Default to 15 minutes.
- Consolidate compatible emails for bookings, cancellations, rescheduling, assignments, shared materials, published feedback, and other qualifying events.
- Use singular or plural subjects and content with relevant record details.
- Group only within the correct recipient, student, studio, and permission boundaries. Offer household consolidation only where explicitly authorized.
- Reconcile contradictory or superseded events before delivery.
- Deliver urgent schedule changes, security alerts, payment receipts, and other time-sensitive transactional notices immediately.
- Use the existing outbox for durable batching, safe retries, concurrency control, and duplicate prevention.
- Provide batching preferences and delivery queue visibility in Studio Settings → Communications.
- Continue delivering prompt in-app notifications independently of email batching.

Implement the batching logic, migrations, workers, and delivery settings during Release F.
