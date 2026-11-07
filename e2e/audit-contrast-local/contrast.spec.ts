import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { demoSnapshot } from "../../src/data/demo";
import { inspectPublicFocus } from "./focus";
const productionColors = {
  primaryColor: "#37129b",
  secondaryColor: "#a7d3eb",
  accentColor: "#cf1b96",
  surfaceColor: "#c2daff",
};
for (const width of [320, 390, 768, 1440])
  test(`production brand booking at ${width}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await context.route("**/*", (r) =>
      new URL(r.request().url()).origin === "http://127.0.0.1:4191"
        ? r.continue()
        : r.abort(),
    );
    await context.addInitScript(
      ({ colors, services }) =>
        localStorage.setItem(
          "stage-story-studio-core-v2",
          JSON.stringify({
            settings: { branding: colors },
            bookingServices: services,
          }),
        ),
      {
        colors: productionColors,
        services: demoSnapshot.bookingServices.map((service) =>
          service.slug === "private-acting-coaching"
            ? {
                ...service,
                slug: "private-acting-coaching-30",
                name: "Private Acting Coaching — 30 minutes",
                durationMinutes: 30,
              }
            : service,
        ),
      },
    );
    const service = {
      ...demoSnapshot.bookingServices[0],
      slug: "private-acting-coaching-30",
      name: "Private Acting Coaching — 30 minutes",
      durationMinutes: 30,
      paymentPolicies: ["pay_later"],
      recurrenceOptions: ["none", "weekly", "biweekly"],
    };
    const row = Object.fromEntries(
      Object.entries(service).map(([key, value]) => [
        key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
        value,
      ]),
    );
    await context.route("**/api/v2/public/booking/services", (r) =>
      r.fulfill({
        json: {
          services: [row],
          offerings: [],
          studio: {
            name: "E2E Contrast Studio",
            coachName: "Synthetic Coach",
            contactEmail: "e2e-contrast@example.test",
            branding: productionColors,
            bookingCopy: demoSnapshot.settings.bookingCopy,
            bookingPage: demoSnapshot.settings.bookingPage,
            bookingDefaults: {
              ...demoSnapshot.settings.bookingDefaults,
              confirmationMessage:
                "Synthetic booking response. External delivery remains unverified.",
            },
          },
        },
      }),
    );
    const startsAt = new Date(Date.now() + 2 * 86400000).toISOString();
    await context.route("**/api/v2/public/booking/availability?**", (r) =>
      r.fulfill({
        json: {
          slots: [
            {
              startsAt,
              endsAt: new Date(Date.parse(startsAt) + 1800000).toISOString(),
            },
          ],
        },
      }),
    );
    let holds = 0;
    await context.route("**/api/v2/public/booking/holds", (r) =>
      ++holds === 1
        ? r.fulfill({
            status: 503,
            json: {
              code: "PROVIDER_UNAVAILABLE",
              message: "Synthetic service failure. Your details are preserved.",
              retryable: true,
              correlationId: "e2e-contrast",
            },
          })
        : r.fulfill({
            json: {
              reference: "E2E-CONTRAST",
              manageUrl: "/booking/e2e-synthetic",
            },
          }),
    );
    const evidence: unknown[] = [];
    const focusEvidence: Awaited<ReturnType<typeof inspectPublicFocus>>[] = [];
    async function focus(
      control: Parameters<typeof inspectPublicFocus>[1],
      state: string,
    ) {
      focusEvidence.push(await inspectPublicFocus(page, control, state));
    }
    async function inspect(state: string) {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const measured = await page
        .locator(".booking-summary")
        .evaluateAll((nodes) =>
          nodes.flatMap((node) => {
            const rgb = (value: string) =>
              (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
            const luminance = (value: string) =>
              rgb(value)
                .map((n) => {
                  const c = n / 255;
                  return c <= 0.04045
                    ? c / 12.92
                    : ((c + 0.055) / 1.055) ** 2.4;
                })
                .reduce(
                  (sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i],
                  0,
                );
            const background = getComputedStyle(node).backgroundColor,
              b = luminance(background);
            return [...node.querySelectorAll("h1,p,dt,dd,span,small,strong")]
              .filter((el) => el.textContent?.trim())
              .map((el) => {
                const color = getComputedStyle(el).color,
                  f = luminance(color);
                return {
                  element: el.tagName,
                  color,
                  background,
                  ratio: (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05),
                };
              });
          }),
        );
      for (const pair of measured)
        expect(pair.ratio).toBeGreaterThanOrEqual(4.5);
      const axe = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      expect(
        axe.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
      evidence.push({ state, measured });
      await page.screenshot({
        path: info.outputPath(`${state}-${width}.png`),
        fullPage: true,
      });
    }
    await page.goto("/book");
    await inspect("catalog");
    await focus(
      page
        .locator(".booking-footer")
        .getByRole("link", { name: "Terms and Conditions", exact: true }),
      "catalog-dark-footer",
    );
    await page.screenshot({
      path: info.outputPath(`focus-catalog-${width}.png`),
      fullPage: true,
    });
    await page.goto("/book/private-acting-coaching-30");
    await expect(page.locator(".booking-summary")).toBeVisible();
    await inspect("setup");
    await focus(
      page.getByRole("link", { name: "Back to services" }),
      "setup-back-link",
    );
    await focus(
      page.getByRole("link", { name: "Student or guardian sign in" }),
      "setup-sign-in",
    );
    await focus(
      page.getByRole("button", { name: /^Google Meet/ }),
      "setup-google-meet",
    );
    await focus(
      page.getByRole("button", { name: /^In person/ }),
      "setup-in-person",
    );
    for (const name of ["One time", "weekly", "biweekly"])
      await focus(
        page.getByRole("button", { name, exact: true }),
        `setup-recurrence-${name}`,
      );
    await focus(
      page.getByRole("button", { name: /Choose a time/i }),
      "setup-choose-time",
    );
    await page.screenshot({
      path: info.outputPath(`focus-setup-${width}.png`),
      fullPage: true,
    });
    await page.keyboard.press("Enter");
    const next = page.getByRole("button", { name: /^Continue/ });
    await expect(next).toBeDisabled();
    await inspect("time-disabled");
    const slot = page.locator(".booking-time-list button").first();
    await focus(slot, "time-slot");
    await page.keyboard.press("Enter");
    await expect(next).toBeEnabled();
    await focus(next, "time-continue");
    expect(await next.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe(
      "solid",
    );
    await page.keyboard.press("Enter");
    await inspect("details");
    await focus(
      page.getByLabel("Student name", { exact: true }),
      "details-name",
    );
    await focus(
      page.getByLabel("Student email", { exact: true }),
      "details-email",
    );
    await page.getByRole("button", { name: /Review payment/ }).click();
    expect(
      await page
        .getByLabel("Student name", { exact: true })
        .evaluate((el: HTMLInputElement) => el.validity.valueMissing),
    ).toBe(true);
    await page
      .getByLabel("Student name", { exact: true })
      .fill("E2E Contrast Learner");
    await page
      .getByLabel("Student email", { exact: true })
      .fill("e2e-contrast@example.test");
    const phone = page.getByRole("textbox", { name: /Phone number/ });
    await focus(phone, "details-phone");
    if ((await phone.getAttribute("required")) !== null)
      await phone.fill("5550001234");
    await page.getByRole("button", { name: /Review payment/ }).click();
    await expect(
      page.getByRole("button", { name: /^Confirm booking$/ }),
    ).toBeDisabled();
    await inspect("payment-disabled");
    await focus(
      page.getByRole("checkbox", { name: /Terms and Conditions/i }),
      "payment-terms",
    );
    await page.getByRole("checkbox", { name: /Terms and Conditions/i }).check();
    await focus(
      page.getByRole("button", { name: /^Confirm booking$/ }),
      "payment-confirm",
    );
    await page.getByRole("button", { name: /^Confirm booking$/ }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Your details are preserved",
    );
    await inspect("error");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByLabel("Student name", { exact: true })).toHaveValue(
      "E2E Contrast Learner",
    );
    await page.getByRole("button", { name: /Review payment/ }).click();
    await page.getByRole("button", { name: /^Confirm booking$/ }).click();
    await expect(
      page.getByText("Booking confirmed", { exact: true }),
    ).toBeVisible();
    await inspect("confirmation");
    await info.attach("computed-contrast", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
    await info.attach("computed-focus", {
      body: JSON.stringify(focusEvidence, null, 2),
      contentType: "application/json",
    });
    // The real non-booking sign-in route must retain the exact pre-existing shared fallback.
    await page.goto("/login");
    const login = page.getByLabel("Email or username", { exact: true });
    await page.keyboard.press("Tab");
    await login.focus();
    const nonPublicFocus = await login.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        publicScope: Boolean(element.closest(".booking-public")),
        semanticOutline: style.getPropertyValue("--focus-outline").trim(),
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
      };
    });
    expect(nonPublicFocus).toEqual({
      publicScope: false,
      semanticOutline: "",
      outlineWidth: "3px",
      outlineColor: "rgba(239, 93, 81, 0.45)",
    });
    await info.attach("non-public-focus", {
      body: JSON.stringify(nonPublicFocus, null, 2),
      contentType: "application/json",
    });
  });
