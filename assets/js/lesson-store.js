function padLessonNumber(num, size = 6) {
  return String(num).padStart(size, "0");
}

function getLessonYear(dateString) {
  const date = dateString ? new Date(dateString) : new Date();
  const year = Number.isNaN(date.getTime()) ? new Date().getFullYear() : date.getFullYear();
  return String(year);
}

function getNextLessonId(dateString) {
  const year = getLessonYear(dateString);

  const maxId = getLessonRecords().reduce((max, lesson) => {
    const match = String(lesson.lesson_id || "").match(/^LES-(\d{4})-(\d{6})$/);
    if (!match) return max;
    if (match[1] !== year) return max;
    return Math.max(max, Number(match[2]));
  }, 0);

  return `LES-${year}-${padLessonNumber(maxId + 1)}`;
}

function normalizeLessonStatusValue(value) {
  const raw = String(value || "").trim().toUpperCase();

  if (["SCHEDULED", "COMPLETED", "CANCELLED", "LATE_CANCEL", "NO_SHOW"].includes(raw)) {
    return raw;
  }

  const map = {
    "Scheduled": "SCHEDULED",
    "Completed": "COMPLETED",
    "Cancelled": "CANCELLED",
    "Canceled": "CANCELLED",
    "Late Cancel": "LATE_CANCEL",
    "Late Canceled": "LATE_CANCEL",
    "No Show": "NO_SHOW"
  };

  return map[value] || raw;
}

function normalizeLessonManualPaymentStatusValue(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw || raw === "NOT_SET") return "";
  if (["PAID", "UNPAID"].includes(raw)) return raw;

  const map = {
    "Paid": "PAID",
    "Unpaid": "UNPAID"
  };

  return map[value] || "";
}

function normalizeLessonSyncStateValue(value, source = "manual") {
  const normalizedSource = String(source || "manual").trim().toLowerCase();
  const raw = String(value || "").trim().toUpperCase();

  if (normalizedSource === "manual") {
    return "MANUAL";
  }

  if (["SYNCED", "UPDATED_EXTERNALLY", "NEEDS_REVIEW", "DISCONNECTED"].includes(raw)) {
    return raw;
  }

  const map = {
    "Synced": "SYNCED",
    "Updated Externally": "UPDATED_EXTERNALLY",
    "Needs Review": "NEEDS_REVIEW",
    "Disconnected": "DISCONNECTED"
  };

  return map[value] || "SYNCED";
}

function normalizeLessonIntakeReviewStateValue(value, source = "manual") {
  const normalizedSource = String(source || "manual").trim().toLowerCase();
  const raw = String(value || "").trim().toUpperCase();

  if (normalizedSource === "manual") {
    return "MANUAL";
  }

  if (["UNREVIEWED", "CONFIRMED", "NEEDS_ATTENTION", "IGNORED"].includes(raw)) {
    return raw;
  }

  const map = {
    "Unreviewed": "UNREVIEWED",
    "Confirmed": "CONFIRMED",
    "Needs Attention": "NEEDS_ATTENTION",
    "Ignored": "IGNORED"
  };

  return map[value] || "UNREVIEWED";
}

function normalizeCancellationTypeValue(value) {
  const raw = String(value || "").trim().toUpperCase();

  if (!raw) return "";
  if (["STUDENT", "COACH", "SYSTEM", "WEATHER", "OTHER"].includes(raw)) return raw;

  const map = {
    "Student": "STUDENT",
    "Coach": "COACH",
    "System": "SYSTEM",
    "Weather": "WEATHER",
    "Other": "OTHER"
  };

  return map[value] || raw;
}

function getLessonByIdForStore(lessonId) {
  return getLessonRecords().find((lesson) => lesson.lesson_id === lessonId) || null;
}

function deriveCountsAgainstPackage(studentId, fallbackValue = null) {
  if (typeof fallbackValue === "boolean") {
    return fallbackValue;
  }

  const student = getStudentRecords().find((item) => item.student_id === studentId);
  return String(student?.billing_model || "").toUpperCase() === "PACKAGE";
}

