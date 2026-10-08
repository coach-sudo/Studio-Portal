import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/types/database.generated";

/** Resolve through the caller's RLS before a service-role profile update creates a new file reference. */
export async function requireAccessibleProfilePhoto(
  caller: SupabaseClient<Database>,
  assetId: string,
  studentId: string,
  studioId: string,
) {
  const { data, error } = await caller
    .from("file_assets")
    .select("id,studio_id,owner_student_id,mime_type")
    .eq("id", assetId)
    .maybeSingle();
  if (
    error ||
    !data ||
    data.studio_id !== studioId ||
    data.owner_student_id !== studentId ||
    !data.mime_type.startsWith("image/")
  )
    throw new Error(
      "VALIDATION_FAILED: Choose an accessible image for this student's profile.",
    );
}
