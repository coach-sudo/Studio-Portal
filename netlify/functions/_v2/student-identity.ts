import { z } from "zod";
import { identityProposalSchema as proposal } from "../../../src/domain/studentIdentity";
import { json } from "../_shared/http";
import type { V2CommandContext } from "./types";

export async function handleStudentIdentity(
  ctx: V2CommandContext,
): Promise<Response | null> {
  if (
    ctx.domain !== "students" ||
    ![
      "merge",
      "preview_identity_change",
      "identity_change",
      "identity_group",
    ].includes(ctx.input.command)
  )
    return null;
  await ctx.requireCoach();
  if (ctx.input.command === "merge")
    throw new Error(
      "REVIEW_REQUIRED: Use the identity-preserving duplicate profile preview. Existing records and permissions have not moved.",
    );
  if (ctx.input.command === "identity_group") {
    const value = z
      .object({
        studentId: z.string().uuid(),
        afterStudent: z.string().uuid().optional(),
      })
      .strict()
      .parse(ctx.input.payload);
    const result = await ctx.db.rpc("student_identity_group", {
      p_student: value.studentId,
      p_after_student: value.afterStudent,
    });
    if (result.error) throw result.error;
    return json({ resource: result.data });
  }
  if (ctx.input.command === "preview_identity_change") {
    const value = z.object({ proposal }).strict().parse(ctx.input.payload);
    const result = await ctx.db.rpc("preview_student_identity_change", {
      p_value: value.proposal,
    });
    if (result.error) throw result.error;
    return json({ resource: result.data, processing: "preview" });
  }
  const value = z
    .object({ proposal, stamp: z.string().regex(/^[0-9a-f]{64}$/) })
    .strict()
    .parse(ctx.input.payload);
  const result = await ctx.db.rpc("command_student_identity_change", {
    p_value: value.proposal,
    p_stamp: value.stamp,
    p_key: ctx.input.idempotencyKey,
  });
  if (result.error) throw result.error;
  return json(result.data);
}