function validateLessonPayload(payload, { isEdit = false, currentLesson = null } = {}) {
  const errors = [];

  const studentId = String(("student_id" in payload ? payload.student_id : currentLesson?.student_id) || "").trim();
  const scheduledStart = String(("scheduled_start" in payload ? payload.scheduled_start : currentLesson?.scheduled_start) || "").trim();
  const scheduledEnd = String(("scheduled_end" in payload ? payload.scheduled_end : currentLesson?.scheduled_end) || "").trim();
  const lessonStatus = normalizeLessonStatusValue(("lesson_status" in payload ? payload.lesson_status : currentLesson?.lesson_status) || "SCHEDULED");
  const lessonType = String(("lesson_type" in payload ? payload.lesson_type : currentLesson?.lesson_type) || "").trim();
  const manualPaymentStatus = normalizeLessonManualPaymentStatusValue(("manual_payment_status" in payload ? payload.manual_payment_status : currentLesson?.manual_payment_status) || "");
  const locationType = String(("location_type" in payload ? payload.location_type : currentLesson?.location_type) || "VIRTUAL").trim().toUpperCase();
  const locationAddress = String(("location_address" in payload ? payload.location_address : currentLesson?.location_address) || "").trim();
  const topic = String(("topic" in payload ? payload.topic : currentLesson?.topic) || "").trim();
  const joinLink = String(("join_link" in payload ? payload.join_link : currentLesson?.join_link) || "").trim();
  let actualCompletionDate = String(("actual_completion_date" in payload ? payload.actual_completion_date : currentLesson?.actual_completion_date) || "").trim();
  const cancellationType = normalizeCancellationTypeValue(("cancellation_type" in payload ? payload.cancellation_type : currentLesson?.cancellation_type) || "");
  const internalComments = String(("internal_comments" in payload ? payload.internal_comments : currentLesson?.internal_comments) || "").trim();
  const source = String(("source" in payload ? payload.source : currentLesson?.source) || "manual").trim().toLowerCase();
  const externalEventId = String(("external_event_id" in payload ? payload.external_event_id : currentLesson?.external_event_id) || "").trim();
  let sourceCalendarId = String(("source_calendar_id" in payload ? payload.source_calendar_id : currentLesson?.source_calendar_id) || "").trim();
  let externalPlatformHint = String(("external_platform_hint" in payload ? payload.external_platform_hint : currentLesson?.external_platform_hint) || "").trim();
  let externalEventTitle = String(("external_event_title" in payload ? payload.external_event_title : currentLesson?.external_event_title) || "").trim();
  let externalContactName = String(("external_contact_name" in payload ? payload.external_contact_name : currentLesson?.external_contact_name) || "").trim();
  let externalContactEmail = String(("external_contact_email" in payload ? payload.external_contact_email : currentLesson?.external_contact_email) || "").trim();
  let externalContactPhone = String(("external_contact_phone" in payload ? payload.external_contact_phone : currentLesson?.external_contact_phone) || "").trim();
  let syncState = normalizeLessonSyncStateValue(("sync_state" in payload ? payload.sync_state : currentLesson?.sync_state) || "", source);
  let intakeReviewState = normalizeLessonIntakeReviewStateValue(("intake_review_state" in payload ? payload.intake_review_state : currentLesson?.intake_review_state) || "", source);
  let importedAt = String(("imported_at" in payload ? payload.imported_at : currentLesson?.imported_at) || "").trim();
  let lastSyncedAt = String(("last_synced_at" in payload ? payload.last_synced_at : currentLesson?.last_synced_at) || "").trim();
  let externalUpdatedAt = String(("external_updated_at" in payload ? payload.external_updated_at : currentLesson?.external_updated_at) || "").trim();
  let intakeConflictNote = String(("intake_conflict_note" in payload ? payload.intake_conflict_note : currentLesson?.intake_conflict_note) || "").trim();
  let pendingExternalStart = String(("pending_external_start" in payload ? payload.pending_external_start : currentLesson?.pending_external_start) || "").trim();
  let pendingExternalEnd = String(("pending_external_end" in payload ? payload.pending_external_end : currentLesson?.pending_external_end) || "").trim();

  if (!isEdit || "student_id" in payload) {
    const allowsPendingMatch = source !== "manual" && Boolean(externalEventId);
    if (!studentId && !allowsPendingMatch) errors.push("Student is required.");
  }

  if (!isEdit || "scheduled_start" in payload) {
    if (!scheduledStart) errors.push("Scheduled start is required.");
  }

  if (!isEdit || "scheduled_end" in payload) {
    if (!scheduledEnd) errors.push("Scheduled end is required.");
  }

  if (scheduledStart && scheduledEnd) {
    const start = new Date(scheduledStart);
    const end = new Date(scheduledEnd);

    if (Number.isNaN(start.getTime())) errors.push("Scheduled start is invalid.");
    if (Number.isNaN(end.getTime())) errors.push("Scheduled end is invalid.");
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) {
      errors.push("Scheduled end must be after scheduled start.");
    }
  }

  if (!["SCHEDULED", "COMPLETED", "CANCELLED", "LATE_CANCEL", "NO_SHOW"].includes(lessonStatus)) {
    errors.push("Lesson status must be SCHEDULED, COMPLETED, CANCELLED, LATE_CANCEL, or NO_SHOW.");
  }

  if (!isEdit || "lesson_type" in payload) {
    if (!lessonType) errors.push("Lesson type is required.");
  }

  if (!["VIRTUAL", "IN_PERSON"].includes(locationType)) {
    errors.push("Location must be VIRTUAL or IN_PERSON.");
  }

  if (locationType === "VIRTUAL" && !joinLink) {
    errors.push("Virtual lessons need a join link.");
  }

  if (locationType === "IN_PERSON" && !locationAddress) {
    errors.push("In-person lessons need an address.");
  }

  const allowedSources = [
    "manual",
    "google_calendar",
    "gmail",
    "lessonface",
    "lessons_com",
    "acuity"
  ];

  if (source && !allowedSources.includes(source)) {
    errors.push('Source must be one of: manual, google_calendar, gmail, lessonface, lessons_com, acuity.');
  }

  if (source === "manual") {
    sourceCalendarId = "";
    externalPlatformHint = "";
    externalEventTitle = "";
    externalContactName = "";
    externalContactEmail = "";
    externalContactPhone = "";
    syncState = "MANUAL";
    intakeReviewState = "MANUAL";
    importedAt = "";
    lastSyncedAt = "";
    externalUpdatedAt = "";
    intakeConflictNote = "";
    pendingExternalStart = "";
    pendingExternalEnd = "";
  } else {
    if (!importedAt) {
      importedAt = new Date().toISOString();
    }

    if (!lastSyncedAt) {
      lastSyncedAt = importedAt;
    }
  }

  if (lessonStatus === "COMPLETED" && !actualCompletionDate) {
    actualCompletionDate = scheduledEnd || scheduledStart || new Date().toISOString();
  }

  if (["SCHEDULED", "CANCELLED", "LATE_CANCEL", "NO_SHOW"].includes(lessonStatus)) {
    actualCompletionDate = "";
  }

  return {
    ok: errors.length === 0,
    errors,
    cleaned: {
      student_id: studentId,
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
      lesson_status: lessonStatus,
      lesson_type: lessonType,
      manual_payment_status: manualPaymentStatus,
      location_type: locationType,
      location_address: locationAddress,
      topic,
      join_link: joinLink,
      counts_against_package: deriveCountsAgainstPackage(studentId, payload.counts_against_package),
      actual_completion_date: actualCompletionDate,
      cancellation_type: cancellationType,
      internal_comments: internalComments,
      source: source || "manual",
      external_event_id: externalEventId,
      source_calendar_id: sourceCalendarId,
      external_platform_hint: externalPlatformHint,
      external_event_title: externalEventTitle,
      external_contact_name: externalContactName,
      external_contact_email: externalContactEmail,
      external_contact_phone: externalContactPhone,
      sync_state: syncState,
      intake_review_state: intakeReviewState,
      imported_at: importedAt,
      last_synced_at: lastSyncedAt,
      external_updated_at: externalUpdatedAt,
      intake_conflict_note: intakeConflictNote,
      pending_external_start: pendingExternalStart,
      pending_external_end: pendingExternalEnd
    }
  };
}

