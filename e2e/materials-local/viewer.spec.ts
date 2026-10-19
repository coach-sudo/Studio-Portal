import { test, expect, type Page } from "@playwright/test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import AxeBuilder from "@axe-core/playwright";
import type { StudyRecord } from "../../src/domain/library";

test("PDF reading, search, zoom, private saves, recovery and responsive controls", async ({
  page,
}) => {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage([500, 600])
    .drawText("First page for rehearsal", { font, size: 18, x: 25, y: 550 });
  pdf.addPage([500, 600]).drawText("Second page: Shakespeare study", {
    font,
    size: 18,
    x: 25,
    y: 550,
  });
  const bytes = Buffer.from(await pdf.save());
  const notes: StudyRecord[] = [];
  let position: StudyRecord | null = null,
    signs = 0,
    saves = 0;
  const user = "e3100000-0000-4000-8000-000000000002";
  await page.addInitScript(
    ({ user }) => {
      const token =
        btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) +
        "." +
        btoa(
          JSON.stringify({ sub: user, role: "authenticated", exp: 4102444800 }),
        ) +
        ".local";
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "local",
          expires_at: 4102444800,
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: user,
            email: "local@example.test",
            aud: "authenticated",
            role: "authenticated",
          },
        }),
      );
    },
    { user },
  );
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const url = new URL(route.request().url()),
      body =
        route.request().method() === "POST"
          ? route.request().postDataJSON()
          : null;
    if (url.pathname === "/rest/v1/rpc/material_resource_workspace")
      return route.fulfill({
        json: {
          resource: {
            id: "e3400000-0000-4000-8000-000000000001",
            contentIdentity: "a".repeat(64),
          },
          assignment: null,
        },
      });
    if (url.pathname === "/storage/v1/object/sign/studio-materials") {
      signs++;
      expect(body.expiresIn).toBe(300);
      return route.fulfill({
        json: body.paths.map((path: string) => ({
          path,
          signedURL:
            "/object/sign/studio-materials/fixture?token=local" + signs,
        })),
      });
    }
    if (url.pathname === "/storage/v1/object/sign/studio-materials/fixture")
      return route.fulfill({
        status: signs === 1 ? 403 : 200,
        contentType: "application/pdf",
        body: signs === 1 ? "expired" : bytes,
      });
    if (url.pathname === "/rest/v1/material_study_state")
      return route.fulfill({ json: position });
    if (url.pathname === "/rest/v1/material_study_annotations")
      return route.fulfill({ json: notes });
    if (url.pathname === "/rest/v1/rpc/save_material_study") {
      saves++;
      const saved = {
        id: body.p_id,
        kind: body.p_kind,
        anchor: body.p_anchor,
        body: body.p_body,
        version: body.p_version + 1,
      };
      if (body.p_kind === "position") position = saved;
      else {
        const i = notes.findIndex((n) => n.id === saved.id);
        if (i >= 0) notes.splice(i, 1);
        notes.unshift(saved);
      }
      return route.fulfill({ json: saved });
    }
    throw new Error("Unapproved local test endpoint " + url.pathname);
  });
  await page.goto("/e2e/materials-local/index.html");
  await expect(
    page.getByRole("button", { name: "Next page", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("canvas")).toBeVisible();
  expect(signs).toBe(2);
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    page.getByRole("spinbutton", { name: "Page", exact: true }),
  ).toHaveValue("2");
  await page.getByLabel("Find in PDF", { exact: true }).fill("Shakespeare");
  await page.getByRole("button", { name: "Search PDF", exact: true }).click();
  await expect(
    page.getByText("1 matching pages", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page
    .getByLabel("Private note", { exact: true })
    .fill("My own rehearsal takeaway");
  const before = saves;
  await page.waitForTimeout(1500);
  expect(notes).toHaveLength(0);
  expect(saves - before).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(page.getByText("Note saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Bookmark", exact: true }).click();
  await expect(page.getByText("Bookmark saved", { exact: true })).toBeVisible();
  await expect.poll(() => position?.anchor.page).toBe(2);
  await page.reload();
  await expect(
    page.getByRole("spinbutton", { name: "Page", exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByText("My own rehearsal takeaway", { exact: true }),
  ).toBeVisible();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    await expect(page.locator(".private-study")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact || ""),
    ),
  ).toEqual([]);
});

async function prepareMedia(
  page: Page,
  kind: string,
  bytes: Buffer,
  mime: string,
) {
  const user = "e3100000-0000-4000-8000-000000000002";
  let position: StudyRecord | null = null,
    revoked = false,
    fileReads = 0;
  await page.addInitScript(
    ({ user }) => {
      const token =
        btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) +
        "." +
        btoa(
          JSON.stringify({ sub: user, role: "authenticated", exp: 4102444800 }),
        ) +
        ".local";
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: token,
          refresh_token: "local",
          expires_at: 4102444800,
          expires_in: 3600,
          token_type: "bearer",
          user: { id: user, aud: "authenticated", role: "authenticated" },
        }),
      );
    },
    { user },
  );
  await page.route("http://127.0.0.1:54321/**", async (route) => {
    const url = new URL(route.request().url()),
      body =
        route.request().method() === "POST"
          ? route.request().postDataJSON()
          : null;
    if (url.pathname === "/rest/v1/rpc/material_resource_workspace")
      return route.fulfill({
        json: revoked
          ? null
          : {
              resource: {
                id: "e3400000-0000-4000-8000-000000000001",
                contentIdentity: "a".repeat(64),
              },
              assignment: null,
            },
      });
    if (url.pathname === "/storage/v1/object/sign/studio-materials")
      return route.fulfill({
        json: body.paths.map((path: string) => ({
          path,
          signedURL: "/object/sign/studio-materials/fixture?token=local",
        })),
      });
    if (url.pathname === "/storage/v1/object/sign/studio-materials/fixture") {
      fileReads++;
      const range = route
        .request()
        .headers()
        .range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0,
        end = range?.[2]
          ? Math.min(Number(range[2]), bytes.length - 1)
          : bytes.length - 1;
      return route.fulfill({
        status: range ? 206 : 200,
        contentType: mime,
        body: bytes.subarray(start, end + 1),
        headers: {
          "accept-ranges": "bytes",
          "content-length": String(end - start + 1),
          ...(range
            ? { "content-range": `bytes ${start}-${end}/${bytes.length}` }
            : {}),
        },
      });
    }
    if (url.pathname === "/rest/v1/material_study_state")
      return route.fulfill({ json: position });
    if (url.pathname === "/rest/v1/material_study_annotations")
      return route.fulfill({ json: [] });
    if (url.pathname === "/rest/v1/rpc/save_material_study") {
      expect(body.p_kind).toBe("position");
      position = { anchor: body.p_anchor, version: body.p_version + 1 };
      return route.fulfill({ json: position });
    }
    throw Error("Unapproved local media endpoint " + url.pathname);
  });
  await page.goto("/e2e/materials-local/index.html?kind=" + kind);
  return {
    position: () => position,
    revoke: () => {
      revoked = true;
    },
    fileReads: () => fileReads,
  };
}

