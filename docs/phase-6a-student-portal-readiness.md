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

Added a front-end student portal preview route with:

- local student / guardian sign-in using matched contact email plus a shared preview access code
- centralized scoped-data helpers for student-owned records
- student-visible filtering for published notes, homework, materials, lessons, packages, and reviewed payments
- a first student-facing dashboard mounted at `Student Portal`

This is a preview/auth scaffold. Before production use, replace the local shared-code session with server-side authentication and signed student/guardian claims.

## Important guardrails

- The student portal should only expose scoped records for the signed-in student or approved guardian.
- Coach-only intake, sync review, duplicate handling, and finance review tools should remain coach-side.
- Public-page logic and student-portal logic should stay separate.
