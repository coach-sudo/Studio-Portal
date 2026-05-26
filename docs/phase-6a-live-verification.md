# Phase 6A Live Verification

This checklist verifies the student portal locally and against the live Netlify deployment.

## Command

```powershell
node tests/phase-6a-student-portal-verification.js
```

The default command runs:

- local missing-secret and invalid-code checks
- local student and guardian login checks with sample data
- local scoped record visibility checks
- local mutation checks against an in-memory Apps Script backend
- script permission hardening checks
- public live smoke checks for `https://studio-portal.netlify.app`

## Live Authenticated Checks

Live authenticated checks are opt-in so test credentials are never committed.

```powershell
$env:PHASE6A_LIVE_STUDENT_EMAIL = "student-or-guardian@example.com"
$env:PHASE6A_LIVE_ACCESS_CODE = "temporary-access-code"
node tests/phase-6a-student-portal-verification.js
```

Live write checks are separately gated. Only enable them with a designated reversible test student.

```powershell
$env:PHASE6A_ENABLE_LIVE_WRITES = "true"
$env:PHASE6A_LIVE_HOMEWORK_ID = "HW-2026-000001"
node tests/phase-6a-student-portal-verification.js
```

## Current Results

- Local auth/session/scoping: automated.
- Local mutations: automated with an in-memory snapshot backend.
- Script permission hardening: automated.
- Live public smoke:
  - `/api/studio-sync?action=ping` must return `ok: true`.
  - unauthenticated `/api/student-auth?action=session` must return `401`.
  - unauthenticated `/api/student-auth?action=portal_data` must return `401`.
- Live authenticated writes: pending test credentials and explicit `PHASE6A_ENABLE_LIVE_WRITES=true`.

## Guardrails

- Do not commit student portal access codes or live student emails used for testing.
- Use a test student/contact for live writes.
- Keep student portal auth separate from public profile routing.
- Keep finance review, material review, and public-page approval coach-side.