function createLesson(payload) {
  const result = validateLessonPayload(payload);
  if (!result.ok) return result;

  const now = new Date().toISOString();

  const newLesson = {
    lesson_id: getNextLessonId(result.cleaned.scheduled_start),
    student_id: result.cleaned.student_id,
    scheduled_start: result.cleaned.scheduled_start,
    scheduled_end: result.cleaned.scheduled_end,
    lesson_status: result.cleaned.lesson_status,
    lesson_type: result.cleaned.lesson_type,
    manual_payment_status: result.cleaned.manual_payment_status,
    location_type: result.cleaned.location_type,
    location_address: result.cleaned.location_address,
    topic: result.cleaned.topic,
    join_link: result.cleaned.join_link,
    counts_against_package: result.cleaned.counts_against_package,
    previous_scheduled_start: null,
    previous_scheduled_end: null,
    actual_completion_date: result.cleaned.actual_completion_date,
    cancellation_type: result.cleaned.cancellation_type,
    internal_comments: result.cleaned.internal_comments,
    source: result.cleaned.source,
    external_event_id: result.cleaned.external_event_id,
    source_calendar_id: result.cleaned.source_calendar_id,
    external_platform_hint: result.cleaned.external_platform_hint,
    external_event_title: result.cleaned.external_event_title,
    external_contact_name: result.cleaned.external_contact_name,
    external_contact_email: result.cleaned.external_contact_email,
    external_contact_phone: result.cleaned.external_contact_phone,
    sync_state: result.cleaned.sync_state,
    intake_review_state: result.cleaned.intake_review_state,
    imported_at: result.cleaned.imported_at,
    last_synced_at: result.cleaned.last_synced_at,
    external_updated_at: result.cleaned.external_updated_at,
    intake_conflict_note: result.cleaned.intake_conflict_note,
    pending_external_start: result.cleaned.pending_external_start,
    pending_external_end: result.cleaned.pending_external_end,
    created_at: now,
    updated_at: now
  };

  insertRecord("lessons", newLesson, { prepend: true });

  return {
    ok: true,
    lesson: newLesson
  };
}

