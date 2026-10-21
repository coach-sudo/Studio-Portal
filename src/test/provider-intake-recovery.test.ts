import { beforeEach, expect, it, vi } from "vitest";
import { scanGmail } from "../../netlify/functions/provider-intake";

const fixture = vi.hoisted(() => ({
  imports: [] as Record<string, unknown>[],
  writes: [] as string[],
}));
vi.mock("../../netlify/functions/_shared/supabase", () => ({
  serviceClient: () => ({
    from: (table: string) => {
      let externalId: string | undefined;
      const query = {
        select: () => query,
        eq: (key: string, value: string) => {
          if (key === "external_id") externalId = value;
          return query;
        },
        maybeSingle: async () => ({
          data: fixture.imports.find((row) => row.external_id === externalId),
          error: null,
        }),
        upsert: async (row: Record<string, unknown>) => {
          fixture.writes.push(table);
          fixture.imports.push(row);
          return { error: null };
        },
        update: () => query,
        then: (resolve: (value: unknown) => void) =>
          resolve({ data: [], error: null }),
      };
      return query;
    },
    rpc: vi.fn(() => {
      throw new Error("Unexpected financial mutation");
    }),
  }),
}));

const student = { id: "student", full_name: "Jules River", email: null };
const studio = { id: "studio", timezone: "America/New_York", settings: {} };
beforeEach(() => {
  fixture.imports.length = 0;
  fixture.writes.length = 0;
  vi.stubGlobal("Netlify", { env: { get: () => undefined } });
});
function providerMessage(text: string) {
  const fetch = vi.fn(async (url: string) => {
    expect(url).toMatch(
      /^https:\/\/gmail.googleapis.com\/gmail\/v1\/users\/me\/messages/,
    );
    return Response.json(
      url.includes("?format=full")
        ? {
            id: "mail-1",
            payload: {
              headers: [{ name: "Subject", value: text }],
              body: { data: Buffer.from(text).toString("base64url") },
            },
          }
        : { messages: [{ id: "mail-1" }] },
    );
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("reviews cancellation without guessing or creating a lesson", async () => {
  providerMessage("Your Lessonface lesson with Jules River was cancelled");
  await scanGmail("synthetic-token", studio, [student]);
  expect(fixture.imports[0]).toMatchObject({
    status: "needs_review",
    student_id: "student",
    payload: { changeType: "cancellation" },
  });
  expect(fixture.writes).toEqual(["integration_imports"]);
});

it("does not reopen a completed email review on a repeated worker scan", async () => {
  fixture.imports.push({
    external_id: "mail-1",
    status: "imported",
    lesson_id: "reviewed-lesson",
  });
  providerMessage("Your Lessonface lesson with Jules River was cancelled");
  await scanGmail("synthetic-token", studio, [student]);
  expect(fixture.writes).toEqual([]);
});

it("leaves shared guardian identity for review without creating a student", async () => {
  providerMessage(
    "Superprof lesson confirmed for Morgan Stone on Monday, November 2, 2031 at 1:00 PM",
  );
  await scanGmail("synthetic-token", studio, [
    { ...student, guardian_name: "Morgan Stone" },
    {
      ...student,
      id: "sibling",
      full_name: "Robin River",
      guardian_name: "Morgan Stone",
    },
  ]);
  expect(fixture.imports[0]).toMatchObject({
    detected_source: "superprof",
    status: "needs_review",
    student_id: null,
  });
  expect(fixture.writes).toEqual(["integration_imports"]);
});

it("reports missing Gmail read permission instead of a false successful scan", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json(
        { error: { message: "Insufficient permission" } },
        { status: 403 },
      ),
    ),
  );
  expect(await scanGmail("synthetic-token", studio, [])).toMatchObject({
    scope: false,
  });
  expect(fixture.writes).toEqual(["recommendations"]);
});
