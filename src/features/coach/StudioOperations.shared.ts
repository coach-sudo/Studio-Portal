import type { StudioSnapshot } from "../../domain/model";

export const studentName = (data: StudioSnapshot, id: string) =>
  data.students.find((item) => item.id === id)?.fullName || "Student";
export const sourceLabel = (source?: string) =>
  (
    ({
      studio: "Studio",
      public_booking: "Direct booking",
      google_calendar: "Google Calendar",
      gmail: "Gmail",
      lessonface: "Lessonface",
      wyzant: "Wyzant",
      lessons_com: "Lessons.com",
      acuity: "Acuity",
    }) as Record<string, string>
  )[source || "studio"] ||
  source ||
  "Studio";