function updateLesson(lessonId, payload) {
  const lesson = getLessonByIdForStore(lessonId);

  if (!lesson) {
    return {
      ok: false,
      errors: ["Lesson not found."]
    };
  }

  const result = validateLessonPayload(payload, { isEdit: true, currentLesson: lesson });
  if (!result.ok) return result;

  const updates = {
    updated_at: new Date().toISOString()
  };

  if ("student_id" in payload) updates.student_id = result.cleaned.student_id;
  if ("scheduled_start" in payload) updates.scheduled_start = result.cleaned.scheduled_start;
  if ("scheduled_end" in payload) updates.scheduled_end = result.cleaned.scheduled_end;
  if ("lesson_status" in payload) updates.lesson_status = result.cleaned.lesson_status;
  if ("lesson_type" in payload) updates.lesson_type = result.cleaned.lesson_type;
  if ("manual_payment_status" in payload) updates.manual_payment_status = result.cleaned.manual_payment_status;
  if ("location_type" in payload) updates.location_type = result.cleaned.location_type;
  if ("location_address" in payload) updates.location_address = result.cleaned.location_address;
  if ("topic" in payload) updates.topic = result.cleaned.topic;
  if ("join_link" in payload) updates.join_link = result.cleaned.join_link;
  if ("counts_against_package" in payload || "student_id" in payload) {
    updates.counts_against_package = deriveCountsAgainstPackage(
      "student_id" in updates ? updates.student_id : lesson.student_id,
      "counts_against_package" in payload ? result.cleaned.counts_against_package : lesson.counts_against_package
    );
  }
  if ("actual_completion_date" in payload) updates.actual_completion_date = result.cleaned.actual_completion_date;
  if ("cancellation_type" in payload) updates.cancellation_type = result.cleaned.cancellation_type;
  if ("internal_comments" in payload) updates.internal_comments = result.cleaned.internal_comments;
  if ("source" in payload) updates.source = result.cleaned.source;
  if ("external_event_id" in payload) updates.external_event_id = result.cleaned.external_event_id;
  if ("source_calendar_id" in payload) updates.source_calendar_id = result.cleaned.source_calendar_id;
  if ("external_platform_hint" in payload) updates.external_platform_hint = result.cleaned.external_platform_hint;
  if ("external_event_title" in payload) updates.external_event_title = result.cleaned.external_event_title;
  if ("external_contact_name" in payload) updates.external_contact_name = result.cleaned.external_contact_name;
  if ("external_contact_email" in payload) updates.external_contact_email = result.cleaned.external_contact_email;
  if ("external_contact_phone" in payload) updates.external_contact_phone = result.cleaned.external_contact_phone;
  if ("sync_state" in payload) updates.sync_state = result.cleaned.sync_state;
  if ("intake_review_state" in payload) updates.intake_review_state = result.cleaned.intake_review_state;
  if ("imported_at" in payload) updates.imported_at = result.cleaned.imported_at;
  if ("last_synced_at" in payload) updates.last_synced_at = result.cleaned.last_synced_at;
  if ("external_updated_at" in payload) updates.external_updated_at = result.cleaned.external_updated_at;
  if ("intake_conflict_note" in payload) updates.intake_conflict_note = result.cleaned.intake_conflict_note;
  if ("pending_external_start" in payload) updates.pending_external_start = result.cleaned.pending_external_start;
  if ("pending_external_end" in payload) updates.pending_external_end = result.cleaned.pending_external_end;

  if ("source" in payload && result.cleaned.source === "manual") {
    updates.source_calendar_id = "";
    updates.external_platform_hint = "";
    updates.external_event_title = "";
    updates.external_contact_name = "";
    updates.external_contact_email = "";
    updates.external_contact_phone = "";
    updates.sync_state = "MANUAL";
    updates.intake_review_state = "MANUAL";
    updates.imported_at = "";
    updates.last_synced_at = "";
    updates.external_updated_at = "";
    updates.intake_conflict_note = "";
    updates.pending_external_start = "";
    updates.pending_external_end = "";
  }

  const scheduledStartChanged = "scheduled_start" in payload && lesson.scheduled_start !== result.cleaned.scheduled_start;
  const scheduledEndChanged = "scheduled_end" in payload && lesson.scheduled_end !== result.cleaned.scheduled_end;

  if (scheduledStartChanged) {
    updates.previous_scheduled_start = lesson.scheduled_start || null;
  }

  if (scheduledEndChanged) {
    updates.previous_scheduled_end = lesson.scheduled_end || null;
  }

  patchRecordById("lessons", lessonId, updates);

  return {
    ok: true,
    lesson: getLessonByIdForStore(lessonId)
  };
}

