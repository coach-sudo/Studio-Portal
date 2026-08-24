const requiredTextFields = new Set(["goals", "privateNotes", "timezone"]);

export function mapStudentChanges(
  payload: Record<string, unknown>,
  allowed: string[],
  columns: Record<string, string>,
) {
  const changes: Record<string, unknown> = {};
  for (const key of allowed) {
    if (!(key in payload)) continue;
    const value = payload[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      changes[columns[key]] = requiredTextFields.has(key) ? trimmed : trimmed || null;
    } else {
      changes[columns[key]] = value ?? null;
    }
  }
  return changes;
}
