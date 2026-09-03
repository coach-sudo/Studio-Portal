import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { demoSnapshot } from "../data/demo";
import { adaptLegacySnapshot } from "../data/legacyAdapter";
import { mergeStudioSettings } from "../data/settings";
import type { Role, StudioSnapshot } from "../domain/model";

type Transaction = <T>(mutator: (draft: StudioSnapshot) => T) => T;

interface StudioStoreValue {
  snapshot: StudioSnapshot;
  transact: Transaction;
  reset: () => void;
}

const StudioStoreContext = createContext<StudioStoreValue | null>(null);
const STORAGE_KEY = "stage-story-studio-core-v2";
const CORE_KEYS = [
  "students",
  "lessons",
  "notes",
  "assignments",
  "materials",
  "actorProfiles",
  "discountCodes",
  "settings",
] as const;

function loadLocalSnapshot() {
  const fresh = structuredClone(demoSnapshot);
  if (typeof window === "undefined") return fresh;
  try {
    const saved = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || "null",
    ) as Partial<StudioSnapshot> | null;
    if (!saved) {
      const legacyRaw = JSON.parse(
        window.localStorage.getItem("studioPortal.dataCache.v1") || "null",
      );
      const migrated = adaptLegacySnapshot(legacyRaw?.snapshot ?? legacyRaw);
      if (!migrated) return fresh;
      const branding = JSON.parse(
        window.localStorage.getItem("studioPortal.branding") || "null",
      );
      const backend = JSON.parse(
        window.localStorage.getItem("studioPortal.backendSettings") || "null",
      );
      migrated.settings = {
        ...migrated.settings,
        studioName:
          backend?.studio_name ||
          branding?.studio_name ||
          migrated.settings.studioName,
        studioTagline:
          backend?.studio_tagline ||
          branding?.tagline ||
          migrated.settings.studioTagline,
        coachName:
          backend?.coach_name ||
          branding?.coach_name ||
          migrated.settings.coachName,
        coachTitle:
          backend?.coach_title ||
          branding?.coach_title ||
          migrated.settings.coachTitle,
        contactEmail:
          backend?.coach_contact_email ||
          branding?.contact_email ||
          migrated.settings.contactEmail,
        contactPhone:
          backend?.coach_contact_phone ||
          branding?.contact_phone ||
          migrated.settings.contactPhone,
      };
      persistCore(migrated);
      return migrated;
    }
    for (const key of CORE_KEYS)
      if (saved[key] !== undefined)
        (fresh as unknown as Record<string, unknown>)[key] = saved[key];
    if (saved.settings) {
      fresh.settings=mergeStudioSettings(demoSnapshot.settings,saved.settings);
    }
    return fresh;
  } catch {
    return fresh;
  }
}

function persistCore(snapshot: StudioSnapshot) {
  if (typeof window === "undefined") return;
  const core = Object.fromEntries(CORE_KEYS.map((key) => [key, snapshot[key]]));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(core));
}

