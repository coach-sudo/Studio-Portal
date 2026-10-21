# Wave 5 corrective release

Based on current main `8578f8b4a50dc532a85bccac618a281f839cc9ce`. This corrects the supplied live screenshots and Settings defects; it does not start Wave 6. Provider-intake source is untouched.

Visual changes: readable mobile note rows with secondary badges/actions; compact two-column More sheets for coach and portal; URL-backed mobile Settings selector; conversation context chips, compact composer and secondary email history; restored primary-action labels and calendar contrast. Touch devices requesting a desktop viewport use appropriate navigation without duplicate sidebars. Existing builders, calendar, resources and record workflows remain.

The campaign editor now uses its intended full-width block layout and live preview. Mobile Actor editing has persistent Edit/Preview controls. Hosted inspection also exposed a Referrals request loop: rebuilt route arrays retriggered its effect on every loading-state render. The read now depends on relevant values and cancels obsolete student-context requests; focused tests verify bounded loads, explicit refresh, failure handling and stale-response isolation.

Verified functional causes and corrections:

- Profile and popup forms did not await persistence. They now retain busy/error/draft state until the actual command completes; failed replacement preserves the previous image.
- `undefined` removal fields disappeared during JSON transport. Explicit null patch values now remove images and optional fields through the existing transactional command.
- Uploaded-file URLs were persisted as identity; deduplicated uploads do not even return a URL. Only stable paths are durable. Reads renew URLs before expiry, and resolved capabilities are excluded from concurrent-edit comparisons.
- Historical studio and Storage policy subqueries bound unqualified `id`/`name` to inner rows. One migration qualifies those outer references, restores intended authorized reads, and permits only the current shared logo/popup references. Private coach images and unrelated objects remain protected. It retires derived logo/photo tokens only where durable paths exist; it does not replace or delete an owner's images.
- Anonymous booking/Actor payloads now omit private coach-photo metadata and never fall back to an expired uploaded-logo URL.
- Page-background color now reaches the actual canvas token; dark appearance retains its own canvas. Configured integrations without working evidence no longer get a green success badge. Failed health loads/refreshes report errors.

Local evidence: focused branding save/failure/format and transport checks; real PostgreSQL 17 replay with Settings concurrency/persistence and positive/negative Storage-role checks; rendered major coach/student routes at 320/390/768/1440, with focused axe checks. Exact counts and screenshots, protected hosted upload/reload/fresh-session/replacement/removal evidence, cleanup, CI and final publication identity will be recorded on the single corrective PR. No hosted completion is claimed at this checkpoint.

Settings coverage is maintained in `wave-five-settings-coverage.md`. External payment, Calendar, OAuth/reconnection and actual delivery are tested only with intercepted/local providers; hosted validation never sends invitations/messages or mutates live schedules/finances. Before publication require protected staging acceptance, exact cleanup, recoverable fresh DB/Storage backup, reviewed migration delta, green required CI, and an inspected Git-built held artifact. Keep production stable if any required gate fails.
