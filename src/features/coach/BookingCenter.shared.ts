import type { Booking, StudioSnapshot } from "../../domain/model";

export type Tab =
  | "overview"
  | "setup"
  | "calendar"
  | "services"
  | "availability"
  | "classes"
  | "series";
export const tabs: readonly [Tab, string][] = [
  ["calendar", "Calendar"],
  ["overview", "Overview"],
  ["setup", "Booking setup"],
  ["services", "Services"],
  ["availability", "Availability"],
  ["classes", "Classes"],
  ["series", "Recurring"],
];
export const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export const serviceName = (data: StudioSnapshot, id: string) =>
  data.bookingServices.find((item) => item.id === id)?.name ?? "Booking";
export const bookingTone = (status: Booking["status"]) =>
  status === "confirmed" || status === "completed"
    ? "good"
    : status === "needs_attention" || status === "late_cancelled"
      ? "warn"
      : status === "cancelled" || status === "expired"
        ? "danger"
        : "neutral";
