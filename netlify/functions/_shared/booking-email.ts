import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveNotificationRecipients } from "./notification-recipients";

type AutomationSettings={enabled?:boolean;coachNewBooking?:boolean;studentConfirmation?:boolean;reminders?:boolean;confirmationSubject?:string;confirmationBody?:string;coachSubject?:string;coachBody?:string;reminderSubject?:string;reminderBody?:string;rescheduleSubject?:string;rescheduleBody?:string;cancellationSubject?:string;cancellationBody?:string;packageExpirySubject?:string;packageExpiryBody?:string;paymentFailedSubject?:string;paymentFailedBody?:string};
const defaults:Required<AutomationSettings>={enabled:true,coachNewBooking:true,studentConfirmation:true,reminders:true,confirmationSubject:"Your {{studioName}} booking is confirmed",confirmationBody:"Hi {{studentName}},\n\nYour {{serviceName}} booking is confirmed for {{startsAt}}.\n\nManage your booking: {{manageUrl}}",coachSubject:"New booking: {{studentName}} — {{serviceName}}",coachBody:"{{studentName}} booked {{serviceName}} for {{startsAt}} ({{location}}). Reference: {{reference}}.",reminderSubject:"Reminder: {{serviceName}} in {{hours}} hours",reminderBody:"Hi {{studentName}},\n\nYour {{serviceName}} session starts at {{startsAt}}. {{meetingDetails}}",rescheduleSubject:"{{serviceName}} rescheduled — {{startsAt}}",rescheduleBody:"Hi {{studentName}},\n\nYour {{serviceName}} lesson has been rescheduled to {{startsAt}}. Your calendar invitation is being updated automatically.\n\nLocation: {{location}}",cancellationSubject:"{{serviceName}} cancelled",cancellationBody:"Hi {{studentName}},\n\nYour {{serviceName}} lesson scheduled for {{startsAt}} has been cancelled. Your calendar invitation and studio schedule are being updated automatically.",packageExpirySubject:"{{packageName}} expires in {{days}} days",packageExpiryBody:"Hi {{studentName}},\n\nYour {{packageName}} has {{credits}} credits remaining and expires on {{expiresAt}}. You can book or review your package from your studio portal.",paymentFailedSubject:"Payment needs attention for {{studioName}}",paymentFailedBody:"We could not collect your scheduled payment. Please update your payment method within seven days."};
const render=(template:string,values:Record<string,string>)=>template.replace(/{{([a-zA-Z]+)}}/g,(_,key:string)=>values[key]??"");

export async function queueBookingEmails(db:SupabaseClient,bookingId:string,manageToken?:string,origin?:string){
  const {data:booking,error}=await db.from("bookings").select("id,studio_id,student_id,reference,guest_name,guest_email,guardian_email,starts_at,timezone,location,service_id").eq("id",bookingId).single();if(error||!booking)throw error||new Error("Booking not found");
  const [{data:studio,error:studioError},{data:service,error:serviceError}]=await Promise.all([db.from("studios").select("name,settings").eq("id",booking.studio_id).single(),db.from("booking_services").select("name").eq("id",booking.service_id).single()]);if(studioError||serviceError||!studio||!service)throw studioError||serviceError||new Error("Booking email context unavailable");
  const automation={...defaults,...((studio.settings?.emailAutomations||{}) as AutomationSettings)};if(!automation.enabled)return;
  const localeStart=new Intl.DateTimeFormat("en-US",{timeZone:booking.timezone,dateStyle:"full",timeStyle:"short"}).format(new Date(booking.starts_at)),manageUrl=manageToken&&origin?`${origin}/booking/${manageToken}`:"Sign in to your student workspace to manage this booking.",values={studioName:studio.name,studentName:booking.guest_name,serviceName:service.name,startsAt:localeStart,location:booking.location==="in_person"?"In person":"Google Meet",reference:booking.reference,manageUrl,hours:"",meetingDetails:booking.location==="google_meet"?"Your Meet link is included in the calendar invitation.":"Your coach will confirm the location."};
  const confirmationRecipients=booking.student_id?await resolveNotificationRecipients(db,booking.student_id,"scheduleChanges",{mandatory:true}):[booking.guest_email,booking.guardian_email].filter(Boolean);
  const reminderRecipients=booking.student_id?await resolveNotificationRecipients(db,booking.student_id,"lessonReminders"):[booking.guest_email,booking.guardian_email].filter(Boolean);
  const {error:deleteError}=await db.from("outbox_messages").delete().eq("booking_id",booking.id).in("status",["draft","approved","queued","failed"]);
  if(deleteError)throw deleteError;
  const messages:Record<string,unknown>[]=[];
  if(automation.studentConfirmation)for(const recipient of confirmationRecipients)messages.push({studio_id:booking.studio_id,student_id:booking.student_id,booking_id:booking.id,channel:"email",recipient,subject:render(automation.confirmationSubject,values),body:render(automation.confirmationBody,values),status:"queued",send_at:new Date().toISOString(),event_key:"booking.confirmed.student",dedupe_key:`booking:${booking.id}:confirmed:student:${recipient}`,priority:80});
  if(automation.coachNewBooking&&studio.settings?.contactEmail)messages.push({studio_id:booking.studio_id,student_id:booking.student_id,booking_id:booking.id,channel:"email",recipient:studio.settings.contactEmail,subject:render(automation.coachSubject,values),body:render(automation.coachBody,values),status:"queued",send_at:new Date().toISOString(),event_key:"booking.confirmed.coach",dedupe_key:`booking:${booking.id}:confirmed:coach`});
  if(automation.reminders)for(const recipient of reminderRecipients)for(const rawHours of studio.settings?.reminderHours||[72,24,2]){const hours=Number(rawHours);if(!Number.isFinite(hours)||hours<=0)continue;const sendAt=new Date(new Date(booking.starts_at).getTime()-hours*3600000);if(sendAt<=new Date())continue;messages.push({studio_id:booking.studio_id,student_id:booking.student_id,booking_id:booking.id,channel:"email",recipient,subject:render(automation.reminderSubject,{...values,hours:String(hours)}),body:render(automation.reminderBody,{...values,hours:String(hours)}),status:"queued",send_at:sendAt.toISOString(),event_key:"booking.reminder.student",dedupe_key:`booking:${booking.id}:reminder:${hours}:${recipient}`,priority:50});}
  if(messages.length){
    const dedupeKeys=messages.map((message)=>String(message.dedupe_key));
    const {data:existing,error:existingError}=await db.from("outbox_messages").select("dedupe_key").in("dedupe_key",dedupeKeys);
    if(existingError)throw existingError;
    const existingKeys=new Set((existing||[]).map((message)=>message.dedupe_key));
    const pending=messages.filter((message)=>!existingKeys.has(message.dedupe_key as string));
    if(pending.length){const {error:insertError}=await db.from("outbox_messages").insert(pending);if(insertError)throw insertError;}
  }
}

