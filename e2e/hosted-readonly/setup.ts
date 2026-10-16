import { chromium } from "@playwright/test";
import {
  acceptanceDirectory,
  credentials,
  guardContext,
  perimeter,
  privateJson,
  statePath,
  roleState,
  verifyPrivateDirectory,
  verifyRelease,
  checkedRequest,
  roleHeaders,
  hostedAcceptance,
} from "../support/hostedReadOnly";

export default async function setup() {
  verifyPrivateDirectory();
  const accounts = (await credentials()).accounts;
  const browser = await chromium.launch();
  let anonKey = "";
  try {
    if (process.env.HOSTED_REUSE_SESSIONS === "true") {
      for (const role of [
        "coach",
        "student",
        "guardian",
        "unrelated",
      ] as const) {
        const context = await browser.newContext({
          storageState: await roleState(role),
        });
        try {
          await verifyRelease(context.request);
          let response = await checkedRequest(
            context.request,
            "GET",
            `https://${hostedAcceptance.project}.supabase.co/auth/v1/user`,
            { headers: await roleHeaders(role) },
          );
          if (!response.ok() && process.env.HOSTED_REAUTH_ROLE === role) {
            const token = await checkedRequest(
              context.request,
              "POST",
              `https://${hostedAcceptance.project}.supabase.co/auth/v1/token?grant_type=password`,
              {
                headers: { apikey: (await roleHeaders(role)).apikey },
                data: {
                  email: accounts[role].email,
                  password: accounts[role].password,
                },
              },
            );
            if (!token.ok())
              throw Error("Explicit synthetic session reauthentication failed");
            const session = await token.json();
            if (session.user?.id !== accounts[role].id)
              throw Error("Reauthentication identity mismatch");
            await privateJson(`${role}.json`, {
              ...(await perimeter()),
              origins: [
                {
                  origin: hostedAcceptance.origin,
                  localStorage: [
                    {
                      name: `sb-${hostedAcceptance.project}-auth-token`,
                      value: JSON.stringify(session),
                    },
                  ],
                },
              ],
            });
            response = await checkedRequest(
              context.request,
              "GET",
              `https://${hostedAcceptance.project}.supabase.co/auth/v1/user`,
              { headers: await roleHeaders(role) },
            );
          }
          if (
            !response.ok() ||
            (await response.json()).id !== accounts[role].id
          )
            throw Error(
              "Existing synthetic session unavailable; repeat approved password login setup",
            );
        } finally {
          await context.close();
        }
      }
      console.log(
        "Four separate existing sessions and protected immutable release verified",
      );
      return;
    }
    for (const role of ["coach", "student", "guardian"] as const) {
      const context = await browser.newContext({
        baseURL: hostedAcceptance.origin,
        storageState: await perimeter(),
        serviceWorkers: "block",
      });
      try {
        await verifyRelease(context.request);
        const blocked = await guardContext(context);
        context.on("request", (req) => {
          if (
            new URL(req.url()).origin ===
            `https://${hostedAcceptance.project}.supabase.co`
          )
            anonKey ||= req.headers().apikey || "";
        });
        const page = await context.newPage();
        await page.goto("/login");
        await page
          .getByLabel("Email or username", { exact: true })
          .fill(accounts[role].email);
        await page
          .getByLabel("Password", { exact: true })
          .fill(accounts[role].password);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await page.waitForURL(
          role === "coach" ? /\/coach(?:\/|$)/ : /\/portal(?:\/|$)/,
        );
        await page.locator("main").waitFor();
        const id = await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) || "null")?.user?.id,
          `sb-${hostedAcceptance.project}-auth-token`,
        );
        if (id !== accounts[role].id || blocked.length)
          throw Error("Login identity or network isolation failed");
        const raw = await context.storageState();
        const appOrigin = raw.origins.find(
          (x) => x.origin === hostedAcceptance.origin,
        );
        if (!appOrigin) throw Error("Missing application session");
        await privateJson(`${role}.json`, {
          ...(await perimeter()),
          origins: [
            {
              origin: appOrigin.origin,
              localStorage: appOrigin.localStorage.filter(
                (x) => x.name === `sb-${hostedAcceptance.project}-auth-token`,
              ),
            },
          ],
        });
        console.log(
          `${role}: existing synthetic password login and expected identity passed`,
        );
      } catch {
        throw Error(
          `Protected ${role} login failed; credential-bearing details suppressed`,
        );
      } finally {
        await context.close();
      }
    }
    if (!anonKey) throw Error("Staging public API key unavailable");
    const publicClaims = JSON.parse(
      Buffer.from(anonKey.split(".")[1] || "", "base64url").toString(),
    );
    if (
      publicClaims.role !== "anon" ||
      publicClaims.ref !== hostedAcceptance.project
    )
      throw Error("Browser API key is not the expected staging anon key");
    await privateJson("public-config.json", { anonKey });
    const context = await browser.newContext({
      baseURL: hostedAcceptance.origin,
      storageState: await perimeter(),
      serviceWorkers: "block",
    });
    try {
      await verifyRelease(context.request);
      // Unrelated Auth identity exists but intentionally has no portal membership.
      const denied = await checkedRequest(
        context.request,
        "POST",
        "/api/v2/auth/login",
        {
          data: {
            username: accounts.unrelated.email,
            password: accounts.unrelated.password,
          },
        },
      );
      if (denied.status() !== 403)
        throw Error("Unrelated portal login did not deny access");
      const response = await checkedRequest(
        context.request,
        "POST",
        `https://${hostedAcceptance.project}.supabase.co/auth/v1/token?grant_type=password`,
        {
          headers: { apikey: anonKey },
          data: {
            email: accounts.unrelated.email,
            password: accounts.unrelated.password,
          },
        },
      );
      if (!response.ok())
        throw Error("Unrelated synthetic Auth identity unavailable");
      const session = await response.json();
      if (session.user?.id !== accounts.unrelated.id)
        throw Error("Unrelated synthetic identity mismatch");
      await privateJson("unrelated.json", {
        ...(await perimeter()),
        origins: [
          {
            origin: hostedAcceptance.origin,
            localStorage: [
              {
                name: `sb-${hostedAcceptance.project}-auth-token`,
                value: JSON.stringify(session),
              },
            ],
          },
        ],
      });
      await privateJson("login-evidence.json", {
        application: hostedAcceptance.commit,
        roles: ["coach", "student", "guardian"],
        unrelatedPortalStatus: denied.status(),
        unrelatedAuthConfirmed: true,
        privateStateDirectory: acceptanceDirectory,
        stateFiles: [
          statePath("coach"),
          statePath("student"),
          statePath("guardian"),
          statePath("unrelated"),
        ],
      });
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
