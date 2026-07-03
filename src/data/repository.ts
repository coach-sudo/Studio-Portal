import { demoSnapshot } from "./demo";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import type { Role, StudioSnapshot } from "../domain/model";

export async function loadStudioSnapshot(role: Role = "coach", studentId?: string): Promise<StudioSnapshot> {
  if (!isSupabaseConfigured || !supabase) return scopeDemo(role, studentId);
  const [membership, students, lessons, notes, assignments, materials, links, packages, credits, payments, profiles, readers, outbox, recommendations] = await Promise.all([
    supabase.from("memberships").select("studio_id,role,display_name").limit(1).maybeSingle(),
    supabase.from("students").select("*"), supabase.from("lessons").select("*"), supabase.from("notes").select("*"),
    supabase.from("assignments").select("*"), supabase.from("materials").select("*"), supabase.from("material_links").select("*"),
    supabase.from("packages").select("*"), supabase.from("package_credit_entries").select("*"), supabase.from("payment_entries").select("*"),
    supabase.from("actor_profiles").select("*"), supabase.from("reader_requests").select("*"), supabase.from("outbox_messages").select("*"),
    supabase.from("recommendations").select("*").eq("status", "open").order("urgency", { ascending: false }),
  ]);
  const failed = [membership,students,lessons,notes,assignments,materials,links,packages,credits,payments,profiles,readers,outbox,recommendations].find((result) => result.error);
  if (failed?.error) throw failed.error;
  const member = membership.data;
  const materialLinks = links.data ?? [];
  return {
    studioId: member?.studio_id ?? "", role: (member?.role as Role) ?? role, displayName: member?.display_name ?? "Studio",
    students: (students.data ?? []).map((r:any)=>({id:r.id,studioId:r.studio_id,fullName:r.full_name,status:r.status,email:r.email,phone:r.phone,focusArea:r.focus_area,isMinor:r.is_minor,portalEnabled:r.portal_enabled,actorPageEligible:r.actor_page_eligible,version:r.version,updatedAt:r.updated_at})),
    lessons: (lessons.data ?? []).map((r:any)=>({id:r.id,studioId:r.studio_id,studentId:r.student_id,topic:r.topic,startsAt:r.starts_at,endsAt:r.ends_at,status:r.status,locationType:r.location_type,locationLabel:r.location_label,joinUrl:r.join_url,packageId:r.package_id,version:r.version,updatedAt:r.updated_at})),
    notes: (notes.data ?? []).map((r:any)=>({id:r.id,lessonId:r.lesson_id,studentId:r.student_id,title:r.title,body:r.body,status:r.status,version:r.version,updatedAt:r.updated_at})),
    assignments: (assignments.data ?? []).map((r:any)=>({id:r.id,lessonId:r.lesson_id,studentId:r.student_id,title:r.title,details:r.details,dueAt:r.due_at,status:r.status,helpRequested:r.help_requested,version:r.version,updatedAt:r.updated_at})),
    materials: (materials.data ?? []).map((r:any)=>{const link=materialLinks.find((l:any)=>l.material_id===r.id);return{id:r.id,studentId:r.owner_student_id,lessonId:link?.lesson_id,title:r.title,category:r.category,role:link?.role??"library",status:r.status,approvalStatus:r.approval_status,storagePath:r.storage_path,externalUrl:r.external_url,version:r.version,updatedAt:r.updated_at}}),
    packages: (packages.data ?? []).map((r:any)=>({id:r.id,studentId:r.student_id,name:r.name,expiresAt:r.expires_at,priceMinor:Number(r.price_minor),currency:r.currency,version:r.version,updatedAt:r.updated_at})),
    creditEntries: (credits.data ?? []).map((r:any)=>({id:r.id,packageId:r.package_id,lessonId:r.lesson_id,kind:r.kind,quantity:r.quantity,reason:r.reason,createdAt:r.created_at})),
    payments: (payments.data ?? []).map((r:any)=>({id:r.id,studentId:r.student_id,packageId:r.package_id,kind:r.kind,amountMinor:Number(r.amount_minor),currency:r.currency,externalReference:r.external_reference,reason:r.reason,createdAt:r.created_at})),
    actorProfiles: (profiles.data ?? []).map((r:any)=>({id:r.id,studentId:r.student_id,slug:r.slug,displayName:r.display_name,bio:r.bio,status:r.status,publishedRevisionId:r.published_revision_id,version:r.version,updatedAt:r.updated_at})),
    readerRequests: (readers.data ?? []).map((r:any)=>({id:r.id,studentId:r.student_id,filmingAt:r.filming_at,meetingMethod:r.meeting_method,instructions:r.instructions,status:r.status,version:r.version,updatedAt:r.updated_at})),
    outbox: (outbox.data ?? []).map((r:any)=>({id:r.id,studentId:r.student_id,channel:r.channel,recipient:r.recipient,subject:r.subject,body:r.body,status:r.status,attempts:r.attempts,lastError:r.last_error,version:r.version,updatedAt:r.updated_at})),
    recommendations: (recommendations.data ?? []).map((r:any)=>({id:r.id,studioId:r.studio_id,studentId:r.student_id,entityType:r.entity_type,entityId:r.entity_id,reasonCode:r.reason_code,title:r.title,explanation:r.explanation,evidence:r.evidence,urgency:r.urgency,dueAt:r.due_at,suggestedAction:r.suggested_action,requiresConfirmation:r.requires_confirmation})),
  } as StudioSnapshot;
}

function scopeDemo(role: Role, studentId = "student-maya"): StudioSnapshot {
  if (role === "coach") return structuredClone(demoSnapshot);
  const studentIds = [studentId];
  const student = demoSnapshot.students.find((row) => row.id === studentId);
  return {
    ...structuredClone(demoSnapshot), role, displayName: role === "guardian" ? student?.guardianName ?? "Guardian" : student?.fullName.split(" ")[0] ?? "Student",
    students: demoSnapshot.students.filter((row) => studentIds.includes(row.id)),
    lessons: demoSnapshot.lessons.filter((row) => studentIds.includes(row.studentId)),
    notes: demoSnapshot.notes.filter((row) => studentIds.includes(row.studentId) && row.status === "published"),
    assignments: demoSnapshot.assignments.filter((row) => studentIds.includes(row.studentId)),
    materials: demoSnapshot.materials.filter((row) => studentIds.includes(row.studentId) && row.status === "active"),
    packages: demoSnapshot.packages.filter((row) => studentIds.includes(row.studentId)),
    creditEntries: demoSnapshot.creditEntries.filter((row) => demoSnapshot.packages.some((pkg) => pkg.id === row.packageId && studentIds.includes(pkg.studentId))),
    payments: demoSnapshot.payments.filter((row) => studentIds.includes(row.studentId)),
    actorProfiles: demoSnapshot.actorProfiles.filter((row) => studentIds.includes(row.studentId)),
    readerRequests: demoSnapshot.readerRequests.filter((row) => studentIds.includes(row.studentId)),
    outbox: [], recommendations: [],
  };
}
