import { z } from "zod";
export const actorSectionIds = [
  "biography",
  "headshots",
  "credits",
  "skills",
  "media",
] as const;
export type ActorSectionId = (typeof actorSectionIds)[number];
export const actorLayoutSchema = z.object({
  version: z.literal(1),
  layout: z.enum(["classic", "spotlight"]),
  sections: z
    .array(z.enum(actorSectionIds))
    .length(5)
    .refine((a) => new Set(a).size === 5, "Keep each section exactly once"),
});
export type ActorLayout = z.infer<typeof actorLayoutSchema>;
export const classicActorLayout: ActorLayout = {
  version: 1,
  layout: "classic",
  sections: [...actorSectionIds],
};
export function readActorLayout(value: unknown): ActorLayout {
  const parsed = actorLayoutSchema.safeParse(value);
  return parsed.success ? parsed.data : classicActorLayout;
}
export function moveActorSection(
  sections: ActorSectionId[],
  id: ActorSectionId,
  to: number,
) {
  const next = sections.filter((x) => x !== id);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, id);
  return next;
}
const safeUrl = z.union([
  z.literal(""),
  z
    .string()
    .url()
    .refine((s) => /^https?:\/\//i.test(s)),
]);
export const actorPortfolioSchema = z
  .object({
    profileLabel: z.string().max(80).optional(),
    headline: z.string().max(200).optional(),
    unionStatus: z.string().max(100).optional(),
    location: z.string().max(200).optional(),
    playingAge: z.string().max(60).optional(),
    height: z.string().max(60).optional(),
    eyeColor: z.string().max(80).optional(),
    hairColor: z.string().max(80).optional(),
    website: safeUrl.optional(),
    representation: z.string().max(500).optional(),
    accentColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    contactEmail: z.union([z.literal(""), z.string().email()]).optional(),
    contactPhone: z.string().max(80).optional(),
    showEmail: z.boolean().optional(),
    showPhone: z.boolean().optional(),
    primaryHeadshotMaterialId: z.string().max(100).optional(),
    presentation: actorLayoutSchema.optional(),
    credits: z.string().max(20000).optional(),
    skills: z.string().max(5000).optional(),
  })
  .strict();
