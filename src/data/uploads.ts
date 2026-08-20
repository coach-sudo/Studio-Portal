import { isSupabaseConfigured, supabase } from "../lib/supabase";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf","image/jpeg","image/png","image/webp","video/mp4","audio/mpeg","audio/mp4","text/plain"]);

export async function uploadStudioFile(input: { studioId: string; studentId?: string; entityType: "student"|"lesson"|"note"|"assignment"|"material"|"actor_profile"|"studio"; entityId?: string; file: File; visibility?: "private"|"student"|"public_actor" }) {
  if(!isSupabaseConfigured||!supabase)throw new Error("Production file storage is not configured.");
  if(input.file.size<1||input.file.size>MAX_FILE_BYTES)throw new Error("Choose a file smaller than 50 MB.");
  if(!ALLOWED.has(input.file.type))throw new Error("That file type is not supported.");
  const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error("Sign in before uploading a file.");
  const owner=input.studentId||input.studioId,safeName=input.file.name.replace(/[^a-zA-Z0-9._-]+/g,"-").slice(-120),path=`${input.studioId}/${owner}/${crypto.randomUUID()}-${safeName}`;
  const {error:uploadError}=await supabase.storage.from("studio-materials").upload(path,input.file,{contentType:input.file.type,upsert:false,cacheControl:"3600"});if(uploadError)throw uploadError;
  const {data,error}=await supabase.from("file_assets").insert({studio_id:input.studioId,owner_student_id:input.studentId||null,uploaded_by:user.id,entity_type:input.entityType,entity_id:input.entityId||null,bucket_id:"studio-materials",storage_path:path,original_name:input.file.name,mime_type:input.file.type,file_size_bytes:input.file.size,visibility:input.visibility||"private"}).select("id,storage_path").single();
  if(error){await supabase.storage.from("studio-materials").remove([path]);throw error;}
  const {data:signed}=await supabase.storage.from("studio-materials").createSignedUrl(path,3600);
  return {id:data.id,storagePath:path,signedUrl:signed?.signedUrl,mimeType:input.file.type,fileSizeBytes:input.file.size};
}
