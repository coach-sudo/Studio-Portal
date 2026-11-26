import { expect, test, type Route } from "@playwright/test";
import { ids, installFixture } from "./fixture";

test("assignment attachment retries reuse the uploaded file and gate submission", async ({
  page,
  context,
}, info) => {
  const fixture = await installFixture(context, "student");
  const assignmentId = "70000000-0000-4000-8000-000000000101";
  fixture.assignments.push({
    id: assignmentId,
    student_id: ids.student,
    title: "Synthetic rehearsal response",
    details: "Attach a practice script.",
    status: "assigned",
    activity_type: "instruction",
    version: 1,
    updated_at: "2030-11-26T12:00:00.000Z",
  });
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "*",
      },
      body: JSON.stringify(body),
    });
  const asset = {
    id: "70000000-0000-4000-8000-000000000102",
    storage_path: "",
    original_name: "Synthetic practice.txt",
    mime_type: "text/plain",
    file_size_bytes: 32,
    submitted_at: null,
  };
  let uploadCount = 0;
  let attachCount = 0;
  let attached = false;
  await page.route(
    "**/storage/v1/object/assignment-attachments/**",
    (route) => {
      if (route.request().method() === "OPTIONS") return json(route, {});
      uploadCount++;
      const path = new URL(route.request().url()).pathname;
      asset.storage_path = path.split("/assignment-attachments/")[1];
      expect(asset.storage_path).toMatch(
        new RegExp(
          `^${ids.studio}/${ids.student}/${assignmentId}/sha256-[a-f0-9]{64}$`,
        ),
      );
      return json(route, { Id: asset.id, Key: asset.storage_path });
    },
  );
  await page.route("**/rest/v1/rpc/attach_assignment_file", (route) => {
    if (route.request().method() === "OPTIONS") return json(route, {});
    attachCount++;
    const payload = route.request().postDataJSON();
    expect(payload.p_assignment).toBe(assignmentId);
    expect(asset.storage_path.endsWith(payload.p_hash)).toBe(true);
    if (attachCount === 1)
      return json(
        route,
        { message: "Synthetic interrupted acknowledgment" },
        503,
      );
    attached = true;
    return json(route, asset);
  });
  await page.route("**/rest/v1/assignment_attachments?**", (route) => {
    if (route.request().method() === "OPTIONS") return json(route, {});
    expect(
      new URL(route.request().url()).searchParams.get("assignment_id"),
    ).toBe(`eq.${assignmentId}`);
    return json(route, attached ? [asset] : []);
  });

  await page.goto(`/portal/work?student=${ids.student}&view=homework`);
  const assignment = page.locator(".assignment-card").filter({
    hasText: "Synthetic rehearsal response",
  });
  const submit = assignment.getByRole("button", { name: "Complete & archive" });
  await assignment
    .getByRole("button", { name: "Assignment files", exact: true })
    .click();
  await assignment.getByLabel("Choose an assignment file").setInputFiles({
    name: asset.original_name,
    mimeType: asset.mime_type,
    buffer: Buffer.from("Synthetic assignment file bytes."),
  });
  await expect(submit).toBeDisabled();
  await assignment
    .getByRole("button", { name: "Attach file", exact: true })
    .click();
  await expect(assignment.getByRole("alert")).toContainText(
    "The upload was retained for retry.",
  );
  await page.screenshot({
    path: info.outputPath("assignment-attachment-retry.png"),
    animations: "disabled",
  });
  await expect(submit).toBeDisabled();
  await assignment.getByRole("button", { name: "Retry attachment" }).click();
  await expect(
    assignment.getByText(asset.original_name, { exact: false }),
  ).toBeVisible();
  await expect(
    assignment.getByText("File attached.", { exact: true }),
  ).toBeVisible();
  await expect(submit).toBeEnabled();
  expect(uploadCount).toBe(1);
  expect(attachCount).toBe(2);
  expect(fixture.commands).not.toContain("complete");
});
