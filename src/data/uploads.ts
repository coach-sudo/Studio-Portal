import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { studioFileType } from "./uploadFormats";
import { createClient } from "@supabase/supabase-js";

export type UploadTransfer = {
  signal: AbortSignal;
  onProgress: (loaded: number, total: number) => void;
};

function progressFetch(transfer: UploadTransfer): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const body = init?.body ?? (await request.blob());
    transfer.signal.throwIfAborted();
    return new Promise<Response>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      xhr.open(request.method, request.url);
      request.headers.forEach((value, name) => {
        if (name !== "content-type" || !(body instanceof FormData))
          xhr.setRequestHeader(name, value);
      });
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable)
          transfer.onProgress(event.loaded, event.total);
      };
      xhr.onload = () =>
        resolve(
          new Response(xhr.status === 204 ? null : xhr.responseText, {
            status: xhr.status,
            statusText: xhr.statusText,
            headers: new Headers(
              xhr.getResponseHeader("content-type")
                ? { "content-type": xhr.getResponseHeader("content-type")! }
                : {},
            ),
          }),
        );
      xhr.onerror = () =>
        reject(new Error("The file transfer could not be confirmed."));
      xhr.onabort = () =>
        reject(new DOMException("Upload cancelled.", "AbortError"));
      xhr.onloadend = () => transfer.signal.removeEventListener("abort", abort);
      transfer.signal.addEventListener("abort", abort, { once: true });
      xhr.send(body as Parameters<XMLHttpRequest["send"]>[0]);
    });
  };
}

export async function uploadContentHash(file: File) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function uploadAuthenticatedObject(
  bucket: string,
  path: string,
  file: File,
  mimeType: string,
  userId: string,
  transfer?: UploadTransfer,
) {
  if (!supabase) throw new Error("File storage is not configured.");
  let storage = supabase.storage;
  if (transfer) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session || session.user.id !== userId)
      throw new Error("Sign in again to continue the upload.");
    transfer.signal.throwIfAborted();
    storage = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      {
        accessToken: async () => session.access_token,
        global: { fetch: progressFetch(transfer) },
      },
    ).storage;
  }
  const { error } = await storage
    .from(bucket)
    .upload(path, new Blob([file], { type: mimeType }), {
      contentType: mimeType,
      upsert: false,
      cacheControl: bucket === "studio-materials" ? "3600" : "0",
    });
  transfer?.signal.throwIfAborted();
  if (error && !("statusCode" in error && String(error.statusCode) === "409"))
    throw error;
  return { deduplicated: !!error };
}

export async function uploadStudioFile(
  input: {
    studioId: string;
    studentId?: string;
    entityType:
      | "student"
      | "lesson"
      | "note"
      | "assignment"
      | "material"
      | "actor_profile"
      | "studio";
    entityId?: string;
    file: File;
    visibility?: "private" | "student" | "public_actor";
  },
  transfer?: UploadTransfer,
) {
  if (!isSupabaseConfigured || !supabase)
    throw new Error("Production file storage is not configured.");
  const mimeType = studioFileType(input.file);
  transfer?.signal.throwIfAborted();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in before uploading a file.");
  const contentHash = await uploadContentHash(input.file);
  const findExisting = async () => {
    let query = supabase!
      .from("file_assets")
      .select("id,storage_path,mime_type,file_size_bytes")
      .eq("studio_id", input.studioId)
      .eq("visibility", input.visibility || "private")
      .eq("content_sha256" as never, contentHash);
    query = input.studentId
      ? query.eq("owner_student_id", input.studentId)
      : query.is("owner_student_id", null);
    const { data, error } = await query.maybeSingle();
    if (error)
      throw new Error("The existing file could not be checked safely.");
    return data;
  };
  const existing = await findExisting();
  transfer?.signal.throwIfAborted();
  if (existing && Number(existing.file_size_bytes) !== input.file.size)
    throw new Error(
      "The matching file has inconsistent metadata. Choose another file or contact your coach.",
    );
  if (existing)
    return {
      id: existing.id,
      storagePath: existing.storage_path,
      mimeType: existing.mime_type,
      fileSizeBytes: existing.file_size_bytes,
      deduplicated: true,
    };
  // MIME and size are verified on reuse; names never establish file identity.
  const owner = input.studentId || input.studioId;
  const path = `${input.studioId}/${owner}/${input.visibility || "private"}/sha256-${contentHash}`;
  const { deduplicated } = await uploadAuthenticatedObject(
    "studio-materials",
    path,
    input.file,
    mimeType,
    user.id,
    transfer,
  );
  const { data, error } = await supabase
    .from("file_assets")
    .insert({
      studio_id: input.studioId,
      owner_student_id: input.studentId || null,
      uploaded_by: user.id,
      entity_type: input.entityType,
      entity_id: input.entityId || null,
      bucket_id: "studio-materials",
      storage_path: path,
      original_name: input.file.name,
      mime_type: mimeType,
      file_size_bytes: input.file.size,
      visibility: input.visibility || "private",
      content_sha256: contentHash,
    } as never)
    .select("id,storage_path")
    .single();
  if (error) {
    if (error.code === "23505") {
      const concurrent = await findExisting();
      if (concurrent)
        return {
          id: concurrent.id,
          storagePath: concurrent.storage_path,
          mimeType: concurrent.mime_type,
          fileSizeBytes: concurrent.file_size_bytes,
          deduplicated: true,
        };
    }
    // Never remove a hash object another concurrent resource may reference.
    throw new Error(
      "File metadata could not be saved. The upload was retained for safe recovery.",
    );
  }
  const { data: signed } = await supabase.storage
    .from("studio-materials")
    .createSignedUrl(path, 3600);
  return {
    id: data.id,
    storagePath: path,
    signedUrl: signed?.signedUrl,
    mimeType: mimeType,
    fileSizeBytes: input.file.size,
    deduplicated,
  };
}