function setLessonStatus(lessonId, nextStatus) {
  const normalized = normalizeLessonStatusValue(nextStatus);

  const payload = {
    lesson_status: normalized
  };

  if (normalized === "COMPLETED") {
    payload.actual_completion_date = new Date().toISOString();
    payload.cancellation_type = "";
  }

  if (["CANCELLED", "LATE_CANCEL", "NO_SHOW"].includes(normalized)) {
    payload.actual_completion_date = "";
  }

  return updateLesson(lessonId, payload);
}

function getLessonReferenceDate(lesson) {
  return lesson?.actual_completion_date || lesson?.scheduled_end || lesson?.scheduled_start || "";
}

function getEffectiveLessonStatus(lesson, now = null) {
  const normalized = normalizeLessonStatusValue(lesson?.lesson_status || "SCHEDULED");

  if (normalized !== "SCHEDULED") {
    return normalized;
  }

  const referenceNow = now instanceof Date ? now : (typeof APP_NOW !== "undefined" ? new Date(APP_NOW) : new Date());
  const scheduledEnd = lesson?.scheduled_end ? new Date(lesson.scheduled_end) : null;

  if (scheduledEnd && !Number.isNaN(scheduledEnd.getTime()) && scheduledEnd <= referenceNow) {
    return "COMPLETED";
  }

  return normalized;
}

