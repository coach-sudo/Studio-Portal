export const metadataKinds = [
  "category",
  "topic",
  "level",
  "medium",
  "tag",
] as const;
export type MetadataKind = (typeof metadataKinds)[number];
export interface ResourceOption {
  id: string;
  kind: MetadataKind;
  name: string;
  archived: boolean;
  uses?: number;
}
export interface LibraryResource {
  id: string;
  title: string;
  description: string;
  source: string;
  inLibrary: boolean;
  visibility: "assigned" | "studio";
  ownerStudentId?: string;
  mediaKind?: string;
  mimeType?: string;
  version: number;
  resourceStatus: string;
  createdAt: string;
  options: ResourceOption[];
  assignmentId?: string;
  assignmentVersion?: number;
  assignedAt?: string;
  status?: "active" | "vaulted" | "archived";
  pinned?: boolean;
  instructions?: string;
  hasInstructions?: boolean;
  lessonId?: string;
  noteId?: string;
}
export interface ResourceDetail {
  id: string;
  title: string;
  description: string;
  source: string;
  keywords: string[];
  text: string;
  storagePath?: string;
  externalUrl?: string;
  version: number;
}
export interface ResourcePage {
  items: LibraryResource[];
  total: number;
  page: number;
  pageSize: number;
}
export interface ResourceSearch {
  visibility?: string;
  studioId: string;
  studentId?: string;
  catalog: boolean;
  search: string;
  filters: Partial<Record<MetadataKind, string[]>>;
  status: string;
  pinned: boolean;
  sort: string;
  lessonId?: string;
}
export interface ResourceCollection {
  id: string;
  title: string;
  description: string;
  version: number;
  archived: boolean;
  resourceCount?: number;
  resourceIds?: string[];
}
