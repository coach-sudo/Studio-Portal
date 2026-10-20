const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** Only fields explicitly changed in this editor are sent; undefined removes a stored field. */
export function settingsPatch(
  base: Record<string, unknown>,
  updates: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (["__proto__", "constructor", "prototype"].includes(key))
      throw new Error("Invalid setting field");
    if (object(value)) {
      const nested = settingsPatch(object(base[key]) ? base[key] : {}, value);
      if (Object.keys(nested).length) patch[key] = nested;
    } else if (JSON.stringify(value) !== JSON.stringify(base[key]))
      patch[key] = value === undefined ? null : value;
  }
  return patch;
}
