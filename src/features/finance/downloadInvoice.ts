import { supabase } from "../../lib/supabase";
import { readApiClientError } from "../../data/apiClientError";
import type { Invoice } from "../../domain/invoices";
export async function invoiceLogoUrl(invoiceId: string) {
  const auth = await supabase?.auth.getSession();
  if (!auth?.data.session) throw new Error("Sign in to view invoices.");
  const response = await fetch("/api/invoice-pdf", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.data.session.access_token}`,
    },
    body: JSON.stringify({ invoiceId, format: "logo" }),
  });
  if (!response.ok)
    throw await readApiClientError(
      response,
      "The studio logo could not be loaded.",
    );
  return (await response.json()).url as string | undefined;
}
async function logoPng(url: string) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () =>
      reject(new Error("The studio logo could not be loaded."));
    img.src = url;
  });
  const canvas = document.createElement("canvas"),
    scale = Math.min(1, 800 / Math.max(img.naturalWidth, img.naturalHeight));
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise<string>((resolve, reject) => {
    try {
      resolve(canvas.toDataURL("image/png").split(",")[1]);
    } catch {
      reject(new Error("The studio logo could not be embedded."));
    }
  });
}
export async function downloadInvoice(
  invoice: Invoice,
  isDemo: boolean,
  logoUrl?: string,
) {
  const logo = isDemo && logoUrl ? await logoPng(logoUrl) : undefined;
  let blob: Blob;
  if (isDemo) {
    // Demo exports use the same renderer loaded from an isolated module, keeping the normal app entry small.
    const { createInvoicePdf } = await import("./invoicePdf");
    const bytes = await createInvoicePdf(
      invoice,
      undefined,
      logo ? Uint8Array.from(atob(logo), (c) => c.charCodeAt(0)) : undefined,
    );
    blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  } else {
    const auth = await supabase?.auth.getSession();
    if (!auth?.data.session) throw new Error("Sign in to download invoices.");
    const response = await fetch("/api/invoice-pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.data.session.access_token}`,
      },
      body: JSON.stringify({ invoiceId: invoice.id }),
    });
    if (!response.ok)
      throw await readApiClientError(response, "PDF could not be downloaded.");
    blob = await response.blob();
  }
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${invoice.number}.pdf`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
