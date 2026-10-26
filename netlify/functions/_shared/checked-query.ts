/** PostgREST normally resolves errors. Workers must not acknowledge lost writes. */
export async function checkedQuery<T extends { error: unknown }>(
  query: PromiseLike<T>,
): Promise<T> {
  const result = await query;
  if (result.error) throw result.error;
  return result;
}

/** Keep the worker lease until every already-started operation has settled. */
export async function checkedAll<T extends readonly unknown[]>(
  values: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results = await Promise.allSettled(values);
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
  return results.map(
    (result) => (result as PromiseFulfilledResult<unknown>).value,
  ) as { -readonly [K in keyof T]: Awaited<T[K]> };
}
