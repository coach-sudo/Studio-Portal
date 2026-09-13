export type VisibleSlotsPercent = 100 | 90 | 75;

export function visibleSlotsPercent(value: unknown): VisibleSlotsPercent {
  return value === 90 || value === 75 ? value : 100;
}

// A slot keeps the same visibility across refreshes, visitors, and booking checks.
export function slotIsVisible(serviceId: string, startsAt: string, percent: VisibleSlotsPercent): boolean {
  if (percent === 100) return true;
  let hash = 2166136261;
  for (const char of `${serviceId}:${startsAt}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100 < percent;
}
