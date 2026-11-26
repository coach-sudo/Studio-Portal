import { supabase } from "../lib/supabase";
import { studioFileType } from "./uploadFormats";
import {
  uploadAuthenticatedObject,
  uploadContentHash,
  type UploadTransfer,
} from "./uploads";

const bucket = "assignment-attachments";

export interface AssignmentAttachment {
  id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  file_size_bytes: number;
  submitted_at: string | null;
}

function storageClient() {
  if (!supabase) throw new Error("Assignment files are unavailable.");
  return supabase;
}

export async function loadAssignmentAttachments(
  assignmentId: string,
  signal: AbortSignal,
): Promise<AssignmentAttachment[]> {
  const { data, error } = await storageClient()
    .from("assignment_attachments")
    .select(
      "id,storage_path,original_name,mime_type,file_size_bytes,submitted_at",
    )
    .eq("assignment_id", assignmentId)
    .order("created_at")
    .abortSignal(signal);
  if (error) throw new Error("Assignment files could not be loaded.");
  return data ?? [];
}

export async function uploadAssignmentAttachment(
  scope: {
    assignmentId: string;
    studioId: string;
    studentId: string;
    identity: string;
  },
  file: File,
  transfer: UploadTransfer,
) {
  const mimeType = studioFileType(file);
  const contentHash = await uploadContentHash(file);
  transfer.signal.throwIfAborted();
  const path = `${scope.studioId}/${scope.studentId}/${scope.assignmentId}/sha256-${contentHash}`;
  await uploadAuthenticatedObject(
    bucket,
    path,
    file,
    mimeType,
    scope.identity,
    transfer,
  );
  return contentHash;
}

export async function attachAssignmentFile(
  assignmentId: string,
  contentHash: string,
  fileName: string,
  identity: string,
) {
  const client = storageClient();
  const {
    data: { session },
  } = await client.auth.getSession();
  if (session?.user.id !== identity)
    throw new Error("Sign in again to attach this file.");
  const { error } = await client.rpc(
    "attach_assignment_file",
    {
      p_assignment: assignmentId,
      p_hash: contentHash,
      p_name: fileName.trim().slice(0, 255) || "Attachment",
    },
  );
  if (error?.message === "ATTACHMENT_LIMIT")
    throw new Error("An assignment can have up to 12 files.");
  if (error?.message === "ASSIGNMENT_CLOSED")
    throw new Error("This assignment is already complete.");
  if (error) throw new Error("The attachment could not be confirmed.");
}

export async function removeAssignmentFile(
  assignmentId: string,
  attachmentId: string,
) {
  const { error } = await storageClient().rpc(
    "remove_assignment_file",
    {
      p_assignment: assignmentId,
      p_attachment: attachmentId,
    },
  );
  if (error) throw new Error("The file could not be removed.");
}

export async function downloadAssignmentFile(
  path: string,
  signal: AbortSignal,
) {
  const { data, error } = await storageClient()
    .storage.from(bucket)
    .download(path, {}, { signal, cache: "no-store" });
  if (error) throw new Error("The file could not be downloaded.");
  return data;
}