function isFreeIntroLesson(lesson) {
  const normalizedType = String(lesson?.lesson_type || "").trim().toUpperCase();
  return normalizedType === "FREE INTRO SESSION" || normalizedType === "INTRO SESSION";
}

function doesLessonRequireNotes(lesson) {
  return getEffectiveLessonStatus(lesson) === "COMPLETED";
}

function isLessonFinanceCountable(lesson) {
  const status = getEffectiveLessonStatus(lesson);
  if (isFreeIntroLesson(lesson)) return false;
  return ["COMPLETED", "LATE_CANCEL", "NO_SHOW"].includes(status);
}

function doesLessonConsumePackage(lesson) {
  return isLessonFinanceCountable(lesson) && lesson?.counts_against_package === true;
}

function isLessonPaygBillable(lesson) {
  return isLessonFinanceCountable(lesson) && lesson?.counts_against_package !== true;
}

function isImportedLesson(lesson) {
  return String(lesson?.source || "manual").toLowerCase() !== "manual" || Boolean(lesson?.external_event_id);
}

function isLessonIntakeActionRequired(lesson) {
  if (!isImportedLesson(lesson)) return false;

  const reviewState = normalizeLessonIntakeReviewStateValue(lesson?.intake_review_state, lesson?.source);
  const syncState = normalizeLessonSyncStateValue(lesson?.sync_state, lesson?.source);

  if (reviewState === "IGNORED") {
    return false;
  }

  return ["UNREVIEWED", "NEEDS_ATTENTION"].includes(reviewState) || ["UPDATED_EXTERNALLY", "NEEDS_REVIEW", "DISCONNECTED"].includes(syncState);
}

function setLessonIntakeReviewState(lessonId, nextState, conflictNote = null) {
  const lesson = getLessonByIdForStore(lessonId);
  if (!lesson) {
    return {
      ok: false,
      errors: ["Lesson not found."]
    };
  }

  const normalizedReviewState = normalizeLessonIntakeReviewStateValue(nextState, lesson.source);
  const payload = {
    intake_review_state: normalizedReviewState,
    last_synced_at: new Date().toISOString()
  };

  if (normalizedReviewState === "CONFIRMED") {
    payload.sync_state = "SYNCED";
    payload.intake_conflict_note = "";
    payload.pending_external_start = "";
    payload.pending_external_end = "";
  } else if (normalizedReviewState === "NEEDS_ATTENTION") {
    payload.sync_state = "NEEDS_REVIEW";
    payload.intake_conflict_note = typeof conflictNote === "string" ? conflictNote : (lesson.intake_conflict_note || "");
  } else if (normalizedReviewState === "IGNORED") {
    payload.intake_conflict_note = typeof conflictNote === "string" ? conflictNote : (lesson.intake_conflict_note || "");
  }

  return updateLesson(lessonId, payload);
}

function getLessonManualPaymentStatusLabel(value) {
  const normalized = normalizeLessonManualPaymentStatusValue(value);
  if (normalized === "PAID") return "Paid";
  if (normalized === "UNPAID") return "Unpaid";
  return "Not Marked";
}

function getLateCancelCountForStudent(studentId, months = 6) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);

  return getLessonRecords().filter((lesson) => {
    if (lesson.student_id !== studentId) return false;
    if (getEffectiveLessonStatus(lesson) !== "LATE_CANCEL") return false;
    const reference = getLessonReferenceDate(lesson);
    if (!reference) return false;
    const referenceDate = new Date(reference);
    if (Number.isNaN(referenceDate.getTime())) return false;
    return referenceDate >= cutoff;
  }).length;
}

function isStudentPublicPageBlockedByLessonPolicy(studentId) {
  return getLateCancelCountForStudent(studentId, 6) >= 3;
}
