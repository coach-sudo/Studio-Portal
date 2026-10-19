# Wave 3 — Materials and Library 2.0

Base: published `231bbc6d89d2defba84ca006fc5220f29a8f918b` (60 migrations).

The existing canonical Library, Storage files, assignments, custom metadata and collections remain authoritative. Resource links open an in-portal workspace with validated student/assignment context. PDFs use lazy PDF.js 6.4.299; text, images, audio/video and approved provider links use safe viewers. HTML/SVG uploads receive an original-file fallback, never inline execution. Signed URLs remain in memory, are reauthorized/refreshed and are cleared with viewer identity.

One additive migration adds shared learner instructions, owner-only progress/bookmarks/notes and content identities. Metadata edits preserve anchors; content changes separate old annotations. Notes save explicitly; reading/playback position saves automatically. Coach/guardian/peer/service listing is denied. Existing student merging preserves original annotation ownership and cannot transfer personal notes to a different login.

Library search remains bounded (25 per client page; 50 server maximum), with expandable classifications and collection filtering. Add material combines choosing an existing canonical resource and adding a new file/text/link, with optional immediate assignment and deliberate Library sharing. Existing scripts use the same resource viewer; collections, pinning, vaulting and actor media remain in place.

## Focused verification

- Existing Library integration plus new privacy/content/version checks: passing.
- Native PostgreSQL 17: 28 assertions including authorized guardians, peers, service grants, disabled portal, revoked access, content replacement and merge preservation.
- Separate PostgreSQL sessions: duplicate creation and stale concurrent edits pass.
- Chromium/WebKit: PDF rendering/search/zoom, expired URL recovery, explicit notes/bookmarks, resume, text/image/fallback, keyboard and 320/390/768/1440 layouts; zero serious/critical axe findings in the PDF workspace.
- Chromium: actual audio/video decoding and playback recovery. Windows WebKit's native media bypasses the local HTTP mock; real signed-file playback remains a protected-staging gate.
- Ordinary bundle budgets retained (130 KB JS / 25 KB CSS gzip); separate lazy PDF caps 250 KB renderer / 500 KB worker. Initial build: renderer 128,442 bytes gzip; worker 376,488 bytes gzip.

Protected staging acceptance, exact migration/type verification, current production recovery coverage and controlled publication remain required. No production Wave 3 migration or publication has occurred. No Wave 4 work is included. Prior Wave 1/2 evidence is retained; unrelated browser/financial suites are not manually repeated.
