import type { AvailabilityException, AvailabilityRule, Booking, BookingService, Lesson, RecurrenceCadence, StudioSnapshot } from "./model";

export interface AvailabilitySlot { startsAt: string; endsAt: string; label: string }

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && aEnd > bStart;
const localParts = (value: string) => { const [hour, minute] = value.split(":").map(Number); return { hour, minute }; };

type WallTime = { year: number; month: number; day: number; hour: number; minute: number };
const wallParts = (date: Date, timeZone: string): WallTime => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute") };
};

const zoneOffset = (timestamp: number, timeZone: string) => {
  const parts = wallParts(new Date(timestamp), timeZone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - Math.floor(timestamp / 60_000) * 60_000;
};

export function zonedDateTimeToUtc(value: WallTime, timeZone: string): Date {
  const wallUtc = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute);
  let result = wallUtc - zoneOffset(wallUtc, timeZone);
  result = wallUtc - zoneOffset(result, timeZone);
  return new Date(result);
}

export function buildAvailability(input: { service: BookingService; rules: AvailabilityRule[]; exceptions: AvailabilityException[]; lessons: Lesson[]; from: Date; days?: number; now?: Date }): AvailabilitySlot[] {
  const { service, rules, exceptions, lessons, from } = input;
  const now = input.now ?? new Date();
  const days = Math.min(input.days ?? 14, service.bookingHorizonDays);
  const earliest = now.getTime() + service.minimumNoticeHours * 3_600_000;
  const slots: AvailabilitySlot[] = [];
  const studioZone = rules.find((rule) => rule.active)?.timezone ?? "America/New_York";
  const firstDay = wallParts(from, studioZone);
  for (let offset = 0; offset < days; offset += 1) {
    const calendarDay = new Date(Date.UTC(firstDay.year, firstDay.month - 1, firstDay.day + offset));
    const matching = rules.filter((rule) => rule.active && rule.weekday === calendarDay.getUTCDay() && (!rule.serviceId || rule.serviceId === service.id));
    for (const rule of matching) {
      const startParts = localParts(rule.startsAtLocal), endParts = localParts(rule.endsAtLocal);
      const dateParts = { year: calendarDay.getUTCFullYear(), month: calendarDay.getUTCMonth() + 1, day: calendarDay.getUTCDate() };
      const windowStart = zonedDateTimeToUtc({ ...dateParts, ...startParts }, rule.timezone);
      const windowEnd = zonedDateTimeToUtc({ ...dateParts, ...endParts }, rule.timezone);
      for (let cursor = windowStart.getTime(); cursor + service.durationMinutes * 60_000 <= windowEnd.getTime(); cursor += service.slotIntervalMinutes * 60_000) {
        const end = cursor + service.durationMinutes * 60_000;
        const bufferedStart = cursor - service.bufferBeforeMinutes * 60_000;
        const bufferedEnd = end + service.bufferAfterMinutes * 60_000;
        const blockedByLesson = lessons.some((lesson) => lesson.status === "scheduled" && overlaps(bufferedStart, bufferedEnd, new Date(lesson.startsAt).getTime(), new Date(lesson.endsAt).getTime()));
        const blockedByException = exceptions.some((exception) => exception.kind === "unavailable" && (!exception.serviceId || exception.serviceId === service.id) && overlaps(cursor,end,new Date(exception.startsAt).getTime(),new Date(exception.endsAt).getTime()));
        if (cursor >= earliest && !blockedByLesson && !blockedByException) slots.push({ startsAt:new Date(cursor).toISOString(), endsAt:new Date(end).toISOString(), label:new Intl.DateTimeFormat([], { timeZone: rule.timezone, hour:"numeric",minute:"2-digit" }).format(new Date(cursor)) });
      }
    }
  }
  return slots;
}

export const remainingCapacity = (capacity: number, enrolled: number, activeHolds = 0) => Math.max(0, capacity - enrolled - activeHolds);
export const isLateChange = (startsAt: string, cancellationWindowHours: number, now = new Date()) => new Date(startsAt).getTime() - now.getTime() < cancellationWindowHours * 3_600_000;
export function cancelDemoBooking(draft:StudioSnapshot,booking:Booking,{settle=true,late=isLateChange(booking.startsAt,booking.policySnapshot.cancellationWindowHours)}:{settle?:boolean;late?:boolean}={}){
  booking.status=late?"late_cancelled":"cancelled";const participants=draft.lessonParticipants.filter((item)=>item.bookingId===booking.id),lessonIds=participants.map((item)=>item.lessonId);participants.forEach((item)=>{item.status="cancelled";});
  if(booking.offeringId){const offering=draft.serviceOfferings.find((item)=>item.id===booking.offeringId);if(offering){offering.enrolled=Math.max(0,offering.enrolled-1);offering.version+=1;offering.updatedAt=new Date().toISOString();}}else draft.lessons.filter((item)=>lessonIds.includes(item.id)).forEach((item)=>{item.status=late?"late_cancelled":"cancelled";item.version+=1;item.updatedAt=new Date().toISOString();});
  if(settle&&!late){if(booking.paymentPolicy==="credits"){const reservations=draft.creditEntries.filter((item)=>item.kind==="reservation"&&(!item.lessonId||lessonIds.includes(item.lessonId)));for(const item of reservations)draft.creditEntries.push({id:`credit-${crypto.randomUUID()}`,packageId:item.packageId,lessonId:item.lessonId,kind:"release",quantity:Math.abs(item.quantity),reason:`Credit restored for ${booking.reference}`,createdAt:new Date().toISOString()});booking.paymentStatus="refunded";}else if(booking.paidMinor>0&&["original_payment","studio_credit"].includes(booking.policySnapshot.settlement)){draft.payments.push({id:`refund-${crypto.randomUUID()}`,studentId:booking.studentId!,kind:"refund",amountMinor:booking.paidMinor,currency:booking.currency,externalReference:`demo-settlement:${booking.id}`,reason:booking.policySnapshot.settlement==="studio_credit"?`Studio credit for ${booking.reference}`:`Refund ${booking.reference}`,createdAt:new Date().toISOString()});booking.paymentStatus="refunded";}}
  booking.version+=1;booking.updatedAt=new Date().toISOString();return booking;
}
export const seriesDates = (startsAt: string, cadence: Exclude<RecurrenceCadence, "none">, count: number, timeZone = "America/New_York") => {
  const first = wallParts(new Date(startsAt), timeZone);
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(Date.UTC(first.year, first.month - 1, first.day + index * (cadence === "weekly" ? 7 : 14)));
    return zonedDateTimeToUtc({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: first.hour, minute: first.minute }, timeZone).toISOString();
  });
};
