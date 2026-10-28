// The preview, decision stamp and routine worker must hash the same source
// instant, regardless of the provider's equivalent offset or fractional syntax.
export const calendarDay = (value?: string | null) =>
  value &&
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
  new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value
    ? value
    : null;
export const calendarInstant = (value?: string | null) =>
  value &&
  calendarDay(value.slice(0, 10)) &&
  /(Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
