# Provider review and original student identities

Scope recorded before implementation on October 29. This focused draft depends on #88/#87 and reuses their approved identity-preserving policy. It addresses the remaining provider-review `mergeStudentId` path, not historical Calendar reconciliation or attendance policy. #74 remains a separate required dependency for attendance separation in a release candidate.

Affected connections: provider import → existing lesson; student → guardian → role permissions; booking → credits → payment. Preserve all 42 workflows and 20 original acceptance connections in the central register; no whole-workflow PASS is inferred from individual checks.

The current Today dialog promises to transfer lessons, payments and portal access when selecting another student. That promise contradicts the approved policy. Remove the physical-merge control, explain original record ownership, and provide navigation to the original profile and separate duplicate-profile review. An already linked lesson must keep its original student. Unlinked signals retain explicit student selection. The API must authenticate the coach before rejecting legacy merge payloads; do not silently discard the legacy instruction or substitute a fragmented grouping command.

Regression requirements: no merge field or grouping command from the UI; existing linked identity protection; exact retry key retention; API authorization and no database calls on legacy payloads; actual PostgreSQL rollback of a direct legacy provider-review request, including student creation before the hold, source state, receipts and historical/financial records. Browser fixture evidence must remain distinct from database and hosted-provider acceptance.

Rollback: no new schema or data migration. Retain #87's database hold and identity history. Reverting this UI alone restores an obsolete control which will still be held by the API/database; reverting the hold to restore physical merging is not an acceptable rollback. Production worker controls, provider calls and publication are untouched.

Validation results and exact implementation references will be recorded after execution. Combined attendance/source-protection branches, hosted roles, providers and manual assistive acceptance remain release gates.
