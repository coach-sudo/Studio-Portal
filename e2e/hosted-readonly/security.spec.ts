import {
  test,
  expect,
  checkedRequest,
  roleHeaders,
  hostedAcceptance,
} from "../support/hostedReadOnly";

test.describe("coach keyboard", () => {
  test.use({ role: "coach" });
  test("search dialog traps focus, closes with Escape and restores focus", async ({
    page,
  }) => {
    await page.goto("/coach");
    const trigger = page.getByRole("button", {
      name: "Search studio workflows",
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Go to", exact: true });
    await expect(dialog).toBeVisible();
    await expect
      .soft(dialog.getByLabel("Find a workflow", { exact: true }))
      .toBeFocused();
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press("Tab");
      expect(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
  test("320 px student header gives long names a readable column", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(`/coach/students/${hostedAcceptance.student}/household`);
    const title = page.locator(".student-record-identity h1");
    await expect(title).toBeVisible();
    const box = await title.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(140);
  });
});

test("anonymous financial reads are denied; invoices require application authentication", async ({
  context,
}) => {
  const { apikey } = await roleHeaders("student");
  const response = await checkedRequest(
    context.request,
    "POST",
    `https://${hostedAcceptance.project}.supabase.co/rest/v1/rpc/student_financial_overview`,
    { headers: { apikey }, data: { p_student: hostedAcceptance.student } },
  );
  expect([401, 403]).toContain(response.status());
  const invoices = await checkedRequest(
    context.request,
    "GET",
    "/api/invoices",
  );
  expect(invoices.status()).toBe(401);
  expect((await invoices.text()).includes(hostedAcceptance.student)).toBe(
    false,
  );
});

test("served client modules contain no service key or service-role JWT", async ({
  page,
  context,
}) => {
  const scripts = new Set<string>();
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === hostedAcceptance.origin && url.pathname.endsWith(".js"))
      scripts.add(url.href);
  });
  for (const path of ["/portal", "/portal/work", "/portal/payments"]) {
    await page.goto(path);
    await expect(page.locator("main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const unsafe = await page
      .locator("a[href]")
      .evaluateAll((links) =>
        links
          .map((el) => (el as HTMLAnchorElement).href)
          .filter((href) =>
            /https:\/\/(?:portal\.d-a-j\.com|portal\.daj\.com|studio-portal\.netlify\.app|htwthzshhilrjtqwprlo\.supabase\.co)(?:[/:]|$)/i.test(
              href,
            ),
          ),
      );
    expect(unsafe).toEqual([]);
  }
  expect(scripts.size).toBeGreaterThan(0);
  let unsafe = false;
  for (const url of scripts) {
    const response = await checkedRequest(context.request, "GET", url);
    expect(response.status()).toBe(200);
    const source = await response.text();
    unsafe ||= /sb_secret_[\w-]+|sk_live_[\w]+|sk_test_[\w]+/.test(source);
    for (const match of source.matchAll(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g)) {
      try {
        unsafe ||=
          JSON.parse(
            Buffer.from(match[0].split(".")[1], "base64url").toString(),
          ).role === "service_role";
      } catch {
        /* Not a JWT payload. */
      }
    }
  }
  expect(unsafe, "Only public browser credentials may be served").toBe(false);
});
