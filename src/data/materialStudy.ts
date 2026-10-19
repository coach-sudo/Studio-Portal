import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { StudyAnchor, StudyRecord } from "../domain/library";

const database = () => {
  if (!supabase) throw new Error("Study tools are unavailable.");
  return supabase as SupabaseClient;
};
export async function loadStudy(
  user: string,
  student: string,
  material: string,
  content: string,
  signal?: AbortSignal,
) {
  const db = database();
  const scope = (table: string) => {
    let q = db
      .from(table)
      .select("*")
      .eq("user_id", user)
      .eq("student_id", student)
      .eq("material_id", material)
      .eq("content_identity", content);
    if (signal) q = q.abortSignal(signal);
    return q;
  };
  const [state, annotations] = await Promise.all([
    scope("material_study_state").limit(1).maybeSingle(),
    scope("material_study_annotations")
      .order("updated_at", { ascending: false })
      .order("id")
      .limit(200),
  ]);
  if (state.error || annotations.error)
    throw new Error("Private study tools could not be loaded.");
  return {
    position: state.data as StudyRecord | null,
    annotations: annotations.data as StudyRecord[],
  };
}
export async function saveStudy(
  material: string,
  student: string,
  content: string,
  kind: "position" | "bookmark" | "note",
  id: string | null,
  anchor: StudyAnchor,
  body: string,
  version: number,
) {
  const { data, error } = await database().rpc("save_material_study", {
    p_material: material,
    p_student: student,
    p_content: content,
    p_kind: kind,
    p_id: id,
    p_anchor: anchor,
    p_body: body,
    p_version: version,
  });
  if (error)
    throw new Error(
      error.message.includes("VERSION_CONFLICT")
        ? "Changed in another tab. Reload study tools before saving."
        : "Study changes could not be saved. Check access and retry.",
    );
  return data as StudyRecord;
}
export async function removeStudyAnnotation(
  id: string,
  user: string,
  version: number,
) {
  const { data, error } = await database()
    .from("material_study_annotations")
    .delete()
    .eq("id", id)
    .eq("user_id", user)
    .eq("version", version)
    .select("id");
  if (error || !data?.length)
    throw new Error("This note changed or is unavailable. Reload study tools.");
}
