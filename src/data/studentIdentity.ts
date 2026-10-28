import { studioCommand } from "./bookingCommands";
import {
  identityGroupSchema,
  identityPreviewSchema,
  identityProposalSchema,
  identityReceiptSchema,
  type IdentityProposal,
} from "../domain/studentIdentity";
export async function previewStudentIdentity(proposal: IdentityProposal) {
  const value = identityProposalSchema.parse(proposal);
  const result = await studioCommand("students", {
    command: "preview_identity_change",
    expectedVersion: 0,
    reason: value.reason,
    payload: { proposal: value },
  });
  return identityPreviewSchema.parse(result.resource);
}
export async function saveStudentIdentity(
  proposal: IdentityProposal,
  stamp: string,
  key: string,
) {
  const result = await studioCommand("students", {
    command: "identity_change",
    expectedVersion: 0,
    idempotencyKey: key,
    reason: proposal.reason,
    payload: { proposal, stamp },
  });
  return identityReceiptSchema.parse(result);
}
export async function loadStudentIdentity(
  studentId: string,
  afterStudent?: string,
) {
  const result = await studioCommand("students", {
    command: "identity_group",
    expectedVersion: 0,
    reason: "Coach viewed original related profiles",
    payload: { studentId, ...(afterStudent ? { afterStudent } : {}) },
  });
  return identityGroupSchema.parse(result.resource);
}
