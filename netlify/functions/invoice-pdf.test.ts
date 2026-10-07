// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import sharp from "sharp";
const mock = vi.hoisted(() => ({
  invoice: vi.fn(),
  signed: vi.fn(),
  download: vi.fn(),
  service: vi.fn(),
}));
vi.mock("./_shared/supabase", () => ({
  userClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "student" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: mock.invoice }) }) }),
  }),
  serviceClient: mock.service,
}));
import handler from "./invoice-pdf";
const studio = "10000000-0000-4000-8000-000000000001";
const request = (format = "logo") =>
  new Request("https://example.test/api/invoice-pdf", {
    method: "POST",
    body: JSON.stringify({
      invoiceId: "20000000-0000-4000-8000-000000000001",
      format,
    }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mock.invoice.mockResolvedValue({
    data: {
      studio_id: studio,
      branding: { logoStoragePath: `${studio}/${studio}/logo.png` },
    },
  });
  mock.signed.mockResolvedValue({
    data: { signedUrl: "https://example.test/authorized-logo" },
  });
  mock.service.mockReturnValue({
    storage: {
      from: () => ({ createSignedUrl: mock.signed, download: mock.download }),
    },
  });
});
it("signs the frozen studio logo after student invoice authorization", async () => {
  const response = await handler(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    url: "https://example.test/authorized-logo",
  });
  expect(mock.signed).toHaveBeenCalledWith(
    `${studio}/${studio}/logo.png`,
    3600,
  );
});
it("never accesses privileged storage for an unauthorized invoice", async () => {
  mock.invoice.mockResolvedValue({
    data: null,
    error: { message: "RLS denied" },
  });
  expect((await handler(request())).status).toBe(403);
  expect(mock.service).not.toHaveBeenCalled();
});
it("rejects branding paths outside the invoice studio", async () => {
  mock.invoice.mockResolvedValue({
    data: {
      studio_id: studio,
      branding: { logoStoragePath: "another/studio/logo.png" },
    },
  });
  expect((await handler(request())).status).toBe(403);
  expect(mock.service).not.toHaveBeenCalled();
});
it("normalizes an older logo larger than the new upload limit into the PDF", async () => {
  const png = await sharp({
    create: { width: 100, height: 50, channels: 3, background: "#163f35" },
  })
    .png()
    .toBuffer();
  mock.download.mockResolvedValue({
    data: {
      size: 6 * 1024 * 1024,
      arrayBuffer: async () => new Uint8Array(png).buffer,
    },
  });
  mock.invoice.mockResolvedValue({
    data: {
      studio_id: studio,
      branding: {
        studioName: "DAJ Studio",
        logoStoragePath: `${studio}/${studio}/logo.png`,
      },
      number: "INV-TEST",
      status: "open",
      recipient: { name: "Taylor" },
      issue_date: "2026-10-06",
      due_date: "2026-10-20",
      currency: "USD",
      items: [],
      total_minor: 0,
      paid_minor: 0,
      credit_minor: 0,
      introduction: "Thank you",
      notes: "",
      footer: "See you soon",
    },
  });
  const response = await handler(request("pdf"));
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/pdf");
  expect(
    new TextDecoder().decode((await response.arrayBuffer()).slice(0, 4)),
  ).toBe("%PDF");
  expect(mock.download).toHaveBeenCalledWith(`${studio}/${studio}/logo.png`);
});
