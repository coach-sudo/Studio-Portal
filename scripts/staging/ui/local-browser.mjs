/* global localStorage */
import { URL } from "node:url";
// Built candidate + native PG/RLS/wrappers. Authentication/perimeter and the
// PostgREST HTTP compatibility adapter are LOCAL STUBS, never hosted evidence.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, sep, extname } from "node:path";
import { chromium } from "@playwright/test";
import { plan, authIds } from "./policy.mjs";
import { networkRead } from "./network.mjs";
import { UiBrowserDriver } from "./browser.mjs";
export async function localBrowser({ e, transport, dist, output }) {
  const root = resolve(dist);
  assert(existsSync(root + "/index.html"));
  e.assets = new Set(
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((x) => x.isFile())
      .map(
        (x) =>
          "/" +
          resolve(x.parentPath, x.name)
            .slice(root.length + 1)
            .replaceAll("\\", "/"),
      ),
  );
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1"),
      file = resolve(root, "." + decodeURIComponent(url.pathname));
    assert(file === root || file.startsWith(root + sep));
    const path =
      existsSync(file) && extname(file) ? file : root + "/index.html";
    const mime =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".json": "application/json",
      }[extname(path)] || "application/octet-stream";
    res.writeHead(200, { "content-type": mime });
    res.end(readFileSync(path));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const contexts = {};
  try {
    for (const [role, id] of Object.entries(authIds)) {
      const context = await browser.newContext({
        serviceWorkers: "block",
        timezoneId: "America/New_York",
        viewport: { width: 1440, height: 1000 },
      });
      const session = {
        access_token: transport.token(role),
        refresh_token: "local-stub-only",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        expires_in: 3600,
        token_type: "bearer",
        user: {
          id,
          email: plan.accounts[role].email,
          role: "authenticated",
          aud: "authenticated",
          app_metadata: {},
          user_metadata: {},
        },
      };
      await context.addInitScript(
        ({ key, session }) => {
          localStorage.setItem(key, JSON.stringify(session));
        },
        { key: `sb-${plan.target.project}-auth-token`, session },
      );
      contexts[role] = context;
    }
    const target = { origin, project: plan.target.project };
    const readRequest = async (route, role) => {
      const r = route.request(),
        u = new URL(r.url()),
        body = r.method() === "POST" ? r.postDataJSON() : undefined;
      assert(
        networkRead(r.method(), r.url(), body, target, e),
        "Unexpected local browser request: " + r.method() + " " + u.pathname,
      );
      e.read();
      if (u.hostname === plan.target.project + ".supabase.co")
        return route.fulfill(await transport.read(r, role));
      if (u.pathname === "/api/v2/lessons") {
        const reply = await transport.send(u.pathname, body, role);
        return route.fulfill({
          status: reply.status,
          contentType: "application/json",
          body: JSON.stringify(reply.body),
        });
      }
      if (u.pathname === "/api/invoices")
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: "[]",
        }); // Empty invoices are independently asserted by the PG baseline.
      if (u.pathname.endsWith("/delivery"))
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ calendar: null, messages: [] }),
        }); // Delivery is forbidden, this adapter does not simulate it.
      assert(!u.pathname.startsWith("/api/"), "Unsupported local read adapter");
      await route.continue();
    };
    const driver = new UiBrowserDriver({
      executor: e,
      contexts,
      origin,
      readRequest,
      output,
    });
    await driver.initialize();
    return {
      driver,
      close: async () => {
        await browser.close();
        await new Promise((r) => server.close(r));
      },
    };
  } catch (error) {
    await browser.close();
    await new Promise((r) => server.close(r));
    throw error;
  }
}