export async function queuePaymentFailedEmail(db:SupabaseClient,bookingId:string){
  const {data:booking,error}=await db.from("bookings").select("id,studio_id,student_id,guest_name,guest_email,guardian_email,service_id").eq("id",bookingId).single();if(error||!booking)throw error||new Error("Booking not found");
  const [{data:studio},{data:service}]=await Promise.all([db.from("studios").select("name,settings").eq("id",booking.studio_id).single(),db.from("booking_services").select("name").eq("id",booking.service_id).single()]);if(!studio||!service)return;
  const automation=studio.settings?.emailAutomations||{};if(automation.enabled===false)return;const values={studioName:studio.name,studentName:booking.guest_name,serviceName:service.name};
  const dedupeKey=`booking:${booking.id}:payment-failed`;
  const {data:existing,error:existingError}=await db.from("outbox_messages").select("id,status").eq("dedupe_key",dedupeKey).maybeSingle();
  if(existingError)throw existingError;
  if(existing){
    if(existing.status==="failed"){const {error:retryError}=await db.from("outbox_messages").update({status:"queued",send_at:new Date().toISOString(),last_error:null}).eq("id",existing.id);if(retryError)throw retryError;}
    return;
  }
  const recipients=booking.student_id?await resolveNotificationRecipients(db,booking.student_id,"payments",{mandatory:true,financeOnly:true}):[booking.guardian_email||booking.guest_email];
  const {error:insertError}=await db.from("outbox_messages").upsert(recipients.filter(Boolean).map((recipient)=>({studio_id:booking.studio_id,student_id:booking.student_id,booking_id:booking.id,channel:"email",recipient,subject:render(automation.paymentFailedSubject||"Payment needs attention for {{studioName}}",values),body:render(automation.paymentFailedBody||"We could not collect your scheduled payment. Please update your payment method within seven days.",values),status:"queued",send_at:new Date().toISOString(),event_key:"payment.failed.student",dedupe_key:`${dedupeKey}:${recipient}`,priority:90})),{onConflict:"dedupe_key",ignoreDuplicates:true});
  if(insertError)throw insertError;
}

