import type { Context } from "@netlify/functions";
import type { Tables } from "../../../src/types/database.generated";
import type { CommandInput } from "../_shared/schemas";
import type { userClient } from "../_shared/supabase";

export interface MaterialManagerAccess {
  studioId: string;
  before: Tables<"materials">;
  isCoach: boolean;
}

export interface V2CommandContext {
  request: Request;
  context: Context;
  domain: string;
  id: string;
  input: CommandInput;
  db: ReturnType<typeof userClient>;
  requireCoach: () => Promise<string>;
  requireMaterialManager: (
    materialId: string,
  ) => Promise<MaterialManagerAccess>;
  audit: (
    studioId: string,
    entityType: string,
    entityId: string,
    action: string,
    beforeState: unknown,
    afterState: unknown,
  ) => Promise<string>;
}

export type V2CommandHandler = (
  context: V2CommandContext,
) => Promise<Response | null>;
