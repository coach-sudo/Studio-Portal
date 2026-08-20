import type { Config } from "@netlify/functions";
import { googleAccessToken } from "./_shared/google";
import { serviceClient } from "./_shared/supabase";

type StudentRow = { id:string; full_name:string; preferred_name?:string|null; email?:string|null; guardian_name?:string|null; guardian_email?:string|null };
type CalendarEvent = { id:string; status?:string; summary?:string; description?:string; location?:string; hangoutLink?:string; htmlLink?:string; organizer?:{email?:string;self?:boolean}; attendees?:Array<{email?:string;displayName?:string;self?:boolean}>; start?:{dateTime?:string}; end?:{dateTime?:string}; updated?:string };
const normalize = (value?:string|null) => (value||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9@.]+/g," ").trim();
const personKey = (value?:string|null) => normalize(value).split(" ").filter((part)=>part.length>1).join(" ");
const provider = (text:string) => /lessonface/i.test(text)?"lessonface":/wyzant/i.test(text)?"wyzant":/lessons\.com/i.test(text)?"lessons_com":/(acuity|squarespace scheduling)/i.test(text)?"acuity":undefined;
const displayProvider = (value:string) => ({lessonface:"Lessonface",wyzant:"Wyzant",lessons_com:"Lessons.com",acuity:"Acuity",google_calendar:"Google Calendar",gmail:"Gmail"} as Record<string,string>)[value]||value;
const looksLikeLesson = (text:string) => /(lesson|coaching|acting|audition|session|class|consultation|rehearsal)/i.test(text);
const coachEmailKeys = (studio:any) => [...(studio.settings?.coachEmails||[]),studio.settings?.contactEmail,Netlify.env.get("GOOGLE_ACCOUNT_EMAIL")].filter(Boolean).map((value:string)=>normalize(value));
const eligibleStudents = (studio:any, students:StudentRow[]) => { const coachName=personKey(studio.settings?.coachName),coachEmails=coachEmailKeys(studio);return students.filter((student)=>personKey(student.full_name)!==coachName&&![student.email,student.guardian_email].some((value)=>value&&coachEmails.includes(normalize(value)))); };
function titleIdentity(summary:string){const preferred=summary.match(/\((?!coach\b)([^)]+)\)/i)?.[1]?.trim(),withoutParenthetical=summary.replace(/\([^)]*\)/g," "),prefix=withoutParenthetical.includes(":")?withoutParenthetical.split(":")[0]:withoutParenthetical.split(/\s+for\s+\d+\s*min|\s+-\s+acting|\s+acting\s+(?:lesson|session|coaching)|\s+(?:lesson|session|coaching)$/i)[0],fullName=prefix.replace(/\b\d+\s*min\b|\bprepaid\b|lessonface|wyzant|lessons\.com|acuity|confirmed|booking/gi," ").replace(/[^a-zA-Z' -]/g," ").replace(/\s+/g," ").trim();return fullName&&!/^(acting|lesson|session|coaching|private)$/i.test(fullName)?{fullName,preferred}:undefined;}

function matchStudent(students:StudentRow[], text:string, emails:string[]) {
  const normalizedEmails=emails.map((value)=>normalize(value));
  const byEmail=students.find((student)=>[student.email,student.guardian_email].some((value)=>value&&normalizedEmails.includes(normalize(value))));
  if(byEmail)return {student:byEmail,matchedBy:"email",confidence:.99};
  const haystack=` ${normalize(text)} `;
  const byName=students.find((student)=>[student.full_name,student.preferred_name,student.guardian_name].filter(Boolean).some((value)=>{const name=normalize(value);return name.length>=4&&haystack.includes(` ${name} `);}));
  return byName?{student:byName,matchedBy:"student or guardian name",confidence:.91}:undefined;
}

async function importCalendar(token:string, studio:any, students:StudentRow[]) {
  const db=serviceClient(),calendar=encodeURIComponent(Netlify.env.get("GOOGLE_CALENDAR_ID")||"primary"),from=new Date(Date.now()-14*86400000).toISOString(),to=new Date(Date.now()+90*86400000).toISOString();
  const response=await fetch(`https://www.googleapis.com/calendar/v3/calendars/${calendar}/events?singleEvents=true&showDeleted=false&orderBy=startTime&timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}&maxResults=250`,{headers:{Authorization:`Bearer ${token}`}});
  const payload=await response.json() as {items?:CalendarEvent[];error?:unknown};if(!response.ok)throw new Error(`Calendar intake failed: ${JSON.stringify(payload.error||payload)}`);
  let imported=0,review=0;
  for(const event of payload.items||[]){
    if(!event.id||!event.start?.dateTime||!event.end?.dateTime||event.status==="cancelled")continue;
    const text=[event.summary,event.description,event.location,event.organizer?.email,...(event.attendees||[]).flatMap((item)=>[item.email,item.displayName])].filter(Boolean).join(" ");
    if(/managed by /i.test(event.description||""))continue;
    const selfEmails=(event.attendees||[]).filter((item)=>item.self).map((item)=>normalize(item.email)),coachEmails=[...new Set([...coachEmailKeys(studio),...selfEmails])],externalAttendees=(event.attendees||[]).filter((item)=>!item.self&&!coachEmails.includes(normalize(item.email))),emails=externalAttendees.map((item)=>item.email||"").filter(Boolean),matchText=[event.summary,...externalAttendees.map((item)=>item.displayName)].filter(Boolean).join(" "),detected=provider(text),candidates=eligibleStudents(studio,students).filter((item)=>![item.email,item.guardian_email].some((value)=>value&&coachEmails.includes(normalize(value)))),match=matchStudent(candidates,matchText,emails),identity=titleIdentity(event.summary||"");
    if(!detected&&!match&&!identity)continue;
    if(!looksLikeLesson(text)&&!detected)continue;
    const source=detected||"google_calendar";
    const {data:prior}=await db.from("integration_imports").select("id,lesson_id,status").eq("studio_id",studio.id).eq("provider","google_calendar").eq("external_id",event.id).maybeSingle();
    let student=match?.student;
    if(!student&&identity){student=candidates.find((item)=>normalize(item.full_name)===normalize(identity.fullName));if(!student&&emails[0]){const {data:created,error}=await db.from("students").insert({studio_id:studio.id,full_name:identity.fullName,preferred_name:identity.preferred||null,email:emails[0].toLowerCase(),status:"lead",lead_source:displayProvider(source),portal_enabled:false}).select("id,full_name,preferred_name,email,guardian_name,guardian_email").single();if(!error&&created){student=created;students.push(created);}}}
    if(!student&&detected&&emails[0]){
      const fallback=(event.summary||displayProvider(detected)).replace(/lessonface|wyzant|lessons\.com|acuity|confirmed|booking|lesson|session/gi," ").replace(/\s+/g," ").trim()||`${displayProvider(detected)} student`;
      const {data:created,error}=await db.from("students").insert({studio_id:studio.id,full_name:fallback,email:emails[0].toLowerCase(),status:"lead",lead_source:displayProvider(detected),portal_enabled:false}).select("id,full_name,preferred_name,email,guardian_name,guardian_email").single();if(!error&&created){student=created;students.push(created);}
    }
    const confidence=match?.confidence||(student&&identity?.fullName?0.88:detected?.length?0.7:0.5);let lessonId:string|undefined;
    if(student){
      const {data:lesson,error}=await db.from("lessons").upsert({studio_id:studio.id,student_id:student.id,topic:event.summary||`${displayProvider(source)} lesson`,starts_at:event.start.dateTime,ends_at:event.end.dateTime,status:new Date(event.end.dateTime)<new Date()?"completed":"scheduled",location_type:event.hangoutLink?"virtual":"in_person",location_label:event.hangoutLink?"Google Meet":event.location||displayProvider(source),join_url:event.hangoutLink||null,meeting_provider:event.hangoutLink?"google_meet":"in_person",source_provider:source,source_external_id:event.id,source_confidence:confidence,imported_at:new Date().toISOString()},{onConflict:"studio_id,source_provider,source_external_id"}).select("id,version").single();
      if(!error&&lesson){lessonId=lesson.id;await db.from("lesson_participants").delete().eq("lesson_id",lesson.id);await Promise.all([db.from("lesson_participants").insert({lesson_id:lesson.id,student_id:student.id,display_name:student.preferred_name||student.full_name,email:student.email||emails[0]||"",status:"confirmed"}),db.from("calendar_projections").upsert({lesson_id:lesson.id,external_event_id:event.id,external_version:event.updated,projected_version:lesson.version,status:"projected",last_projected_at:new Date().toISOString(),last_error:null},{onConflict:"lesson_id"})]);imported++;}
    } else {if(prior?.lesson_id)await db.from("lessons").delete().eq("id",prior.lesson_id).eq("source_provider",source);review++;}
    await db.from("integration_imports").upsert({studio_id:studio.id,provider:"google_calendar",external_id:event.id,detected_source:source,student_id:student?.id||null,lesson_id:lessonId||null,status:lessonId?"imported":"needs_review",confidence,matched_by:match?.matchedBy||(student&&identity?"calendar event title":null),payload:event,updated_at:new Date().toISOString()},{onConflict:"studio_id,provider,external_id"});
  }
  return {imported,review};
}

async function scanGmail(token:string,studio:any,students:StudentRow[]){
  const db=serviceClient(),query=encodeURIComponent('newer_than:45d {lessonface wyzant "lessons.com" acuity "squarespace scheduling"}'),list=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=100`,{headers:{Authorization:`Bearer ${token}`}}),payload=await list.json() as {messages?:Array<{id:string}>;error?:any};
  if(!list.ok){await db.from("recommendations").upsert({studio_id:studio.id,entity_type:"integration",reason_code:"gmail_read_scope_required",title:"Reconnect Google to import booking emails",explanation:"Sending email works, but smart booking intake also needs read-only Gmail permission.",evidence:[payload.error?.message||"Gmail read unavailable"],urgency:3,suggested_action:"open_integrations",requires_confirmation:false,status:"open",dedupe_key:`studio:${studio.id}:gmail-read`},{onConflict:"dedupe_key"});return {review:0,scope:false};}
  let review=0;
  for(const item of payload.messages||[]){const {data:prior}=await db.from("integration_imports").select("id").eq("studio_id",studio.id).eq("provider","gmail").eq("external_id",item.id).maybeSingle();if(prior)continue;const response=await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date`,{headers:{Authorization:`Bearer ${token}`}}),message=await response.json() as any;if(!response.ok)continue;const headers=Object.fromEntries((message.payload?.headers||[]).map((header:any)=>[String(header.name).toLowerCase(),header.value])),text=[headers.subject,headers.from,message.snippet].filter(Boolean).join(" "),detected=provider(text);if(!detected)continue;const emails=(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)||[]),match=matchStudent(eligibleStudents(studio,students),text,emails);await db.from("integration_imports").upsert({studio_id:studio.id,provider:"gmail",external_id:item.id,detected_source:detected,student_id:match?.student.id||null,status:"needs_review",confidence:match?.confidence||.65,matched_by:match?.matchedBy||null,payload:{headers,snippet:message.snippet,threadId:message.threadId},updated_at:new Date().toISOString()},{onConflict:"studio_id,provider,external_id"});review++;}
  await db.from("recommendations").update({status:"resolved",updated_at:new Date().toISOString()}).eq("dedupe_key",`studio:${studio.id}:gmail-read`);
  return {review,scope:true};
}

export async function runProviderIntake(){const db=serviceClient(),{data:studios,error}=await db.from("studios").select("id,settings");if(error)throw error;const token=await googleAccessToken();let calendarImported=0,calendarReview=0,gmailReview=0,gmailScope=true;for(const studio of studios||[]){const {data:students}=await db.from("students").select("id,full_name,preferred_name,email,guardian_name,guardian_email").eq("studio_id",studio.id);const calendar=await importCalendar(token,studio,students||[]);calendarImported+=calendar.imported;calendarReview+=calendar.review;const gmail=await scanGmail(token,studio,students||[]);gmailReview+=gmail.review;gmailScope=gmailScope&&gmail.scope;}return {ok:true,calendarImported,calendarReview,gmailReview,gmailScope};}
export default async()=>Response.json(await runProviderIntake());
export const config:Config={schedule:"*/10 * * * *"};
