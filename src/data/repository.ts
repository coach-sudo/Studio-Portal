import { demoSnapshot } from "./demo";
import { mergeStudioSettings } from "./settings";
import { isDemoMode, isSupabaseConfigured, supabase } from "../lib/supabase";
import type { Role, StudioSnapshot } from "../domain/model";
import { scopeStudioSnapshot } from "../state/StudioStore";

export async function loadStudioSnapshot(role: Role = "coach", studentId?: string): Promise<StudioSnapshot> {
  if (!isSupabaseConfigured || !supabase) {
    if (isDemoMode) return scopeStudioSnapshot(structuredClone(demoSnapshot), role, studentId);
    throw new Error("Production database configuration is unavailable.");
  }
  const [membership, studio, students, lessons, notes, assignments, materials, links, packages, packageDefinitions, pricingRules, credits, payments, profiles, outbox, recommendations, bookingServices, availabilityRules, availabilityExceptions, serviceOfferings, recurringSeries, bookings, lessonParticipants, lessonMessages, integrationImports, lessonWhiteboards, discountCodes] = await Promise.all([
    supabase.from("memberships").select("studio_id,role,display_name").limit(1).maybeSingle(),
    supabase.from("studios").select("id,name,slug,timezone,settings").limit(1).maybeSingle(),
    supabase.from("students").select("*"), supabase.from("lessons").select("*"), supabase.from("notes").select("*"),
    supabase.from("assignments").select("*"), supabase.from("materials").select("*"), supabase.from("material_links").select("*"),
    supabase.from("packages").select("*"), supabase.from("package_definitions").select("*"), supabase.from("student_pricing_rules").select("*"), supabase.from("package_credit_entries").select("*"), supabase.from("payment_entries").select("*"),
    supabase.from("actor_profiles").select("*"), supabase.from("outbox_messages").select("*"),
    supabase.from("recommendations").select("*").eq("status", "open").order("urgency", { ascending: false }),
    supabase.from("booking_services").select("*"), supabase.from("availability_rules").select("*"), supabase.from("availability_exceptions").select("*"),
    supabase.from("service_offerings").select("*"), supabase.from("recurring_series").select("*"), supabase.from("bookings").select("*"), supabase.from("lesson_participants").select("*"), supabase.from("lesson_messages").select("*").order("created_at",{ascending:true}), supabase.from("integration_imports").select("*").order("created_at",{ascending:false}), supabase.from("lesson_whiteboards").select("*"), supabase.from("discount_codes").select("*").order("created_at",{ascending:false}),
  ]);
  const failed = [membership,studio,students,lessons,notes,assignments,materials,links,packages,packageDefinitions,pricingRules,credits,payments,profiles,outbox,recommendations,bookingServices,availabilityRules,availabilityExceptions,serviceOfferings,recurringSeries,bookings,lessonParticipants,lessonMessages,integrationImports,lessonWhiteboards,discountCodes].find((result) => result.error);
  if (failed?.error) throw failed.error;
  const member = membership.data;
  const materialLinks = links.data ?? [];
  const studentRows = students.data ?? [];
  const storagePaths = (materials.data ?? []).map((row:any) => row.storage_path).filter((value:any): value is string => Boolean(value));
  const signedMaterialUrls = new Map<string,string>();
  if (storagePaths.length) {
    const { data: signedRows } = await supabase.storage.from("studio-materials").createSignedUrls(storagePaths, 3600);
    for (const row of signedRows ?? []) if (row.path && row.signedUrl) signedMaterialUrls.set(row.path, row.signedUrl);
  }
  const currentStudent = studentId
    ? studentRows.find((row: any) => row.id === studentId) ?? studentRows[0]
    : studentRows[0];
  const displayName =
    member?.display_name ??
    (role === "student"
      ? currentStudent?.preferred_name || currentStudent?.full_name || "Student"
      : "Studio");
  const raw=(studio.data?.settings??{}) as Partial<StudioSnapshot["settings"]>;
  const settings=mergeStudioSettings(structuredClone(demoSnapshot.settings),{...raw,timezone:studio.data?.timezone??raw.timezone??demoSnapshot.settings.timezone});
  if (settings.branding?.logoStoragePath) {
    const { data: signed } = await supabase.storage.from("studio-materials").createSignedUrl(settings.branding.logoStoragePath, 3600);
    if (signed?.signedUrl) settings.branding = { ...settings.branding, logoUrl: signed.signedUrl };
  }
  return {
    studioId: member?.studio_id ?? studio.data?.id ?? students.data?.[0]?.studio_id ?? "", role: (member?.role as Role) ?? role, displayName,
    settings,
    students: studentRows.map((r:any)=>({id:r.id,studioId:r.studio_id,fullName:r.full_name,status:r.status,email:r.email,phone:r.phone,guardianName:r.guardian_name,guardianEmail:r.guardian_email,focusArea:r.focus_area,isMinor:r.is_minor,portalEnabled:r.portal_enabled,portalUsername:r.portal_username,actorPageEligible:r.actor_page_eligible,preferredName:r.preferred_name,pronouns:r.pronouns,goals:r.goals,leadSource:r.lead_source,tags:r.tags,driveFolderUrl:r.drive_folder_url,timezone:r.timezone,privateNotes:r.internal_notes,defaultRateMinor:r.default_rate_minor,portalPreferences:r.portal_preferences,stripeCustomerId:r.stripe_customer_id,paymentMethodSummary:typeof r.payment_method_summary==="string"?r.payment_method_summary:r.payment_method_summary?.label||"",version:r.version,updatedAt:r.updated_at})),
    lessons: (lessons.data ?? []).map((r:any)=>({id:r.id,studioId:r.studio_id,studentId:r.student_id,topic:r.topic,startsAt:r.starts_at,endsAt:r.ends_at,status:r.status,locationType:r.location_type,locationLabel:r.location_label,joinUrl:r.join_url,packageId:r.package_id,sourceProvider:r.source_provider,sourceExternalId:r.source_external_id,sourceConfidence:r.source_confidence==null?undefined:Number(r.source_confidence),importedAt:r.imported_at,version:r.version,updatedAt:r.updated_at})),
    notes: (notes.data ?? []).map((r:any)=>({id:r.id,lessonId:r.lesson_id,studentId:r.student_id,title:r.title,body:r.body,bodyHtml:r.body_html,richContent:r.rich_content,tags:r.tags,category:r.category,pinned:r.pinned,status:r.status,version:r.version,updatedAt:r.updated_at})),
    assignments: (assignments.data ?? []).map((r:any)=>({id:r.id,lessonId:r.lesson_id,studentId:r.student_id,title:r.title,details:r.details,dueAt:r.due_at,status:r.status,helpRequested:r.help_requested,version:r.version,updatedAt:r.updated_at})),
    materials: (materials.data ?? []).map((r:any)=>{const link=materialLinks.find((l:any)=>l.material_id===r.id);return{id:r.id,studentId:r.owner_student_id,lessonId:link?.lesson_id,title:r.title,category:r.category,role:link?.role??"library",status:r.status,approvalStatus:r.approval_status,storagePath:r.storage_path,externalUrl:r.storage_path?signedMaterialUrls.get(r.storage_path):r.external_url,caption:r.caption,mimeType:r.mime_type,fileSizeBytes:r.file_size_bytes==null?undefined:Number(r.file_size_bytes),mediaKind:r.media_kind,publicEmbed:r.public_embed,sortOrder:r.sort_order,version:r.version,updatedAt:r.updated_at}}),
    packages: (packages.data ?? []).map((r:any)=>({id:r.id,studentId:r.student_id,name:r.name,expiresAt:r.expires_at,priceMinor:Number(r.price_minor),currency:r.currency,version:r.version,updatedAt:r.updated_at})),
    packageDefinitions: (packageDefinitions.data ?? []).map((r:any)=>({id:r.id,studioId:r.studio_id,name:r.name,description:r.description,sessionCount:r.session_count,sessionDurationMinutes:r.session_duration_minutes,priceMinor:Number(r.price_minor),discountMinor:Number(r.discount_minor),currency:r.currency,expirationDays:r.expiration_days,eligibleServiceIds:r.eligible_service_ids,meetingProviders:r.meeting_providers,recurringEligible:r.recurring_eligible,visibility:r.visibility,directPurchase:r.direct_purchase,active:r.active,version:r.version,updatedAt:r.updated_at})),
    studentPricingRules: (pricingRules.data ?? []).map((r:any)=>({id:r.id,studioId:r.studio_id,studentId:r.student_id,serviceId:r.service_id,priceMinor:Number(r.price_minor),reason:r.reason,startsAt:r.starts_at,endsAt:r.ends_at,active:r.active,version:r.version,updatedAt:r.updated_at})),
    creditEntries: (credits.data ?? []).map((r:any)=>({id:r.id,packageId:r.package_id,lessonId:r.lesson_id,kind:r.kind,quantity:r.quantity,reason:r.reason,createdAt:r.created_at})),
    payments: (payments.data ?? []).map((r:any)=>({id:r.id,studentId:r.student_id,packageId:r.package_id,kind:r.kind,amountMinor:Number(r.amount_minor),currency:r.currency,externalReference:r.external_reference,reason:r.reason,createdAt:r.created_at})),
    actorProfiles: (profiles.data ?? []).map((r:any)=>({id:r.id,studentId:r.student_id,slug:r.slug,displayName:r.display_name,bio:r.bio,status:r.status,publishedRevisionId:r.published_revision_id,draftContent:r.draft_content??{},version:r.version,updatedAt:r.updated_at})),
    outbox: (outbox.data ?? []).map((r:any)=>({id:r.id,studentId:r.student_id,channel:r.channel,recipient:r.recipient,subject:r.subject,body:r.body,status:r.status,attempts:r.attempts,lastError:r.last_error,version:r.version,updatedAt:r.updated_at})),
    recommendations: (recommendations.data ?? []).map((r:any)=>({id:r.id,studioId:r.studio_id,studentId:r.student_id,entityType:r.entity_type,entityId:r.entity_id,reasonCode:r.reason_code,title:r.title,explanation:r.explanation,evidence:r.evidence,urgency:r.urgency,dueAt:r.due_at,suggestedAction:r.suggested_action,requiresConfirmation:r.requires_confirmation})),
    bookingServices: (bookingServices.data??[]).map((r:any)=>({id:r.id,version:r.version,updatedAt:r.updated_at,studioId:r.studio_id,slug:r.slug,name:r.name,description:r.description,category:r.category,durationMinutes:r.duration_minutes,priceMinor:Number(r.price_minor),depositMinor:Number(r.deposit_minor),depositType:r.deposit_type,depositPercentage:r.deposit_percentage===null?undefined:Number(r.deposit_percentage),balanceDueTiming:r.balance_due_timing,balanceDueHours:r.balance_due_hours,autoChargeBalance:r.auto_charge_balance,currency:r.currency,capacity:r.capacity,locationOptions:r.location_options,defaultLocation:r.default_location,recurrenceOptions:r.recurrence_options,paymentPolicies:r.payment_policies,bufferBeforeMinutes:r.buffer_before_minutes,bufferAfterMinutes:r.buffer_after_minutes,bufferByLocation:r.buffer_by_location??{},locationPriceAdjustments:r.location_price_adjustments??{},minimumNoticeHours:r.minimum_notice_hours,bookingHorizonDays:r.booking_horizon_days,slotIntervalMinutes:r.slot_interval_minutes,policy:r.policy,policyVersion:r.policy_version,published:r.published})),
    availabilityRules:(availabilityRules.data??[]).map((r:any)=>({id:r.id,version:r.version,updatedAt:r.updated_at,studioId:r.studio_id,serviceId:r.service_id,weekday:r.weekday,startsAtLocal:r.starts_at_local,endsAtLocal:r.ends_at_local,timezone:r.timezone,active:r.active})),
    availabilityExceptions:(availabilityExceptions.data??[]).map((r:any)=>({id:r.id,version:r.version,updatedAt:r.updated_at,studioId:r.studio_id,serviceId:r.service_id,startsAt:r.starts_at,endsAt:r.ends_at,kind:r.kind,label:r.label})),
    serviceOfferings:(serviceOfferings.data??[]).map((r:any)=>({id:r.id,version:r.version,updatedAt:r.updated_at,studioId:r.studio_id,serviceId:r.service_id,title:r.title,startsAt:r.starts_at,endsAt:r.ends_at,enrollmentClosesAt:r.enrollment_closes_at,capacity:r.capacity,enrolled:r.enrolled,lessonIds:r.lesson_ids,published:r.published,description:r.description,meetingUrl:r.meeting_url,resourceLinks:r.resource_links??[]})),
    recurringSeries:(recurringSeries.data??[]).map((r:any)=>({id:r.id,version:r.version,updatedAt:r.updated_at,studioId:r.studio_id,serviceId:r.service_id,studentId:r.student_id,kind:r.kind,cadence:r.cadence,status:r.status,startsOn:r.starts_on,endsOn:r.ends_on,occurrenceCount:r.occurrence_count,paymentPolicy:r.payment_policy,nextBillingAt:r.next_billing_at,recurrenceRule:r.recurrence_rule,studentCanModify:r.student_can_modify,priceMinor:r.price_minor===null?undefined:Number(r.price_minor),discountMinor:Number(r.discount_minor),meetingProvider:r.meeting_provider,pausedAt:r.paused_at})),
    bookings:(bookings.data??[]).map((r:any)=>({id:r.id,version:r.version,updatedAt:r.updated_at,studioId:r.studio_id,reference:r.reference,serviceId:r.service_id,offeringId:r.offering_id,seriesId:r.series_id,studentId:r.student_id,guestName:r.guest_name,guestEmail:r.guest_email,guardianName:r.guardian_name,guardianEmail:r.guardian_email,forMinor:r.for_minor,startsAt:r.starts_at,endsAt:r.ends_at,timezone:r.timezone,location:r.location,inPersonLocation:r.in_person_location,locationConfirmedAt:r.location_confirmed_at,status:r.status,paymentPolicy:r.payment_policy,paymentStatus:r.payment_status,totalMinor:Number(r.total_minor),paidMinor:Number(r.paid_minor),discountCodeId:r.discount_code_id,discountMinor:Number(r.discount_minor||0),currency:r.currency,policySnapshot:r.policy_snapshot,pricingSnapshot:r.pricing_snapshot,balanceDueAt:r.balance_due_at,autoChargeBalance:r.auto_charge_balance,adminOverride:r.admin_override,rescheduleCount:r.reschedule_count})),
    lessonParticipants:(lessonParticipants.data??[]).map((r:any)=>({id:r.id,lessonId:r.lesson_id,bookingId:r.booking_id,studentId:r.student_id,displayName:r.display_name,email:r.email,status:r.status})),
    lessonMessages:(lessonMessages.data??[]).map((r:any)=>({id:r.id,lessonId:r.lesson_id,studentId:r.student_id,authorUserId:r.author_user_id,authorRole:r.author_role,body:r.body,createdAt:r.created_at})),
    integrationImports:(integrationImports.data??[]).map((r:any)=>({id:r.id,studioId:r.studio_id,provider:r.provider,externalId:r.external_id,detectedSource:r.detected_source,studentId:r.student_id,lessonId:r.lesson_id,status:r.status,confidence:Number(r.confidence),matchedBy:r.matched_by,verifiedAt:r.verified_at,verifiedBy:r.verified_by,verificationNote:r.verification_note,payload:r.payload??{},createdAt:r.created_at,updatedAt:r.updated_at})),
    lessonWhiteboards:(lessonWhiteboards.data??[]).map((r:any)=>({id:r.id,studioId:r.studio_id,lessonId:r.lesson_id,document:r.document??{version:1,elements:[]},version:r.version,updatedAt:r.updated_at})),
    discountCodes:(discountCodes.data??[]).map((r:any)=>({id:r.id,studioId:r.studio_id,code:r.code,description:r.description,discountType:r.discount_type,amount:Number(r.amount),currency:r.currency,serviceIds:r.service_ids??[],active:r.active,startsAt:r.starts_at,endsAt:r.ends_at,maxRedemptions:r.max_redemptions,redemptionCount:r.redemption_count,version:r.version,updatedAt:r.updated_at})),
  } as StudioSnapshot;
}
