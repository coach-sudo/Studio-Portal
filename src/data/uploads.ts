import { isSupabaseConfigured, supabase } from "../lib/supabase";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "audio/mpeg",
  "audio/mp4",
  "text/plain",
]);

export async function uploadStudioFile(input: {
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
}) {
  if (!isSupabaseConfigured || !supabase)
    throw new Error("Production file storage is not configured.");
  if (input.file.size < 1 || input.file.size > MAX_FILE_BYTES)
    throw new Error("Choose a file smaller than 50 MB.");
  if (!ALLOWED.has(input.file.type))
    throw new Error("That file type is not supported.");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in before uploading a file.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await input.file.arrayBuffer(),
  );
  const contentHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
  const { error: uploadError } = await supabase.storage
    .from("studio-materials")
    .upload(path, input.file, {
      contentType: input.file.type,
      upsert: false,
      cacheControl: "3600",
    });
  if (
    uploadError &&
    !("statusCode" in uploadError && String(uploadError.statusCode) === "409")
  )
    throw uploadError;
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
      mime_type: input.file.type,
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
    mimeType: input.file.type,
    fileSizeBytes: input.file.size,
    deduplicated: !!uploadError,
  };
}
