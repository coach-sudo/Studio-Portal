import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  test as base,
  expect,
  type BrowserContext,
  type APIRequestContext,
} from "@playwright/test";
import {
  privatePath,
  perimeterState,
} from "../../scripts/staging/protected-browser.mjs";
import {
  allowedHostedRequest,
  assertHostedAcceptanceTarget,
  hostedAcceptance,
} from "../../src/security/hostedAcceptance";

assertHostedAcceptanceTarget(process.env.STAGING_BASE_URL || "");
if (process.env.HOSTED_READ_ONLY !== "true")
  throw Error("Explicit HOSTED_READ_ONLY=true required");
export const acceptanceDirectory = privatePath(
  process.env.HOSTED_ACCEPTANCE_DIRECTORY || "",
);
export type Role = "coach" | "student" | "guardian" | "unrelated";
export const statePath = (role: Role) =>
  join(acceptanceDirectory, `${role}.json`);
export const privateJson = async (name: string, data: unknown) =>
  writeFile(join(acceptanceDirectory, name), JSON.stringify(data, null, 2), {
    mode: 0o600,
  });

function parsePrivate(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    throw Error("Private authentication data is invalid; contents suppressed");
  }
}

export async function credentials() {
  const value = parsePrivate(
    await readFile(
      privatePath(process.env.HOSTED_CREDENTIALS_FILE || ""),
      "utf8",
    ),
  );
  if (
    value.project !== hostedAcceptance.project ||
    value.studio !== hostedAcceptance.studio
  )
    throw Error("Wrong synthetic credential project/studio");
  for (const role of ["coach", "student", "guardian", "unrelated"] as Role[]) {
    const a = value.accounts?.[role];
    if (
      !a?.email?.endsWith("@coachd-staging.example.test") ||
      !a.password ||
      !a.id
    )
      throw Error("Missing existing synthetic identity");
  }
  return value as {
    accounts: Record<Role, { id: string; email: string; password: string }>;
  };
}

export function verifyPrivateDirectory() {
  if (process.platform === "win32") {
    const script =
      "$a=Get-Acl -LiteralPath $env:HOSTED_ACCEPTANCE_PRIVATE_DIR; $u=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $bad=@($a.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin @($u,'S-1-5-18') }); if($bad.Count){exit 1}";
    execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
      stdio: "ignore",
      env: {
        ...process.env,
        HOSTED_ACCEPTANCE_PRIVATE_DIR: acceptanceDirectory,
      },
    });
  } else {
    // The runner is deliberately Windows-only until equivalent POSIX ACL checks are reviewed.
    throw Error(
      "Private-directory ACL verification requires this reviewed Windows runner",
    );
  }
}

export async function perimeter() {
  return perimeterState(
    parsePrivate(
      await readFile(join(acceptanceDirectory, "perimeter.json"), "utf8"),
    ),
    hostedAcceptance.origin,
  );
}

export async function roleState(role: Role) {
  const raw = parsePrivate(await readFile(statePath(role), "utf8"));
  const protectedState = perimeterState(raw, hostedAcceptance.origin);
  const origin = raw.origins?.[0];
  const key = `sb-${hostedAcceptance.project}-auth-token`;
  if (
    raw.origins?.length !== 1 ||
    origin?.origin !== hostedAcceptance.origin ||
    origin.localStorage?.length !== 1 ||
    origin.localStorage[0].name !== key ||
    raw.cookies.length !== protectedState.cookies.length
  )
    throw Error(
      "Application state contains unreviewed origins, cookies or storage",
    );
  const session = parsePrivate(origin.localStorage[0].value);
  if (session.user?.id !== (await credentials()).accounts[role].id)
    throw Error("Stored application identity changed");
  return { ...protectedState, origins: [origin] };
}

export async function checkedRequest(
  api: APIRequestContext,
  method: "GET" | "POST",
  path: string,
  options: { data?: unknown; headers?: Record<string, string> } = {},
) {
  const url = new URL(path, hostedAcceptance.origin).href;
  if (!allowedHostedRequest(method, url))
    throw Error("Read-only API perimeter rejected request");
  try {
    return await api.fetch(url, { method, ...options, maxRedirects: 0 });
  } catch {
    throw Error(
      "Protected request failed; credential-bearing diagnostics suppressed",
    );
  }
}

export async function verifyRelease(api: APIRequestContext) {
  const response = await checkedRequest(api, "GET", "/api/healthz");
  if (!response.ok()) throw Error("Protected deployment session unavailable");
  const body = await response.json();
  if (
    body.release?.context !== "deploy-preview" ||
    body.release?.commit !== hostedAcceptance.commit.slice(0, 12)
  )
    throw Error("Immutable deployment identity changed");
}

export async function guardContext(context: BrowserContext) {
  const blocked: { method: string; origin: string; path: string }[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (allowedHostedRequest(request.method(), request.url()))
      return route.continue();
    const url = new URL(request.url());
    // Only sanitized endpoint identity is retained, never headers, query values or bodies.
    blocked.push({
      method: request.method(),
      origin: url.origin,
      path: url.pathname,
    });
    return route.abort("blockedbyclient");
  });
  await context.routeWebSocket("**/*", (socket) => {
    blocked.push({
      method: "WS",
      origin: new URL(socket.url()).origin,
      path: new URL(socket.url()).pathname,
    });
    socket.close();
  });
  return blocked;
}

export async function roleHeaders(role: Role) {
  const state = await roleState(role);
  const session = parsePrivate(
    state.origins[0].localStorage.find(
      (x: { name: string }) =>
        x.name === `sb-${hostedAcceptance.project}-auth-token`,
    ).value,
  );
  const config = parsePrivate(
    await readFile(join(acceptanceDirectory, "public-config.json"), "utf8"),
  );
  const claims = parsePrivate(
    Buffer.from(config.anonKey.split(".")[1] || "", "base64url").toString(),
  );
  if (claims.role !== "anon" || claims.ref !== hostedAcceptance.project)
    throw Error("Unexpected public API key identity");
  return {
    apikey: config.anonKey as string,
    authorization: `Bearer ${session.access_token}`,
  };
}

export const test = base.extend<{
  role: Role;
  expectedBlockedPaths: string[];
  guard: Awaited<ReturnType<typeof guardContext>>;
}>({
  role: ["student", { option: true }],
  expectedBlockedPaths: [[], { option: true }],
  storageState: async ({ role }, use) => use(await roleState(role)),
  guard: [
    async ({ context, expectedBlockedPaths }, use, testInfo) => {
      await verifyRelease(context.request);
      const blocked = await guardContext(context);
      await use(blocked);
      if (blocked.length) {
        await privateJson(
          `blocked-${testInfo.testId.replace(/[^\w-]/g, "")}-${testInfo.project.name}.json`,
          blocked,
        );
        const expected = blocked.filter(
          (b) =>
            b.origin === hostedAcceptance.origin &&
            ((b.method === "GET" && b.path === "/api/v2/health") ||
              expectedBlockedPaths.includes(b.path)),
        );
        for (const request of expected)
          testInfo.annotations.push({
            type: "blocked-boundary",
            description: `${request.method} ${request.path}: deliberately prevented; this endpoint was not tested`,
          });
        expect(
          blocked.filter((b) => !expected.includes(b)),
          "Unexpected requests were blocked before transmission",
        ).toEqual([]);
      }
    },
    { auto: true },
  ],
});
export { expect, hostedAcceptance };