export function StudioStoreProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<StudioSnapshot>(loadLocalSnapshot);
  const snapshotRef = useRef(snapshot);

  const transact = useCallback<Transaction>((mutator) => {
    const next = structuredClone(snapshotRef.current);
    const result = mutator(next);
    snapshotRef.current = next;
    setSnapshot(next);
    persistCore(next);
    return result;
  }, []);

  const reset = useCallback(() => {
    const next = structuredClone(demoSnapshot);
    snapshotRef.current = next;
    setSnapshot(next);
    if (typeof window !== "undefined")
      window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  const value = useMemo(
    () => ({ snapshot, transact, reset }),
    [reset, snapshot, transact],
  );
  return (
    <StudioStoreContext.Provider value={value}>
      {children}
    </StudioStoreContext.Provider>
  );
}

export function useStudioStore() {
  const value = useContext(StudioStoreContext);
  if (!value) throw new Error("StudioStoreProvider is missing.");
  return value;
}

export function scopeStudioSnapshot(
  snapshot: StudioSnapshot,
  role: Role,
  studentId = "student-maya",
): StudioSnapshot {
  if (role === "coach") return snapshot;
  const requested = snapshot.students.find((row) => row.id === studentId);
  const student =
    requested ??
    (role === "guardian"
      ? snapshot.students.find((row) => row.guardianEmail || row.guardianName)
      : snapshot.students.find((row) => row.portalEnabled && row.status === "active")) ??
    snapshot.students.find((row) => row.status === "active") ??
    snapshot.students[0];
  const studentIds = student ? [student.id] : [];
  const packageIds = snapshot.packages
    .filter((row) => studentIds.includes(row.studentId))
    .map((row) => row.id);
  const studentEmails = new Set(
    [student?.email, student?.guardianEmail]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim().toLowerCase()),
  );
  const bookings = snapshot.bookings.filter(
    (row) =>
      (Boolean(row.studentId) && studentIds.includes(row.studentId!)) ||
      (!row.studentId &&
        [row.guestEmail, row.guardianEmail].some(
          (value) => value && studentEmails.has(value.trim().toLowerCase()),
        )),
  );
  const bookingIds = new Set(bookings.map((row) => row.id));
  const participantLessonIds = new Set(
    snapshot.lessonParticipants
      .filter(
        (row) =>
          (Boolean(row.studentId) && studentIds.includes(row.studentId!)) ||
          Boolean(row.bookingId && bookingIds.has(row.bookingId)),
      )
      .map((row) => row.lessonId),
  );
  const scopedLessons = snapshot.lessons.filter(
    (row) =>
      studentIds.includes(row.studentId) || participantLessonIds.has(row.id),
  );
  const scopedOfferings = snapshot.serviceOfferings.filter((offering) =>
    offering.lessonIds.some((lessonId) => participantLessonIds.has(lessonId)),
  );
  return {
    ...snapshot,
    role,
    displayName:
      role === "guardian"
        ? (student?.guardianName ?? "Guardian")
        : (student?.preferredName || student?.fullName || "Student"),
    students: snapshot.students.filter((row) => studentIds.includes(row.id)),
    lessons: scopedLessons,
    notes: snapshot.notes.filter(
      (row) => studentIds.includes(row.studentId) && row.status === "published",
    ),
    assignments: snapshot.assignments.filter((row) =>
      studentIds.includes(row.studentId),
    ),
    materials: snapshot.materials.filter((row) => studentIds.includes(row.studentId)),
    packages: snapshot.packages.filter((row) =>
      studentIds.includes(row.studentId),
    ),
    packageSubscriptions: snapshot.packageSubscriptions.filter((row) =>
      studentIds.includes(row.studentId),
    ),
    packageGifts: snapshot.packageGifts.filter(
      (row) => !row.claimedStudentId || studentIds.includes(row.claimedStudentId),
    ),
    linkedContacts: snapshot.linkedContacts.filter((row) =>
      studentIds.includes(row.studentId),
    ),
    creditEntries: snapshot.creditEntries.filter((row) =>
      packageIds.includes(row.packageId),
    ),
    payments: snapshot.payments.filter((row) =>
      studentIds.includes(row.studentId),
    ),
    actorProfiles: snapshot.actorProfiles.filter((row) =>
      studentIds.includes(row.studentId),
    ),
    outbox: [],
    recommendations: [],
    recurringSeries: snapshot.recurringSeries.filter(
      (row) => Boolean(row.studentId) && studentIds.includes(row.studentId!),
    ),
    bookings,
    lessonParticipants: snapshot.lessonParticipants.filter(
      (row) =>
        (Boolean(row.studentId) && studentIds.includes(row.studentId!)) ||
        Boolean(row.bookingId && bookingIds.has(row.bookingId)),
    ),
    serviceOfferings: scopedOfferings,
    conversations: snapshot.conversations.filter(
      (row) =>
        (Boolean(row.studentId) && studentIds.includes(row.studentId!)) ||
        (Boolean(row.offeringId) &&
          snapshot.serviceOfferings.some(
            (offering) =>
              offering.id === row.offeringId &&
              offering.lessonIds.some((lessonId) =>
                participantLessonIds.has(lessonId),
              ),
          )),
    ),
    conversationMessages: snapshot.conversationMessages.filter((row) =>
      snapshot.conversations.some(
        (conversation) =>
          conversation.id === row.conversationId &&
          ((Boolean(conversation.studentId) &&
            studentIds.includes(conversation.studentId!)) ||
            (Boolean(conversation.offeringId) &&
              snapshot.serviceOfferings.some(
                (offering) =>
                  offering.id === conversation.offeringId &&
                  offering.lessonIds.some((lessonId) =>
                    participantLessonIds.has(lessonId),
                  ),
              ))),
      ),
    ),
    integrationImports: [],
    discountCodes: [],
  };
}
