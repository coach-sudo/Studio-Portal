import fs from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => fs.readFileSync(path, "utf8");

describe("v2 server module boundaries", () => {
  it("keeps the entrypoint focused on validation, context, dispatch, and response construction", () => {
    const entrypoint = read("netlify/functions/v2.ts");
    expect(entrypoint.split(/\r?\n/).length).toBeLessThan(260);
    expect(entrypoint).toContain("parseCommand(domain");
    expect(entrypoint).toContain("for (const handler of commandHandlers)");
    expect(entrypoint).not.toContain('domain === "students" &&');
    expect(entrypoint).not.toContain('domain === "finance" &&');
  });

  it.each([
    ["students", "handleStudentsCommands"],
    ["lessons", "handleLessonsCommands"],
    ["work", "handleWorkCommands"],
    ["messaging", "handleMessagingCommands"],
    ["finance", "handleFinanceCommands"],
    ["administration", "handleAdministrationCommands"],
  ])("routes %s commands through its domain handler", (module, handler) => {
    expect(read(`netlify/functions/_v2/${module}.ts`)).toContain(
      `export async function ${handler}`,
    );
  });

  it("parameterizes browser and server Supabase factories with generated types", () => {
    expect(read("src/lib/supabase.ts")).toContain("createClient<Database>");
    const server = read("netlify/functions/_shared/supabase.ts");
    expect(server.match(/createClient<Database>/g)).toHaveLength(2);
  });
});