export async function queueLessonChangeEmails(
  db: SupabaseClient,
  lessonId: string,
  kind: "rescheduled" | "cancelled",
  correlationId: string,
) {
  const { data: lesson, error: lessonError } = await db
    .from("lessons")
    .select("id,studio_id,student_id,topic,starts_at,ends_at,location_label,version")
    .eq("id", lessonId)
    .single();
  if (lessonError || !lesson) throw lessonError || new Error("Lesson not found");
  const [{ data: studio }, { data: student }, { data: participants }] =
    await Promise.all([
      db.from("studios").select("name,settings").eq("id", lesson.studio_id).single(),
      db.from("students").select("full_name,preferred_name,email,guardian_email,is_minor").eq("id", lesson.student_id).single(),
      db.from("lesson_participants").select("booking_id,email,status").eq("lesson_id", lesson.id),
    ]);
  if (!studio) return [];
  const automation = { ...defaults, ...((studio.settings?.emailAutomations || {}) as AutomationSettings) };
  if (!automation.enabled) return [];
  const bookingId = participants?.find((item) => item.booking_id)?.booking_id || null;
  const recipients = new Set<string>(await resolveNotificationRecipients(db,lesson.student_id,"scheduleChanges",{mandatory:true}));
  for (const participant of participants || [])
    if (participant.email) recipients.add(String(participant.email).trim().toLowerCase());
  const studentName = student?.preferred_name || student?.full_name || "Student";
  const timezone = studio.settings?.timezone || "America/New_York";
  const startsAt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(lesson.starts_at));
  await db
    .from("outbox_messages")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .in("status", ["draft", "approved", "queued", "failed"])
    .eq("event_key", "booking.reminder.student")
    .or(`lesson_id.eq.${lesson.id}${bookingId ? `,booking_id.eq.${bookingId}` : ""}`);
  const values={studioName:studio.name,studentName,serviceName:lesson.topic,startsAt,location:lesson.location_label,reference:"",manageUrl:"Sign in to your student workspace.",hours:"",meetingDetails:lesson.location_label,packageName:"",days:"",credits:"",expiresAt:""};
  const subject = render(kind === "rescheduled" ? automation.rescheduleSubject : automation.cancellationSubject, values);
  const body = render(kind === "rescheduled" ? automation.rescheduleBody : automation.cancellationBody, values);
  const messages: Record<string, unknown>[] = [...recipients].map((recipient) => ({
    studio_id: lesson.studio_id,
    student_id: lesson.student_id,
    lesson_id: lesson.id,
    booking_id: bookingId,
    correlation_id: correlationId,
    channel: "email",
    recipient,
    subject,
    body,
    status: "queued",
    send_at: new Date().toISOString(),
    event_key: `lesson.${kind}.student`,
    dedupe_key: `lesson:${lesson.id}:${lesson.version}:${kind}:student:${recipient}`,
  }));
  if (studio.settings?.contactEmail)
    messages.push({
      studio_id: lesson.studio_id,
      student_id: lesson.student_id,
      lesson_id: lesson.id,
      booking_id: bookingId,
      correlation_id: correlationId,
      channel: "email",
      recipient: studio.settings.contactEmail,
      subject: `${studentName}: ${subject}`,
      body: `${studentName}'s ${body.slice(body.indexOf("Your"))}`,
      status: "queued",
      send_at: new Date().toISOString(),
      event_key: `lesson.${kind}.coach`,
      dedupe_key: `lesson:${lesson.id}:${lesson.version}:${kind}:coach`,
    });
  if (kind === "rescheduled" && automation.reminders) {
    const reminderRecipients = await resolveNotificationRecipients(db,lesson.student_id,"lessonReminders");
    for (const recipient of reminderRecipients) {
      for (const rawHours of studio.settings?.reminderHours || [24, 2]) {
        const hours = Number(rawHours);
        const sendAt = new Date(new Date(lesson.starts_at).getTime() - hours * 3_600_000);
        if (!Number.isFinite(hours) || hours <= 0 || sendAt <= new Date()) continue;
        messages.push({
          studio_id: lesson.studio_id,
          student_id: lesson.student_id,
          lesson_id: lesson.id,
          booking_id: bookingId,
          correlation_id: correlationId,
          channel: "email",
          recipient,
          subject: render(automation.reminderSubject, {
            studioName: studio.name,
            studentName,
            serviceName: lesson.topic,
            startsAt,
            location: lesson.location_label,
            reference: "",
            manageUrl: "Sign in to your student workspace.",
            hours: String(hours),
            meetingDetails: lesson.location_label,
          }),
          body: render(automation.reminderBody, {
            studioName: studio.name,
            studentName,
            serviceName: lesson.topic,
            startsAt,
            location: lesson.location_label,
            reference: "",
            manageUrl: "Sign in to your student workspace.",
            hours: String(hours),
            meetingDetails: lesson.location_label,
          }),
          status: "queued",
          send_at: sendAt.toISOString(),
          event_key: "booking.reminder.student",
          dedupe_key: `lesson:${lesson.id}:${lesson.version}:reminder:${hours}:${recipient}`,
        });
      }
    }
  }
  if (messages.length) {
    const { data, error } = await db
      .from("outbox_messages")
      .upsert(messages, { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select("id,status,event_key");
    if (error) throw error;
    return data || [];
  }
  return [];
}
