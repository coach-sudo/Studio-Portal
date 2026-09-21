import { readFile } from "node:fs/promises";
import path from "node:path";

export type FixtureRole =
  "coach" | "student" | "guardian" | "unrelated" | "signout";

export interface E2ERuntime {
  runId: string;
  baseURL: string;
  fixtureReady: boolean;
  blockedReason?: string;
  accounts?: Record<
    FixtureRole,
    { username: string; email: string; password: string }
  >;
  ids?: Record<string, string>;
  actorSlug?: string;
  capabilities?: { google: boolean; stripeTest: boolean };
}

export const authDirectory = path.resolve("playwright/.auth");
export const runtimePath = path.join(authDirectory, "runtime.json");

export async function readRuntime(): Promise<E2ERuntime> {
  return JSON.parse(await readFile(runtimePath, "utf8")) as E2ERuntime;
}

export function storageStatePath(role: FixtureRole) {
  return path.join(authDirectory, `${role}.json`);
}
