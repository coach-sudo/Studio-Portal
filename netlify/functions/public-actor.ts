import type { Config, Context } from "@netlify/functions";
import { apiError, correlationId, json } from "./_shared/http";
import { serviceClient } from "./_shared/supabase";

export default async (request: Request, context: Context) => {
  const id = correlationId(request, context.requestId);
  try {
    if (request.method !== "GET") return json({ code: "METHOD_NOT_ALLOWED", message: "Method not allowed.", retryable: false, correlationId: id }, 405);
    const db = serviceClient();
    const { data: profile, error } = await db.from("actor_profiles").select("id,student_id,slug,display_name,bio,status,published_revision_id").eq("slug", context.params.slug).eq("status", "published").single();
    if (error || !profile?.published_revision_id) return json({ code: "NOT_FOUND", message: "Actor page unavailable.", retryable: false, correlationId: id }, 404);
    const [{ data: revision }, { data: student }, { data: materials }] = await Promise.all([
      db.from("actor_profile_revisions").select("content,published_at").eq("id", profile.published_revision_id).single(),
      db.from("students").select("focus_area,studio_id").eq("id", profile.student_id).single(),
      db.from("materials").select("id,title,category,caption,external_url,storage_path,mime_type,media_kind,public_embed,sort_order").eq("owner_student_id", profile.student_id).eq("status", "active").eq("approval_status", "approved").eq("public_embed",true).order("sort_order"),
    ]);
    const content = revision?.content as { displayName?: string; bio?: string; headline?: string; unionStatus?: string; location?: string; playingAge?: string; height?: string; eyeColor?: string; hairColor?: string; website?: string; representation?: string; accentColor?: string } | undefined;
    const {data:studio}=await db.from("studios").select("name,settings").eq("id",student!.studio_id).single(),resolved=[];for(const material of materials||[]){let url=material.external_url;if(material.storage_path){const {data:signed}=await db.storage.from("studio-materials").createSignedUrl(material.storage_path,3600);url=signed?.signedUrl||null;}if(url)resolved.push({...material,url});}let branding={...(studio?.settings?.branding||{})};if(branding.logoStoragePath){const {data:signed}=await db.storage.from("studio-materials").createSignedUrl(branding.logoStoragePath,3600);if(signed?.signedUrl)branding.logoUrl=signed.signedUrl;}
    return json({ studio:{name:studio?.name||"Studio",branding,websiteUrl:studio?.settings?.bookingPage?.footerWebsiteUrl},slug: profile.slug, displayName: content?.displayName || profile.display_name, bio: content?.bio || profile.bio, headline:content?.headline, unionStatus:content?.unionStatus, location:content?.location, playingAge:content?.playingAge, height:content?.height, eyeColor:content?.eyeColor, hairColor:content?.hairColor, website:content?.website, representation:content?.representation, accentColor:content?.accentColor, focusArea: student?.focus_area, publishedAt: revision?.published_at, materials: resolved });
  } catch (error) { return apiError(error, id); }
};

export const config: Config = { path: "/api/v2/public/actors/:slug" };
