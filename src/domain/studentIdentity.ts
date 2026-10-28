import { z } from "zod";
const common = {
  currentStudentId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
};
export const identityProposalSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("group"),
      duplicateStudentId: z.string().uuid(),
    })
    .strict(),
  z.object({ ...common, action: z.literal("dissolve") }).strict(),
]);
export type IdentityProposal = z.infer<typeof identityProposalSchema>;
const profile = z.object({
  id: z.string().uuid(),
  name: z.string(),
  version: z.number().int(),
});
export const identityPreviewSchema = z.object({
  phase: z.literal("preview"),
  stamp: z.string().regex(/^[0-9a-f]{64}$/),
  proposal: identityProposalSchema,
  blockedReason: z.string().nullable(),
  currentProfile: profile,
  duplicateProfile: profile.nullable(),
  group: z
    .object({
      id: z.string().uuid(),
      version: z.number().int(),
      currentStudentId: z.string().uuid(),
      memberCount: z.number().int(),
    })
    .nullable(),
  profilesDeleted: z.literal(false),
  financialEffects: z.array(z.never()).length(0),
  permissionEffects: z.array(z.never()).length(0),
  providerEffects: z.array(z.never()).length(0),
});
export type IdentityPreview = z.infer<typeof identityPreviewSchema>;
export const identityGroupSchema = z.object({
  group: z
    .object({
      id: z.string().uuid(),
      version: z.number().int(),
      currentStudentId: z.string().uuid(),
    })
    .nullable(),
  members: z.array(
    z.object({
      studentId: z.string().uuid(),
      name: z.string(),
      status: z.string(),
      deletedAt: z.string().nullable(),
      isCurrent: z.boolean(),
    }),
  ),
  total: z.number().int(),
  hasMore: z.boolean(),
  nextAfterStudent: z.string().uuid().nullable(),
  financialAccountsRemainSeparate: z.literal(true),
  permissionsRemainSeparate: z.literal(true),
});
export type IdentityGroup = z.infer<typeof identityGroupSchema>;
export const identityReceiptSchema = z.object({
  resource: z.object({
    groupId: z.string().uuid(),
    version: z.number().int(),
    active: z.boolean(),
    currentStudentId: z.string().uuid(),
    profilesDeleted: z.literal(false),
  }),
  auditEventId: z.string().uuid(),
  queuedSideEffects: z.array(z.never()).length(0),
});
export function identityHold(reason: string) {
  const holds: Record<string, string> = {
    select_designated_current_profile:
      "Select the group's current profile before changing its links.",
    already_grouped:
      "These profiles are already linked. Open either original record to view related profiles.",
    existing_group_requires_review:
      "The duplicate belongs to another group. Review that group's links first.",
    different_authenticated_users:
      "These profiles have different signed-in accounts. Keep them separate until their ownership is reviewed.",
    different_provider_customers:
      "These profiles have different payment-provider identities. Keep them separate for financial review.",
    different_guardian_identities:
      "These profiles have different guardian identities. Review their ownership before linking.",
    different_payer_identities:
      "These profiles have different payers. Review their ownership before linking.",
    group_identity_requires_review:
      "A related profile has a different account, guardian, payer or provider identity. Review the existing group first.",
    no_active_group: "This profile has no active links to undo.",
  };
  return (
    holds[reason] ??
    "This identity change requires coach review before it can be saved."
  );
}
