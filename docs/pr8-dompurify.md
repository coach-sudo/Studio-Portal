# PR8 DOMPurify patch verification

PR8 is stacked on the accepted PR7 head `e747fb71675e152a938c58bac263e9c084ba43bb`. It changes no product code, sanitizer configuration, API contract, migration, or production setting.

## Before the update

- Installed and locked DOMPurify: `3.4.14`; direct dependency specifier: `^3.4.14`.
- Production dependency audit: `npm audit --omit=dev --audit-level=high` found 0 vulnerabilities.
- Source imports/usages: `src/features/student/StudentPortalLessonHub.tsx` (two note render sites), `src/features/coach/StudentWorkspaceLessons.tsx` (note render), `src/features/coach/StudentWorkspace.tsx` (editor load and note-save sanitization), `src/features/coach/StudentWorkspaceNotes.tsx` (note render), and `src/features/coach/StudioNotes.tsx` (studio note render).

## After the update

- Direct dependency and lockfile resolve **exactly `3.4.15`**. The exact specifier prevents npm from selecting a later patch in this deliberately narrow release.
- `package-lock.json` changes only its root DOMPurify specifier and `node_modules/dompurify` version, tarball URL, and integrity hash. No other direct or transitive dependency version changes.
- `src/security/dompurify.test.ts` covers script, event-handler, and JavaScript-URL payloads and preservation of safe note formatting. No sanitizer call site or configuration changed.
- Local verification: 291/291 Vitest tests passed with `--maxWorkers=2`; TypeScript, ESLint (0 errors), Prettier, production build, bundle budget, secret scan, and production audit passed. The unthrottled local Vitest run produced timeouts in unrelated lazy-loaded UI tests; the two-worker rerun passed. Standard CI runs the normal unmodified test command.

| Asset               | PR7 gzip bytes | PR8 gzip bytes | Change |
| ------------------- | -------------: | -------------: | -----: |
| Entry JS            |        115,654 |        115,660 |     +6 |
| Global CSS          |         21,402 |         21,402 |      0 |
| StudentWorkspace JS |          8,412 |          8,411 |     -1 |
| StudentPortal JS    |          5,029 |          5,029 |      0 |
| StudioOperations JS |         16,629 |         16,635 |     +6 |
| BookingCenter JS    |         12,777 |         12,780 |     +3 |
| CoachSection JS     |         11,867 |         11,871 |     +4 |
| PublicBooking JS    |         11,338 |         11,340 |     +2 |
| DOMPurify JS        |         10,610 |         10,655 |    +45 |

The workflow trigger changes in this PR only admit a branch stacked on PR7 to the existing required verification and free ephemeral deployed-browser jobs. They do not change the jobs' checks or hosted environments.

Rollback: revert this PR's `package.json` and `package-lock.json` DOMPurify entries to PR7 and run `npm ci`; the source-level regression fixture may be retained independently.
