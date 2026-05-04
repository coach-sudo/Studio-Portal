# Phase 6A Student Portal Readiness

The coach portal foundation is now in place to begin the student portal.

## Ready now

- Student records support:
  - student contacts
  - guardian / parent contacts
  - multiple emails and phones
  - preferred contact logic
- Lesson records support:
  - scheduled, completed, cancelled, late cancel, and no-show states
  - import review and external-change confirmation
  - linked student matching
- Finance supports:
  - packages
  - reservations against packages
  - outstanding balance tracking
  - payment records and review states
- Materials supports:
  - student materials
  - actor materials
  - links and uploads
  - vault handling on the coach side
- Google intake supports:
  - manual Calendar sync
  - manual Gmail sync
  - review-first trust model

## Phase 6A should focus on

- Student / guardian authentication
- Student-facing permissions and visibility rules
- Student dashboard and lesson history
- Student package / payment view
- Student materials / homework / notes access rules
- Secure messaging / contact actions if needed

## Phase 6A started

Added a server-backed student portal route with:

- Netlify Function auth at `/api/student-auth`
- signed HttpOnly student / guardian session cookies
- matched contact email plus server-side access code verification
- server-scoped data for student-owned records
- student-visible filtering for published notes, homework, materials, lessons, packages, and reviewed payments
- a first student-facing dashboard mounted at `Student Portal`

Before production use, set `STUDENT_PORTAL_SESSION_SECRET` and `STUDENT_PORTAL_ACCESS_CODE` in Netlify. The current implementation uses a shared access code plus matched contact email; a later upgrade can replace that with per-user passwords, magic links, or Netlify Identity.

## Important guardrails

- The student portal should only expose scoped records for the signed-in student or approved guardian.
- Coach-only intake, sync review, duplicate handling, and finance review tools should remain coach-side.
- Public-page logic and student-portal logic should stay separate.
