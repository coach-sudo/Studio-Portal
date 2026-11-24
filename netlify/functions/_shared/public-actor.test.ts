import type { Context } from "@netlify/functions";
import { beforeEach, expect, it, vi } from "vitest";
import handler from "../public-actor";

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  signed: vi.fn(async (_path: string, _expiry: number) => ({
    data: { signedUrl: "https://assets.example.test/signed" },
  })),
}));
vi.mock("./supabase", () => ({
  serviceClient: () => ({
    from: (table: string) => {
      let rows = [...(db.tables[table] ?? [])];
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => {
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        is: (key: string, value: null) => query.eq(key, value),
        in: (key: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[key]));
          return query;
        },
        single: async () => ({
          data: rows.length === 1 ? rows[0] : null,
          error: rows.length === 1 ? null : new Error("Missing fixture row"),
        }),
        order: async () => ({ data: rows, error: null }),
      };
      return query;
    },
    storage: { from: () => ({ createSignedUrl: db.signed }) },
  }),
}));

const materialId = "11111111-1111-4111-8111-111111111111";
const otherMedia = "22222222-2222-4222-8222-222222222222";
const photo = {
  id: materialId,
  title: "Released portrait",
  category: "Headshot",
  caption: "Approved caption",
  storage_path: "synthetic/release/portrait",
  external_url: null,
  mime_type: "image/jpeg",
  media_kind: "image",
};
const revision = () => db.tables.actor_profile_revisions[0];
const content = () => revision().content as Record<string, unknown>;
const profile = () => db.tables.actor_profiles[0];
const student = () => db.tables.students[0];
const media = () => db.tables.materials[0];
const request = (method = "GET") =>
  handler(
    new Request("https://example.test/api/v2/public/actors/fixture", {
      method,
    }),
    {
      params: { slug: "fixture" },
      requestId: "synthetic",
    } as unknown as Context,
  );

beforeEach(() => {
  db.signed.mockClear();
  db.tables = {
    actor_profiles: [
      {
        id: "profile",
        student_id: "student",
        status: "published",
        published_revision_id: "revision",
        slug: "fixture",
        display_name: "Mutable draft name",
        bio: "Mutable draft text",
      },
    ],
    actor_profile_revisions: [
      {
        id: "revision",
        actor_profile_id: "profile",
        published_at: "2026-11-23T15:00:00Z",
        content: {
          displayName: "Released name",
          bio: "Released biography",
          focusArea: "Private coaching",
          contactEmail: "hidden@example.test",
          contactPhone: "+1 202 555 0123",
          showEmail: false,
          showPhone: false,
          materialIds: [materialId],
          materialSnapshot: [photo],
          primaryHeadshotMaterialId: materialId,
          presentation: {
            version: 1,
            layout: "classic",
            sections: ["biography", "headshots", "credits", "skills", "media"],
            coachOnly: "private",
          },
        },
      },
    ],
    students: [
      {
        id: "student",
        studio_id: "studio",
        actor_page_eligible: true,
        deleted_at: null,
        focus_area: "Private focus",
      },
    ],
    studios: [
      {
        id: "studio",
        name: "Synthetic Studio",
        settings: {
          branding: {
            primaryColor: "#265A48",
            logoStoragePath: "synthetic/logo",
            coachProfilePhotoUrl: "https://example.test/private",
            internal: "secret metadata",
          },
          actorPageCta: {
            label: "Studio booking",
            url: "/book",
            internal: "private",
          },
        },
      },
    ],
    materials: [
      {
        ...photo,
        title: "Changed since publication",
        owner_student_id: "student",
        status: "active",
        approval_status: "approved",
        public_embed: true,
      },
      {
        ...photo,
        id: otherMedia,
        owner_student_id: "student",
        status: "active",
        approval_status: "approved",
        public_embed: true,
      },
    ],
  };
});

