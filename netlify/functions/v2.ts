import type { Config, Context } from "@netlify/functions";
import { mapAuditInsert, mapMaterialAccess } from "./_shared/database-mappers";
import { apiError, AppError, correlationId, json } from "./_shared/http";
import { parseCommand } from "./_shared/schemas";
import { serviceClient, userClient } from "./_shared/supabase";
import { handleAdministrationCommands } from "./_v2/administration";
import { handleFinanceCommands } from "./_v2/finance";
import { handleLessonsCommands } from "./_v2/lessons";
import { handleMessagingCommands } from "./_v2/messaging";
import { handleStudentsCommands } from "./_v2/students";
import { handleWorkCommands } from "./_v2/work";
import type { V2CommandContext, V2CommandHandler } from "./_v2/types";
import platformHealth from "./platform-health";
import referrals from "./referrals";

const domains = new Set([
  "students",
  "lessons",
  "notes",
  "materials",
  "messages",
  "offerings",
  "work",
  "finance",
  "packages",
  "credits",
  "discounts",
  "actor-pages",
  "outbox",
  "integrations",
  "recommendations",
  "settings",
  "pricing",
  "health",
  "referrals",
]);

const commandHandlers: V2CommandHandler[] = [
  handleStudentsCommands,
  handleLessonsCommands,
  handleWorkCommands,
  handleMessagingCommands,
  handleFinanceCommands,
  handleAdministrationCommands,
];

export default async (request: Request, context: Context) => {
  const id = correlationId(request, context.requestId);
  try {
    const domain = context.params.domain;
    if (!domains.has(domain))
      throw new AppError("NOT_FOUND", {
        status: 404,
        message: "Unknown API domain.",
      });
    if (domain === "health") return platformHealth(request);
    if (domain === "referrals") return referrals(request);
    if (request.method === "GET")
      return json({
        ok: true,
        domain,
        message: "Reads use Supabase RLS-backed query models.",
        correlationId: id,
      });
    if (request.method !== "POST")
      throw new AppError("METHOD_NOT_ALLOWED", {
        status: 405,
        message: "Method not allowed.",
      });

    const input = parseCommand(domain, await request.json());
    const db = userClient(request);
    const requireCoach = async () => {
      const { data, error } = await db
        .from("memberships")
        .select("studio_id")
        .eq("role", "coach")
        .limit(1)
        .single();
      if (error || !data) throw AppError.forbidden(error);
      return data.studio_id as string;
    };
    const requireMaterialManager = async (materialId: string) => {
      const service = serviceClient();
      const [{ data: material, error: materialError }, { data: authData }] =
        await Promise.all([
          service.from("materials").select("*").eq("id", materialId).single(),
          db.auth.getUser(),
        ]);
      if (materialError || !material || !authData.user)
        throw AppError.forbidden(materialError);
      const mappedMaterial = mapMaterialAccess(material);
      const [{ data: coach }, { data: owner }, { data: guardian }] =
        await Promise.all([
          service
            .from("memberships")
            .select("id")
            .eq("studio_id", material.studio_id)
            .eq("user_id", authData.user.id)
            .eq("role", "coach")
            .maybeSingle(),
          mappedMaterial.ownerStudentId
            ? service
                .from("students")
                .select("id")
                .eq("id", mappedMaterial.ownerStudentId)
                .eq("user_id", authData.user.id)
                .is("deleted_at", null)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          mappedMaterial.ownerStudentId
            ? service
                .from("student_relationships")
                .select("id")
                .eq("student_id", mappedMaterial.ownerStudentId)
                .eq("user_id", authData.user.id)
                .eq("can_manage_profile", true)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);
      if (!coach && !owner && !guardian) throw AppError.forbidden();
      return {
        studioId: mappedMaterial.studioId,
        before: mappedMaterial.row,
        isCoach: Boolean(coach),
      };
    };
    const audit = async (
      studioId: string,
      entityType: string,
      entityId: string,
      action: string,
      beforeState: unknown,
      afterState: unknown,
    ) => {
      const { data, error } = await serviceClient()
        .from("audit_events")
        .insert(
          mapAuditInsert({
            studioId,
            entityType,
            entityId,
            action,
            reason: input.reason,
            correlationId: id,
            beforeState,
            afterState,
          }),
        )
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    };

    const commandContext: V2CommandContext = {
      request,
      context,
      domain,
      id,
      input,
      db,
      requireCoach,
      requireMaterialManager,
      audit,
    };
    for (const handler of commandHandlers) {
      const response = await handler(commandContext);
      if (response) return response;
    }

    if (
      input.command === "transition" &&
      input.entityType &&
      input.entityId &&
      input.nextStatus
    ) {
      const { data, error } = await db.rpc("command_transition", {
        entity_type: input.entityType,
        entity_id: input.entityId,
        expected_version: input.expectedVersion,
        next_status: input.nextStatus,
        reason: input.reason,
        idempotency_key: input.idempotencyKey,
        correlation_id: id,
      });
      if (error) throw error;
      return json(data);
    }
    throw new AppError("UNKNOWN_COMMAND", {
      status: 422,
      message: "Unknown command for this domain.",
    });
  } catch (error) {
    return apiError(error, id);
  }
};

export const config: Config = { path: "/api/v2/:domain" };
