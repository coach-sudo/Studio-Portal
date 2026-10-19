# Wave 3 — Materials and Library 2.0

Base: published `231bbc6d89d2defba84ca006fc5220f29a8f918b` (60 migrations).

The existing canonical Library, Storage files, assignments, custom metadata and collections remain authoritative. Resource links open an in-portal workspace with validated student/assignment context. PDFs use lazy PDF.js 6.4.299; text, images, audio/video and approved provider links use safe viewers. HTML/SVG uploads receive an original-file fallback, never inline execution. Signed URLs remain in memory, are reauthorized/refreshed and are cleared with viewer identity.

One additive migration adds shared learner instructions, owner-only progress/bookmarks/notes and content identities. Metadata edits preserve anchors; content changes separate old annotations. Notes save explicitly; reading/playback position saves automatically. Coach/guardian/peer/service listing is denied. Existing student merging preserves original annotation ownership and cannot transfer personal notes to a different login.

Library search remains bounded (25 per client page; 50 server maximum), with expandable classifications and collection filtering. Add material combines choosing an existing canonical resource and adding a new file/text/link, with optional immediate assignment and deliberate Library sharing. Existing scripts use the same resource viewer; collections, pinning, vaulting and actor media remain in place.

## Focused verification

- Existing Library integration plus new privacy/content/version checks: passing.
- Native PostgreSQL 17: 30 assertions including authorized guardians, peers, service grants, disabled portal, revoked access, content replacement and merge preservation.
- Separate PostgreSQL sessions: duplicate creation and stale concurrent edits pass.
- Chromium/WebKit: PDF rendering/search/zoom, expired URL recovery, explicit notes/bookmarks, resume, text/image/fallback, keyboard and 320/390/768/1440 layouts; zero serious/critical axe findings in the PDF workspace.
- Chromium: actual audio/video decoding and playback recovery. Windows WebKit's native media bypasses the local HTTP mock; real signed-file playback remains a protected-staging gate.
- Ordinary bundle budgets retained (130 KB JS / 25 KB CSS gzip); separate lazy PDF caps 250 KB renderer / 500 KB worker. Initial build: renderer 128,442 bytes gzip; worker 376,488 bytes gzip.

## Protected staging checkpoint — October 19, 2026

PR [#60](https://github.com/coach-sudo/Studio-Portal/pull/60), application candidate `1d1184920222f07ded3f60d62cca4146358c998e`. Required CI [39298995566](https://github.com/coach-sudo/Studio-Portal/actions/runs/39298995566) passed, including migration replay, database tests, concurrency, generated types, lint, formatting, unit tests and build/bundle checks. The final focused Chromium/WebKit checks also verify stable text resume, first-page PDF note anchors and a keyboard-accessible zoomed page viewport.

Staging project `lrxrivfqjpkvygozphoz` has 61 migrations. The single additive migration preserved the prior 60 history rows and all 104 pre-existing application tables. Study tables were empty after application; owner RLS and denial of anonymous/service listing were verified.

Protected draft `6ad65b1f62032de1d401f19d` is ready in `deploy-preview`, unpublished, with 23 Linux Node 22 functions and 125 client assets. Function digests and independent client artifacts match; native Sharp rendering and invoice-function import passed. Anonymous `/` and `/api/healthz` return 401. Team login protects all deployments, automatic builds remain stopped, preview environment configuration is unchanged and the prior staging publication is intact. The earlier unused draft is retained privately.

Protected health passed and staging Auth now contains only this exact host and its two reviewed callback patterns. The same bounded synthetic acceptance cycle is in progress; canonical creation, multi-level metadata, immediate assignment, reuse without another upload and collection filtering passed.

Hosted acceptance exposed a bundler defect: the PDF group captured Vite's shared preload helper and therefore loaded on ordinary routes. The narrow packaging correction disables recursive dependency capture for that group. The bundle gate now rejects static renderer imports outside `PdfReader`; the corrected build passes at 127,938 bytes renderer / 376,488 bytes worker gzip. Remaining hosted viewer/privacy checks and exact fixture cleanup are still release gates; no second fixture cycle is needed.

Production remains at Waves 1/2: application `231bbc6d89d2defba84ca006fc5220f29a8f918b`, deployment `6ad646eeb54a92db1b8db663`, 60 migrations. Production backup freshness, protected hosted acceptance and controlled publication are still required. No production Wave 3 migration, merge or publication has occurred. No Wave 4 work is included. Prior Wave 1/2 evidence is retained; unrelated browser/financial suites are not manually repeated.
