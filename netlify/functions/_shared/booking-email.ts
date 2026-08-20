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
