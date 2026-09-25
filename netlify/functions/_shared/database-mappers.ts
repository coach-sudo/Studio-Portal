import type {
  Json,
  Tables,
  TablesInsert,
} from "../../../src/types/database.generated";

export function toDatabaseJson(value: unknown): Json {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as Json;
}

export function mapAuditInsert(input: {
  studioId: string;
  entityType: string;
  entityId: string;
  action: string;
  reason: string;
  correlationId: string;
  beforeState: unknown;
  afterState: unknown;
}): TablesInsert<"audit_events"> {
  return {
    studio_id: input.studioId,
    entity_type: input.entityType,
    entity_id: input.entityId,
    action: input.action,
    reason: input.reason,
    correlation_id: input.correlationId,
    source: "studio_command",
    before_state: toDatabaseJson(input.beforeState),
    after_state: toDatabaseJson(input.afterState),
  };
}

export function mapMaterialAccess(row: Tables<"materials">) {
  return {
    row,
    studioId: row.studio_id,
    ownerStudentId: row.owner_student_id,
  };
}
