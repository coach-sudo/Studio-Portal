import type { Config, Context } from "@netlify/functions";
import { z } from "zod";
import {
  actorLayoutSchema,
  actorPortfolioSchema,
} from "../../src/domain/actorLayout";
import { apiError, correlationId, json } from "./_shared/http";
import { serviceClient } from "./_shared/supabase";

const optionalText = z.string().optional().catch(undefined);
const webUrl = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value));
const relativeOrigin = "https://actor.invalid";
const publicUrl = z.union([
  webUrl,
  z.string().refine((value) => {
    if (!value.startsWith("/") || value.startsWith("//")) return false;
    const url = URL.parse(value, relativeOrigin);
    return url?.origin === relativeOrigin;
  }),
]);
const color = z
  .string()
  .regex(/^#[\da-f]{6}$/i)
  .optional()
  .catch(undefined);

const revisionContent = z.object({
  displayName: z.string().trim().min(2),
  bio: z.string().optional().default(""),
  profileLabel: optionalText,
  headline: optionalText,
  unionStatus: optionalText,
  location: optionalText,
  playingAge: optionalText,
  height: optionalText,
  eyeColor: optionalText,
  hairColor: optionalText,
  website: webUrl.optional().catch(undefined),
  representation: optionalText,
  accentColor: color,
  contactEmail: z.string().email().optional().catch(undefined),
  contactPhone: actorPortfolioSchema.shape.contactPhone.catch(undefined),
  showEmail: z.literal(true).optional().catch(undefined),
  showPhone: z.literal(true).optional().catch(undefined),
  primaryHeadshotMaterialId: z.string().uuid().optional().catch(undefined),
  presentation: actorLayoutSchema.optional().catch(undefined),
  credits: optionalText,
  skills: optionalText,
  materialIds: z.array(z.string().uuid()).optional().catch(undefined),
  materialSnapshot: z.array(z.unknown()).optional().catch(undefined),
});

const materialSnapshot = z.object({
  id: z.string().uuid(),
  title: z.string(),
  category: z.string(),
  caption: z.string().nullish(),
  external_url: z.string().nullish(),
  storage_path: z.string().nullish(),
  mime_type: z.string().nullish(),
  media_kind: z
    .enum(["image", "video", "audio", "document", "link"])
    .optional()
    .catch(undefined),
});

const studioSettings = z.object({
  branding: z
    .object({
      primaryColor: color,
      secondaryColor: color,
      accentColor: color,
      surfaceColor: color,
      logoUrl: publicUrl.optional().catch(undefined),
      logoStoragePath: optionalText,
    })
    .optional()
    .catch(undefined),
  bookingPage: z
    .object({ footerWebsiteUrl: webUrl.optional() })
    .optional()
    .catch(undefined),
  actorPageCta: z
    .object({ label: z.string(), url: publicUrl })
    .optional()
    .catch(undefined),
});

function unavailable(id: string) {
  return json(
    {
      code: "NOT_FOUND",
      message: "Actor page unavailable.",
      retryable: false,
      correlationId: id,
    },
    404,
  );
}

export default async (request: Request, context: Context) => {
  const id = correlationId(request, context.requestId);
  try {
    if (request.method !== "GET")
      return json(
        {
          code: "METHOD_NOT_ALLOWED",
          message: "Method not allowed.",
          retryable: false,
          correlationId: id,
        },
        405,
      );
    const db = serviceClient();
    const { data: profile, error } = await db
      .from("actor_profiles")
      .select("id,student_id,slug,published_revision_id")
      .eq("slug", context.params.slug)
      .eq("status", "published")
      .single();
    if (error || !profile?.published_revision_id) return unavailable(id);

    const [revision, student] = await Promise.all([
      db
        .from("actor_profile_revisions")
        .select("content,published_at")
        .eq("id", profile.published_revision_id)
        .eq("actor_profile_id", profile.id)
        .single(),
      db
        .from("students")
        .select("studio_id")
        .eq("id", profile.student_id)
        .eq("actor_page_eligible", true)
        .is("deleted_at", null)
        .single(),
    ]);
    const published = revisionContent.safeParse(revision.data?.content);
    if (
      revision.error ||
      !revision.data?.published_at ||
      !published.success ||
      student.error ||
      !student.data?.studio_id
    )
      return unavailable(id);

    const {
      materialIds,
      materialSnapshot: snapshots,
      primaryHeadshotMaterialId,
      contactEmail,
      contactPhone,
      showEmail,
      showPhone,
      ...portfolio
    } = published.data;
    const approved = new Map(
      (snapshots ?? []).flatMap((value) => {
        const entry = materialSnapshot.safeParse(value);
        return entry.success ? [[entry.data.id, entry.data] as const] : [];
      }),
    );
    const approvedIds = (materialIds ?? []).filter((id) => approved.has(id));
    const [studio, materials] = await Promise.all([
      db
        .from("studios")
        .select("name,settings")
        .eq("id", student.data.studio_id)
        .single(),
      approvedIds.length
        ? db
            .from("materials")
            .select("id,external_url,storage_path")
            .eq("owner_student_id", profile.student_id)
            .eq("status", "active")
            .eq("approval_status", "approved")
            .eq("public_embed", true)
            .in("id", approvedIds)
            .order("sort_order")
        : { data: [], error: null },
    ]);
    if (studio.error || !studio.data || materials.error) return unavailable(id);

    const bucket = db.storage.from("studio-materials");
    const resolved = [];
    for (const current of materials.data ?? []) {
      const material = approved.get(current.id);
      // An approved row may have changed since publication. Only issue a link
      // for the same asset that was selected in the published revision.
      if (
        !material ||
        (material.storage_path ?? null) !== current.storage_path ||
        (material.external_url ?? null) !== current.external_url
      )
        continue;
      const url = material.storage_path
        ? (await bucket.createSignedUrl(material.storage_path, 3600)).data
            ?.signedUrl
        : webUrl.safeParse(material.external_url).data;
      if (!url) continue;
      resolved.push({
        id: material.id,
        title: material.title,
        category: material.category,
        caption: material.caption ?? undefined,
        mime_type: material.mime_type ?? undefined,
        media_kind: material.media_kind,
        url,
      });
    }

    const settings = studioSettings.safeParse(studio.data.settings).data;
    const { logoStoragePath, logoUrl, ...colors } = settings?.branding ?? {};
    const logo = logoStoragePath
      ? (await bucket.createSignedUrl(logoStoragePath, 3600)).data?.signedUrl
      : logoUrl;
    const publicEmail = showEmail ? contactEmail : undefined;
    const publicPhone = showPhone ? contactPhone : undefined;
    return json({
      ...portfolio,
      studio: {
        name: studio.data.name || "Studio",
        branding: { ...colors, logoUrl: logo },
        websiteUrl: settings?.bookingPage?.footerWebsiteUrl,
        actorCta: settings?.actorPageCta ?? {
          label: "Book coaching",
          url: "/book",
        },
      },
      slug: profile.slug,
      primaryHeadshotMaterialId: resolved.some(
        (item) => item.id === primaryHeadshotMaterialId,
      )
        ? primaryHeadshotMaterialId
        : undefined,
      contactEmail: publicEmail,
      contactPhone: publicPhone,
      showEmail: Boolean(publicEmail),
      showPhone: Boolean(publicPhone),
      publishedAt: revision.data.published_at,
      materials: resolved,
    });
  } catch (error) {
    return apiError(error, id);
  }
};

export const config: Config = { path: "/api/v2/public/actors/:slug" };