it("returns only the public revision and allowlisted nested fields", async () => {
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({
    displayName: "Released name",
    bio: "Released biography",
    primaryHeadshotMaterialId: materialId,
    presentation: {
      version: 1,
      layout: "classic",
      sections: ["biography", "headshots", "credits", "skills", "media"],
    },
    studio: {
      name: "Synthetic Studio",
      branding: {
        primaryColor: "#265A48",
        logoUrl: "https://assets.example.test/signed",
      },
      actorCta: { label: "Studio booking", url: "/book" },
    },
    slug: "fixture",
    showEmail: false,
    showPhone: false,
    publishedAt: "2026-11-23T15:00:00Z",
    materials: [
      {
        id: materialId,
        title: photo.title,
        category: photo.category,
        caption: photo.caption,
        mime_type: photo.mime_type,
        media_kind: photo.media_kind,
        url: "https://assets.example.test/signed",
      },
    ],
  });
  expect(db.signed).toHaveBeenCalledWith(photo.storage_path, 3600);
});

it.each([undefined, false, "true", "false"])(
  "omits contact values if visibility is %s",
  async (flag) => {
    content().showEmail = flag;
    content().showPhone = flag;
    const result = await (await request()).json();
    expect(result).not.toHaveProperty("contactEmail");
    expect(result).not.toHaveProperty("contactPhone");
  },
);

it("includes valid contact values explicitly approved in the revision", async () => {
  content().showEmail = true;
  content().showPhone = true;
  expect(await (await request()).json()).toMatchObject({
    contactEmail: "hidden@example.test",
    showEmail: true,
    contactPhone: "+1 202 555 0123",
    showPhone: true,
  });
});

it.each(["", undefined])(
  "keeps the published biography empty for %s",
  async (bio) => {
    content().bio = bio;
    expect(await (await request()).json()).toMatchObject({ bio: "" });
  },
);

it("keeps a valid legacy revision text-only without an asset snapshot", async () => {
  delete content().materialSnapshot;
  expect(await (await request()).json()).toMatchObject({
    displayName: "Released name",
    bio: "Released biography",
    materials: [],
  });
  expect(db.signed).not.toHaveBeenCalledWith(
    photo.storage_path,
    expect.anything(),
  );
});

it("serves an authorized external reel with its published metadata", async () => {
  const reel = {
    ...photo,
    storage_path: null,
    external_url: "https://youtu.be/synthetic",
    media_kind: "link",
  };
  content().materialSnapshot = [reel];
  Object.assign(media(), reel);
  expect(await (await request()).json()).toMatchObject({
    materials: [{ id: materialId, url: reel.external_url, media_kind: "link" }],
  });
});

it.each([
  ["visibility revoked", { public_embed: false }],
  ["approval revoked", { approval_status: "pending_review" }],
  ["asset archived", { status: "archived" }],
  ["ownership changed", { owner_student_id: "other" }],
  ["asset replaced", { storage_path: "synthetic/replacement" }],
])("omits a published asset when %s", async (_label, changes) => {
  Object.assign(media(), changes);
  expect(await (await request()).json()).toMatchObject({ materials: [] });
  expect(db.signed).not.toHaveBeenCalledWith(
    photo.storage_path,
    expect.anything(),
  );
});

it.each([
  [
    "unpublished",
    () => {
      profile().status = "changes_requested";
    },
  ],
  [
    "no published pointer",
    () => {
      profile().published_revision_id = null;
    },
  ],
  [
    "wrong revision owner",
    () => {
      revision().actor_profile_id = "other";
    },
  ],
  [
    "missing revision",
    () => {
      db.tables.actor_profile_revisions = [];
    },
  ],
  [
    "invalid published identity",
    () => {
      delete content().displayName;
    },
  ],
  [
    "eligibility revoked",
    () => {
      student().actor_page_eligible = false;
    },
  ],
  [
    "student removed",
    () => {
      student().deleted_at = "2026-11-23T15:00:00Z";
    },
  ],
] as const)("fails closed for %s", async (_label, change) => {
  change();
  const response = await request();
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  expect(db.signed).not.toHaveBeenCalled();
});

it("allows only GET", async () => {
  expect((await request("POST")).status).toBe(405);
});
