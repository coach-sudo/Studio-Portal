import { expect, test } from "@playwright/test";

const widths = [320, 375, 390, 428, 768, 1024, 1280, 1440];
const portrait = "/synthetic-actor-portrait.svg";
const actorName = "Synthetic rehearsal portfolio";

for (const width of widths) {
  test(`private Actor Preview fits and returns to editing at ${width}px`, async ({
    page,
    context,
    baseURL,
  }, info) => {
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== baseURL) return route.abort();
      if (url.pathname === portrait)
        return route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 600"><rect width="480" height="600" fill="#dac9ae"/><circle cx="240" cy="230" r="100" fill="#6f5147"/><path d="M60 600V510a180 180 0 1 1 360 0v90" fill="#264a40"/></svg>',
        });
      return route.continue();
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    await page.setViewportSize({ width, height: width <= 428 ? 790 : 900 });
    await page.addInitScript(
      ({ origin, image, name }) => {
        if (location.origin !== origin) return;
        const snapshot = {
          actorProfiles: [
            {
              id: "synthetic-actor",
              studentId: "student-maya",
              slug: "synthetic-actor",
              displayName: name,
              bio: "Synthetic biography for a private draft. ".repeat(36),
              status: "draft",
              updatedAt: "2026-11-23T12:00:00Z",
              version: 1,
            },
          ],
          materials: [
            {
              id: "synthetic-headshot",
              studentId: "student-maya",
              role: "actor_material",
              title: "Synthetic portrait",
              category: "Headshot",
              mediaKind: "image",
              mimeType: "image/svg+xml",
              approvalStatus: "approved",
              publicEmbed: true,
              status: "active",
              externalUrl: origin + image,
              updatedAt: "2026-11-23T12:00:00Z",
              version: 1,
            },
          ],
        };
        localStorage.setItem(
          "stage-story-studio-core-v2",
          JSON.stringify(snapshot),
        );
      },
      { origin: baseURL, image: portrait, name: actorName },
    );
    await page.goto("/portal/actor-page?student=student-maya");
    const edit = page.getByRole("button", { name: "Edit", exact: true });
    await edit.press("Enter");
    const builder = page.getByRole("dialog", { name: "Build actor page" });
    const mobile = width <= 850;
    const bio = builder.getByRole("textbox", { name: "Bio", exact: true });
    await bio.fill("Unsent draft text must survive preview.");
    const toggle = builder.getByRole("button", {
      name: "Mobile preview",
      exact: true,
    });
    if (mobile)
      await builder
        .getByRole("button", { name: "Preview page", exact: true })
        .click();
    else await toggle.click();

    const preview = builder.locator(".actor-builder-preview");
    const layout = builder.locator(".actor-builder-layout");
    const photo = preview.locator(".actor-headshot");
    await expect(photo).toBeVisible();
    await expect(preview.getByText(/Private preview/)).toBeVisible();
    await photo.evaluate((image: HTMLImageElement) => image.decode());
    if (mobile) {
      expect
        .soft(await layout.evaluate((element) => element.scrollTop))
        .toBe(0);
      await layout.evaluate((element) => {
        element.scrollTop = 0;
      });
    }
    if ([320, 390, 768, 1440].includes(width)) {
      await page.screenshot({
        path: info.outputPath(`builder-preview-${width}.png`),
        animations: "disabled",
      });
    }
    const bounds = await preview.evaluate((element) => {
      const frame = element.getBoundingClientRect();
      const photo = element
        .querySelector(".actor-headshot")!
        .getBoundingClientRect();
      return {
        fits: photo.left >= frame.left - 1 && photo.right <= frame.right + 1,
        contained: photo.height <= innerHeight * 0.38 + 1,
        nestedScroll:
          element.scrollHeight > element.clientHeight + 1 &&
          ["auto", "scroll"].includes(getComputedStyle(element).overflowY),
      };
    });
    expect.soft(bounds.fits).toBe(true);
    if (mobile) {
      await expect.soft(toggle).toBeHidden();
      expect.soft(bounds.contained).toBe(true);
      expect.soft(bounds.nestedScroll).toBe(false);
      await layout.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const back = builder.getByRole("button", {
        name: "Edit content",
        exact: true,
      });
      await expect(back).toBeInViewport();
      await back.click();
    } else {
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(builder.locator(".actor-builder-viewport")).toHaveClass(
        /mobile/,
      );
    }
    await expect(bio).toHaveValue("Unsent draft text must survive preview.");
    const close = builder.getByRole("button", { name: "Close", exact: true });
    await expect(close).toBeInViewport();
    page.once("dialog", (dialog) => dialog.accept());
    await close.click();
    await expect(builder).toBeHidden();
    await expect(edit).toBeFocused();

    await page
      .getByRole("button", { name: "Preview draft", exact: true })
      .click();
    const standalone = page.getByRole("dialog", {
      name: "Private actor-page preview",
    });
    await expect(
      standalone.getByText(actorName, { exact: true }).first(),
    ).toBeVisible();
    const standalonePhoto = standalone.locator(".actor-headshot");
    await expect(standalonePhoto).toBeVisible();
    if (mobile)
      expect
        .soft((await standalonePhoto.boundingBox())!.height)
        .toBeLessThanOrEqual(page.viewportSize()!.height * 0.38 + 1);
    await standalone
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(standalone).toBeHidden();
  });
}
