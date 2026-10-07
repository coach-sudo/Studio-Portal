import type { Config } from "@netlify/functions";
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import sharp from "sharp";
import { z } from "zod";
import { serviceClient, userClient } from "./_shared/supabase";
import { apiError, json } from "./_shared/http";
import { createInvoicePdf } from "../../src/features/finance/invoicePdf";
import type { Invoice } from "../../src/domain/invoices";
export default async (request: Request) => {
  try {
    if (request.method !== "POST")
      return json({ message: "Method not allowed" }, 405);
    const body = z
      .object({
        invoiceId: z.string().uuid(),
        format: z.enum(["pdf", "logo"]).default("pdf"),
      })
      .parse(await request.json());
    const db = userClient(request),
      auth = await db.auth.getUser();
    if (!auth.data.user)
      return json({ message: "Sign in to download invoices." }, 401);
    const invoice = await db
      .from("studio_invoices")
      .select("*")
      .eq("id", body.invoiceId)
      .single();
    if (invoice.error || !invoice.data) throw new Error("FORBIDDEN");
    const path = invoice.data.branding.logoStoragePath;
    if (
      path &&
      !path.startsWith(`${invoice.data.studio_id}/${invoice.data.studio_id}/`)
    )
      throw new Error("FORBIDDEN");
    // Invoice RLS authorizes the caller before privileged access to its frozen studio logo.
    if (body.format === "logo") {
      if (!path) return json({ url: invoice.data.branding.logoUrl });
      const signed = await serviceClient()
        .storage.from("studio-materials")
        .createSignedUrl(path, 3600);
      if (signed.error || !signed.data)
        throw new Error("The saved invoice logo could not be loaded.");
      return json({ url: signed.data.signedUrl });
    }
    const font = await readFile("public/fonts/invoice-sans.ttf");
    let logo: Buffer | undefined;
    if (invoice.data.branding.logoStoragePath) {
      const asset = await serviceClient()
        .storage.from("studio-materials")
        .download(invoice.data.branding.logoStoragePath);
      if (asset.error || !asset.data)
        throw new Error("The saved invoice logo could not be loaded.");
      // Older branding uploads accepted 50 MB; normalize them rather than invalidate saved invoices.
      if (asset.data.size > 50 * 1024 * 1024)
        throw new Error("The invoice logo is too large.");
      logo = await sharp(Buffer.from(await asset.data.arrayBuffer()), {
        limitInputPixels: 16000000,
      })
        .resize(800, 800, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
    }
    const bytes = await createInvoicePdf(
      invoice.data as Invoice,
      font,
      logo,
      fontkit,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoice.data.number}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiError(error, crypto.randomUUID());
  }
};
export const config: Config = { path: "/api/invoice-pdf" };
