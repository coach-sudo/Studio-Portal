import type { SupabaseClient } from "@supabase/supabase-js";

type AutomationSettings={enabled?:boolean;coachNewBooking?:boolean;studentConfirmation?:boolean;reminders?:boolean;confirmationSubject?:string;confirmationBody?:string;coachSubject?:string;coachBody?:string;reminderSubject?:string;reminderBody?:string};
const defaults:Required<AutomationSettings>={enabled:true,coachNewBooking:true,studentConfirmation:true,reminders:true,confirmationSubject:"Your {{studioName}} booking is confirmed",confirmationBody:"Hi {{studentName}},\n\nYour {{serviceName}} booking is confirmed for {{startsAt}}.\n\nManage your booking: {{manageUrl}}",coachSubject:"New booking: {{studentName}} — {{serviceName}}",coachBody:"{{studentName}} booked {{serviceName}} for {{startsAt}} ({{location}}). Reference: {{reference}}.",reminderSubject:"Reminder: {{serviceName}} in {{hours}} hours",reminderBody:"Hi {{studentName}},\n\nYour {{serviceName}} session starts at {{startsAt}}. {{meetingDetails}}"};
const render=(template:string,values:Record<string,string>)=>template.replace(/{{([a-zA-Z]+)}}/g,(_,key:string)=>values[key]??"");

export async function queueBookingEmails(db:SupabaseClient,bookingId:string,manageToken?:string,origin?:string){
  const {data:booking,error}=await db.from("bookings").select("id,studio_id,student_id,reference,guest_name,guest_email,guardian_email,starts_at,timezone,location,service_id").eq("id",bookingId).single();if(error||!booking)throw error||new Error("Booking not found");
  const [{data:studio,error:studioError},{data:service,error:serviceError}]=await Promise.all([db.from("studios").select("name,settings").eq("id",booking.studio_id).single(),db.from("booking_services").select("name").eq("id",booking.service_id).single()]);if(studioError||serviceError||!studio||!service)throw studioError||serviceError||new Error("Booking email context unavailable");
  const automation={...defaults,...((studio.settings?.emailAutomations||{}) as AutomationSettings)};if(!automation.enabled)return;
  const localeStart=new Intl.DateTimeFormat("en-US",{timeZone:booking.timezone,dateStyle:"full",timeStyle:"short"}).format(new Date(booking.starts_at)),recipient=booking.guardian_email||booking.guest_email,manageUrl=manageToken&&origin?`${origin}/booking/${manageToken}`:"Sign in to your student workspace to manage this booking.",values={studioName:studio.name,studentName:booking.guest_name,serviceName:service.name,startsAt:localeStart,location:booking.location==="in_person"?"In person":"Google Meet",reference:booking.reference,manageUrl,hours:"",meetingDetails:booking.location==="google_meet"?"Your Meet link is included in the calendar invitation.":"Your coach will confirm the location."};
  const {error:deleteError}=await db.from("outbox_messages").delete().eq("booking_id",booking.id).in("status",["draft","approved","queued","failed"]);
  if(deleteError)throw deleteError;
  const messages:Record<string,unknown>[]=[];
  if(automation.studentConfirmation)messages.push({studio_id:booking.studio_id,student_id:booking.student_id,booking_id:booking.id,channel:"email",recipient,subject:render(automation.confirmationSubject,values),body:render(automation.confirmationBody,values),status:"queued",send_at:new Date().toISOString(),event_key:"booking.confirmed.student",dedupe_key:`booking:${booking.id}:confirmed:student`});
  if(automation.coachNewBooking&&studio.settings?.contactEmail)messages.push({studio_id:booking.studio_id,student_id:booking.student_id,booking_id:booking.id,channel:"email",recipient:studio.settings.contactEmail,subject:render(automation.coachSubject,values),body:render(automation.coachBody,values),status:"queued",send_at:new Date().toISOString(),event_key:"booking.confirmed.coach",dedupe_key:`booking:${booking.id}:confirmed:coach`});
  if(automation.reminders)for(const rawHours of studio.settings?.reminderHours||[72,24,2]){const hours=Number(rawHours);if(!Number.isFinite(hours)||hours<=0)continue;const sendAt=new Date(new Date(booking.starts_at).getTime()-hours*3600000);if(sendAt<=new Date())continue;messages.push({studio_id:booking.studio_id,student_id:booking.student_id,booking_id:booking.id,channel:"email",recipient,subject:render(automation.reminderSubject,{...values,hours:String(hours)}),body:render(automation.reminderBody,{...values,hours:String(hours)}),status:"queued",send_at:sendAt.toISOString(),event_key:"booking.reminder.student",dedupe_key:`booking:${booking.id}:reminder:${hours}`});}
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
  const {error:insertError}=await db.from("outbox_messages").insert({studio_id:booking.studio_id,student_id:booking.student_id,booking_id:booking.id,channel:"email",recipient:booking.guardian_email||booking.guest_email,subject:render(automation.paymentFailedSubject||"Payment needs attention for {{studioName}}",values),body:render(automation.paymentFailedBody||"We could not collect your scheduled payment. Please update your payment method within seven days.",values),status:"queued",send_at:new Date().toISOString(),event_key:"payment.failed.student",dedupe_key:dedupeKey});
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
  const recipients = new Set<string>();
  for (const participant of participants || [])
    if (participant.email) recipients.add(String(participant.email).trim().toLowerCase());
  const primaryEmail = student?.is_minor
    ? student.guardian_email || student.email
    : student?.email || student?.guardian_email;
  if (primaryEmail) recipients.add(String(primaryEmail).trim().toLowerCase());
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
  const subject =
    kind === "rescheduled"
      ? `${lesson.topic} rescheduled - ${startsAt}`
      : `${lesson.topic} cancelled`;
  const body =
    kind === "rescheduled"
      ? `Hi ${studentName},\n\nYour ${lesson.topic} lesson has been rescheduled to ${startsAt}. Your calendar invitation is being updated automatically.\n\nLocation: ${lesson.location_label}\n\nYou can see the confirmed time in your studio portal.`
      : `Hi ${studentName},\n\nYour ${lesson.topic} lesson scheduled for ${startsAt} has been cancelled. Your calendar invitation and studio schedule are being updated automatically.\n\nYou can see the change in your studio portal.`;
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
    for (const recipient of recipients) {
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
