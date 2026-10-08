# Studio Library implementation

Baseline: main `81610b510774`. No production writes, file deletion, migration application, merge, or deployment are authorized for this task.

## Repository findings

- `materials` already stores canonical metadata and a storage path or external URL; `material_links` already relates materials to students/lessons. Extend both instead of introducing parallel resource tables.
- Current creation always creates a student-owned resource and one link. Assignment reuse has no interface. The library view selects the first link, so it cannot represent multiple assignments correctly.
- Current/Vault status currently lives on the canonical material. New assignment state belongs on `material_links`; legacy states must be backfilled unchanged.
- `file_assets` records private Supabase bucket objects. Uploads use random paths and perform no content comparison; repeated uploads create physical objects. Existing files are not evidence of duplication until hashes are verified.
- Student snapshot loading fetches all RLS-visible material rows and links; the coach material page pages only when the query-layer flag is enabled. Neither is suitable for a growing catalog.
- Downloads use RLS-backed signed URLs. Existing path ownership must remain supported; assigned/shared resources need an additional authorization path, never a public bucket.
- Existing dialog/drawer focus handling, React Query cancellation/cache keys, student-work permissions, and rich note sanitization are reusable.
- Shared textarea defaults and some inline editor heights are small. Improve shared writing surfaces and specific long-form fields while retaining single-line names/searches and existing save/draft behavior.

## Implementation sequence

1. Extend canonical materials, assignment links, file assets, and secure policies non-destructively. Add centrally managed multi-value metadata and transactional resource/assignment operations. Preserve existing record IDs, paths, lesson relationships, actor media, and visibility.
2. Add a bounded RLS-backed catalog/materials search API with indexed search, OR within filter groups and AND across them, deterministic pagination, and separate full-content retrieval.
3. Reuse one searchable resource browser/editor for Studio Library, student materials, student workspace, and lesson/note attachments. Default student-context creation to private; promotion is explicit and coach-only.
4. Add scope-safe SHA-256 duplicate detection for future uploads, assignment-local Current/Vault/pin controls, and editable metadata management. No assignment uploads or copies a file.
5. Improve long-form fields centrally, with expanded note/template surfaces, automatic textarea growth, manual resizing, and responsive verification.
6. Add collection snapshots if the core workflows are complete, then validate migration/RLS/search, interaction and storage boundaries, and regressions. Existing physical duplicate consolidation requires an inspected manifest and remains non-destructive.

## Validation

Run database-compatible migration/permission tests, bounded/debounced query tests, resource reuse and assignment isolation tests, complete text retrieval, metadata relationship tests, type checking, lint/format/build/bundle checks, and representative desktop/tablet/mobile browser reviews. Local Docker is unavailable; report the local isolated Supabase limitation and use the PR's isolated CI stack rather than touch production.

Current database guidance checked against [Supabase full-text search](https://supabase.com/docs/guides/database/full-text-search) and [private storage authorization](https://supabase.com/docs/guides/storage/security/access-control). Newly exposed tables require explicit grants as well as RLS.
