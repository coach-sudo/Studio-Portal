import { expect, test, type Route } from "@playwright/test";
import { createServer } from "node:http";
import { ids, installFixture } from "./fixture";

test("an uploaded object survives an interrupted attachment without another transfer", async ({
  page,
  context,
}, info) => {
  await installFixture(context, "coach", { coach: "Candidate Coach" });
  const assetId = "70000000-0000-4000-8000-000000000099";
  let uploads = 0;
  let attaches = 0;
  let attachedAsset: unknown;
  let storagePath = "";
  let received: { body: string; contentType: string; upsert?: string };
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      },
      body: JSON.stringify(body),
    });
  await page.route("http://127.0.0.1:54399/storage/v1/object/**", (route) => {
    if (route.request().url().includes("/object/sign/"))
      return json(route, { signedURL: "/object/sign/synthetic" });
    return route.continue();
  });
  await page.route("http://127.0.0.1:54399/rest/v1/file_assets*", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return json(route, null);
    if (request.method() === "GET") return json(route, []);
    storagePath = request.postDataJSON().storage_path;
    return json(route, { id: assetId, storage_path: storagePath });
  });
  await page.route("**/api/v2/materials", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON();
    if (body.command !== "resource_attach_file") return route.fallback();
    attaches += 1;
    expect(body.payload.studentId).toBe(ids.student);
    expect(body.payload.lessonId).toBe(ids.lesson);
    attachedAsset = body.payload.fileAssetId;
    return attaches === 1
      ? json(route, { error: "Synthetic interruption" }, 503)
      : json(route, { resource: { id: assetId } });
  });

  const storage = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "*");
    response.setHeader("access-control-allow-methods", "POST, OPTIONS");
    if (!request.url?.startsWith("/storage/v1/object/studio-materials/")) {
      response.writeHead(404).end();
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    uploads += 1;
    received = {
      body: Buffer.concat(chunks).toString("utf8"),
      contentType: request.headers["content-type"] || "",
      upsert: String(request.headers["x-upsert"]),
    };
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ Id: assetId, Key: storagePath }));
  });
  await new Promise<void>((resolve, reject) => {
    storage.once("error", reject);
    storage.listen(54399, "127.0.0.1", resolve);
  });
  try {
    await page.goto(`/coach/students/${ids.student}/lessons/${ids.lesson}`);
    await page
      .getByRole("button", { name: "Attach files", exact: true })
      .click();
    const upload = page.getByRole("dialog", { name: "Attach files to lesson" });
    await upload.getByLabel("Choose files").setInputFiles({
      name: "Practice prompt.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Synthetic script attachment."),
    });
    await upload
      .getByRole("button", { name: "Attach files", exact: true })
      .click();
    await expect(upload.getByRole("alert")).toContainText("File uploaded.");
    await page.screenshot({
      path: info.outputPath("upload-attachment-retry.png"),
      animations: "disabled",
    });
    expect(attachedAsset).toBe(assetId);
    await upload.getByRole("button", { name: "Retry remaining files" }).click();
    await expect(upload.getByRole("status")).toHaveText(
      "1 of 1 files attached.",
    );
    expect(attaches).toBe(2);
    expect(uploads).toBe(1);
    expect(received!.contentType).toContain("multipart/form-data;");
    expect(received!.body).toContain("Synthetic script attachment.");
    expect(received!.upsert).toBe("false");
  } finally {
    storage.closeAllConnections();
    await new Promise<void>((resolve) => storage.close(() => resolve()));
  }
});
