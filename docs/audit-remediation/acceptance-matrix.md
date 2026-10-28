# Exact audit acceptance inventory

Required tasks, source traces and every missing downstream proof are preserved verbatim as text in [acceptance-matrix.json](acceptance-matrix.json). No entry has a full end-to-end pass.

| ID  | Workflow                                        | Status                                                                   |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------ |
| A01 | Public lead / first booking → studio student    | partially verified (audit source/fixtures); hosted acceptance unverified |
| A02 | Coach creates student                           | partially verified (audit source/fixtures); hosted acceptance unverified |
| A03 | Student account activation / sign-in / recovery | partially verified (audit source/fixtures); hosted acceptance unverified |
| A04 | Guardian and household linking                  | partially verified (audit source/fixtures); hosted acceptance unverified |
| A05 | Student status lifecycle                        | partially verified (audit source/fixtures); hosted acceptance unverified |
| B01 | Public self-service booking                     | partially verified (audit source/fixtures); hosted acceptance unverified |
| B02 | Student/guardian self-service booking           | partially verified (audit source/fixtures); hosted acceptance unverified |
| B03 | Coach booking (single)                          | partially verified (audit source/fixtures); hosted acceptance unverified |
| B04 | Coach historical lesson record                  | partially verified (audit source/fixtures); hosted acceptance unverified |
| B05 | Calendar click, drag, resize                    | partially verified (audit source/fixtures); hosted acceptance unverified |
| B06 | Recurring bookings/series                       | partially verified (audit source/fixtures); hosted acceptance unverified |
| B07 | Class/group enrollment                          | partially verified (audit source/fixtures); hosted acceptance unverified |
| B08 | Reschedule                                      | partially verified (audit source/fixtures); hosted acceptance unverified |
| B09 | Cancellation/late cancellation/excused          | partially verified (audit source/fixtures); hosted acceptance unverified |
| B10 | Lesson completion/verification                  | partially verified (audit source/fixtures); hosted acceptance unverified |
| B11 | Bulk lesson management                          | partially verified (audit source/fixtures); hosted acceptance unverified |
| C01 | Google Calendar connection                      | partially verified (audit source/fixtures); hosted acceptance unverified |
| C02 | Routine Calendar intake                         | partially verified (audit source/fixtures); hosted acceptance unverified |
| C03 | Historical Calendar reconciliation              | partially verified (audit source/fixtures); hosted acceptance unverified |
| C04 | Gmail / other provider discovery                | partially verified (audit source/fixtures); hosted acceptance unverified |
| C05 | Managed Calendar projection                     | partially verified (audit source/fixtures); hosted acceptance unverified |
| C06 | Review and verification queue                   | partially verified (audit source/fixtures); hosted acceptance unverified |
| C07 | Provider conflict resolution                    | partially verified (audit source/fixtures); hosted acceptance unverified |
| D01 | Pay-as-you-go lesson                            | partially verified (audit source/fixtures); hosted acceptance unverified |
| D02 | Package purchase and grant                      | partially verified (audit source/fixtures); hosted acceptance unverified |
| D03 | Credit reservation and usage                    | partially verified (audit source/fixtures); hosted acceptance unverified |
| D04 | Credit corrections, transfers and expiry        | partially verified (audit source/fixtures); hosted acceptance unverified |
| D05 | Invoices and payments                           | partially verified (audit source/fixtures); hosted acceptance unverified |
| D06 | Reconciliation and reporting                    | partially verified (audit source/fixtures); hosted acceptance unverified |
| E01 | Lesson preparation and readiness                | partially verified (audit source/fixtures); hosted acceptance unverified |
| E02 | Notes drafting, publishing and corrections      | partially verified (audit source/fixtures); hosted acceptance unverified |
| E03 | Library/resource reuse                          | partially verified (audit source/fixtures); hosted acceptance unverified |
| E04 | Assignments and student work                    | partially verified (audit source/fixtures); hosted acceptance unverified |
| E05 | Inbox and conversation                          | partially verified (audit source/fixtures); hosted acceptance unverified |
| E06 | Campaigns and automated reminders               | partially verified (audit source/fixtures); hosted acceptance unverified |
| F01 | Actor page lifecycle                            | partially verified (audit source/fixtures); hosted acceptance unverified |
| F02 | Referrals, gifts and redemption                 | partially verified (audit source/fixtures); hosted acceptance unverified |
| F03 | Coach dashboard/Today                           | partially verified (audit source/fixtures); hosted acceptance unverified |
| F04 | Studio Settings and connections                 | partially verified (audit source/fixtures); hosted acceptance unverified |
| F05 | Scheduled maintenance and outbox                | partially verified (audit source/fixtures); hosted acceptance unverified |
| F06 | Search, navigation, responsive interaction      | partially verified (audit source/fixtures); hosted acceptance unverified |
| F07 | Security, backups and recovery                  | partially verified (audit source/fixtures); hosted acceptance unverified |

| ID  | Connection                               | Success    | Failure / recovery |
| --- | ---------------------------------------- | ---------- | ------------------ |
| X01 | Booking → lesson/participant             | unverified | unverified         |
| X02 | Lesson → Calendar/Meet                   | unverified | unverified         |
| X03 | Calendar intake → existing lesson        | unverified | unverified         |
| X04 | Gmail/provider → student/household       | unverified | unverified         |
| X05 | Imported occurrence → finance            | unverified | unverified         |
| X06 | Reschedule → credit/invoice/checkout     | unverified | unverified         |
| X07 | Cancellation → returned credit/cash      | unverified | unverified         |
| X08 | Completion → credits/notes/activity      | unverified | unverified         |
| X09 | Payment → settlement → grant             | unverified | unverified         |
| X10 | Account ↔ coach records                  | unverified | unverified         |
| X11 | Lesson → published teaching work         | unverified | unverified         |
| X12 | Lesson activity → actor eligibility      | unverified | unverified         |
| X13 | Settings → public policy/coach overrides | unverified | unverified         |
| X14 | Outbox/campaign → provider/inbox         | unverified | unverified         |
| X15 | Bulk operation → dependent records       | unverified | unverified         |
| X16 | Dashboard/search → record/back           | unverified | unverified         |
| X17 | Asset → many authorized links            | unverified | unverified         |
| X18 | Ignored/reviewed → rescan                | unverified | unverified         |
| X19 | Scheduler accepted → completed           | unverified | unverified         |
| X20 | Recovery/migration → preserved history   | unverified | unverified         |
