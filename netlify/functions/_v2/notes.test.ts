import { beforeEach, describe, expect, it, vi } from "vitest";
import type { V2CommandContext } from "./types";
import { handleWorkCommands } from "./work";

const { serviceClient } = vi.hoisted(() => ({ serviceClient: vi.fn() }));
vi.mock("../_shared/supabase", () => ({ serviceClient }));

const noteId = "5a500000-0000-4000-8000-000000000001";
const saved = {
  id: noteId,
  student_id: "student",
  lesson_id: "lesson",
  title: "Lesson feedback",
  body: "Synthetic coaching observation",
  body_html: "<p>Synthetic coaching observation</p>",
  status: "draft",
  version: 1,
};

function draftCreate(existing?: typeof saved) {
  const insert = vi.fn(() => ({
    select: () => ({
      single: () => (existing ? { error: { code: "23505" } } : { data: saved }),
    }),
  }));
  const lookup = {
    eq: vi.fn(() => lookup),
    maybeSingle: vi.fn(() => ({ data: existing })),
  };
  const audit = vi.fn(() => "synthetic-audit");
  const context = {
    requireCoach: async () => "studio",
    audit,
    db: { from: () => ({ insert, select: () => lookup }) },
    domain: "notes",
    input: {
      command: "create",
      expectedVersion: 0,
      payload: {
        composerNoteId: noteId,
        studentId: saved.student_id,
        lessonId: saved.lesson_id,
        title: saved.title,
        body: saved.body,
        bodyHtml: saved.body_html,
        status: "draft",
      },
    },
  } as unknown as V2CommandContext;
  return { audit, context, insert, lookup };
}

describe("lesson note composer draft saves", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores the private draft and leaves recommendations alone", async () => {
    const { audit, context, insert } = draftCreate();
    const response = await handleWorkCommands(context);
    expect(await response?.json()).toMatchObject({
      resource: saved,
      queuedSideEffects: [],
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: noteId,
        status: "draft",
        published_at: null,
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      "studio",
      "note",
      noteId,
      "note.drafted",
      null,
      saved,
    );
    expect(serviceClient).not.toHaveBeenCalled();
  });

  it("defaults a create without a publication decision to a private draft", async () => {
    const { context, insert } = draftCreate();
    delete context.input.payload.status;
    await handleWorkCommands(context);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft", published_at: null }),
    );
    expect(serviceClient).not.toHaveBeenCalled();
  });

  it.each([undefined, "draft"])(
    "leaves the published revision intact for an update with status %s",
    async (status) => {
      const context = {
        requireCoach: async () => "studio",
        db: {
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    ...saved,
                    status: "published",
                    students: { studio_id: "studio" },
                  },
                }),
              }),
            }),
          }),
        },
        domain: "notes",
        input: {
          command: "update",
          entityId: noteId,
          expectedVersion: 1,
          payload: { body: "Unreviewed private edit", status },
        },
      } as unknown as V2CommandContext;
      await expect(handleWorkCommands(context)).rejects.toMatchObject({
        code: "REVIEW_REQUIRED",
      });
      expect(serviceClient).not.toHaveBeenCalled();
    },
  );

  it("recovers an interrupted insert only for the same scoped draft content", async () => {
    const { audit, context, lookup } = draftCreate(saved);
    const response = await handleWorkCommands(context);
    expect(await response?.json()).toMatchObject({ resource: saved });
    expect(lookup.eq.mock.calls).toEqual([
      ["id", noteId],
      ["student_id", saved.student_id],
      ["lesson_id", saved.lesson_id],
    ]);
    expect(audit).not.toHaveBeenCalled();
    const modified = draftCreate({
      ...saved,
      body: "Another edit",
      version: 2,
    });
    await expect(handleWorkCommands(modified.context)).rejects.toThrow(
      "VERSION_CONFLICT",
    );
  });
});