test("text search, paragraph resume, image zoom and unsafe SVG fallback", async ({
  page,
}) => {
  const pdfRequests: string[] = [];
  page.on("request", (r) => {
    if (/pdfjs|pdf\.worker|PdfReader/.test(new URL(r.url()).pathname))
      pdfRequests.push(new URL(r.url()).pathname);
  });
  const state = await prepareMedia(page, "text", Buffer.alloc(0), "text/plain");
  await page.getByLabel("Find in text", { exact: true }).fill("rehearsal");
  await expect(
    page.getByText("1 matching paragraphs", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next match", exact: true }).click();
  await expect.poll(() => state.position()?.anchor.paragraph).toBe(2);
  await page.reload();
  await expect(page.locator(".private-study")).toContainText("Paragraph 2");
  await page.unroute("http://127.0.0.1:54321/**");
  await prepareMedia(
    page,
    "image",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7l8AAAAASUVORK5CYII=",
      "base64",
    ),
    "image/png",
  );
  await expect(
    page.getByRole("img", { name: "Local study reader", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.getByText("125%", { exact: true })).toBeVisible();
  await page.unroute("http://127.0.0.1:54321/**");
  const svg = await prepareMedia(
    page,
    "unsupported",
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="window.badSvg=true"></svg>',
    ),
    "image/svg+xml",
  );
  await expect(
    page.getByText(
      "A preview is unavailable for this resource. You can open the original.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(svg.fileReads()).toBe(0);
  await expect(page.locator("iframe,object,embed,img")).toHaveCount(0);
  expect(pdfRequests).toEqual([]);
});

test("audio and video controls decode files and recover playback position", async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName === "webkit",
    "Windows WebKit native media bypasses Playwright's local HTTP mock; real signed-file playback requires protected staging.",
  );
  const rate = 8000,
    seconds = 3,
    pcm = Buffer.alloc(44 + rate * seconds * 2);
  pcm.write("RIFF");
  pcm.writeUInt32LE(pcm.length - 8, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(rate, 24);
  pcm.writeUInt32LE(rate * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(pcm.length - 44, 40);
  const state = await prepareMedia(page, "audio", pcm, "audio/wav");
  await expect(page.locator("audio")).toHaveAttribute("controls", "");
  await page.locator("audio").click({ position: { x: 20, y: 20 } });
  await expect
    .poll(() =>
      page.locator("audio").evaluate((a: HTMLAudioElement) => a.duration),
    )
    .toBe(3);
  await page.locator("audio").evaluate((a: HTMLAudioElement) => {
    a.pause();
    a.currentTime = 1.2;
    a.dispatchEvent(new Event("timeupdate"));
  });
  await expect.poll(() => state.position()?.anchor.seconds).toBe(1);
  await page.reload();
  await expect
    .poll(() =>
      page
        .locator("audio")
        .evaluate((a: HTMLAudioElement) => Math.floor(a.currentTime)),
    )
    .toBe(1);
  await page.unroute("http://127.0.0.1:54321/**");
  const movie = await page.evaluate(async () => {
    if (!MediaRecorder.isTypeSupported("video/mp4"))
      throw Error("MP4 fixture recorder unavailable");
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    const stream = c.captureStream(10),
      rec = new MediaRecorder(stream, { mimeType: "video/mp4" }),
      chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
    });
    rec.start();
    let frame = 0;
    const timer = setInterval(() => {
      ctx.fillStyle = frame++ % 2 ? "#123456" : "#abcdef";
      ctx.fillRect(0, 0, 64, 64);
    }, 80);
    await new Promise((r) => setTimeout(r, 1800));
    rec.stop();
    await done;
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    return Array.from(
      new Uint8Array(
        await new Blob(chunks, { type: "video/mp4" }).arrayBuffer(),
      ),
    );
  });
  await prepareMedia(page, "video", Buffer.from(movie), "video/mp4");
  await expect(page.locator("video")).toHaveAttribute("controls", "");
  await expect
    .poll(() =>
      page.locator("video").evaluate((v: HTMLVideoElement) => v.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  await expect(page.getByRole("link", { name: "Open original" })).toBeVisible();
});
