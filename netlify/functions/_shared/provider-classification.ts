export type IntakeDisposition = "auto_import" | "needs_review" | "ignore";

export type IntakeProvider =
  | "lessonface"
  | "wyzant"
  | "lessons_com"
  | "acuity"
  | "google_calendar"
  | "gmail";

export type IntakeChangeType =
  | "confirmation"
  | "reschedule"
  | "cancellation";

export interface IntakeParsedOccurrence {
  startsAt: string;
  endsAt?: string;
}

export interface IntakeMatchContext {
  studentId?: string;
  lessonId?: string;
  matchedBy?: string;
  confidence?: number;
  /** Calendar/provider attendee or title data is sufficient to create a lead. */
  identityEvidence?: boolean;
}

export interface IntakeStudentIdentity {
  id: string;
  full_name: string;
  preferred_name?: string | null;
  email?: string | null;
  guardian_name?: string | null;
  guardian_email?: string | null;
}

const normalizeIdentity = (value?: string | null) =>
  (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim();

export function matchStudentIdentity<T extends IntakeStudentIdentity>(
  students: T[],
  text: string,
  emails: string[],
) {
  const normalizedEmails = emails.map(normalizeIdentity);
  const byEmail = students.find((student) =>
    [student.email, student.guardian_email].some(
      (value) => value && normalizedEmails.includes(normalizeIdentity(value)),
    ),
  );
  if (byEmail)
    return { student: byEmail, matchedBy: "email", confidence: 0.99 };
  const haystack = ` ${normalizeIdentity(text)} `;
  const byName = students.find((student) =>
    [student.full_name, student.preferred_name, student.guardian_name]
      .filter(Boolean)
      .some((value) => {
        const name = normalizeIdentity(value);
        return name.length >= 4 && haystack.includes(` ${name} `);
      }),
  );
  return byName
    ? {
        student: byName,
        matchedBy: "student or guardian name",
        confidence: 0.91,
      }
    : undefined;
}

export interface IntakeDecision {
  disposition: IntakeDisposition;
  confidence: number;
  reasonCode: string;
  provider: IntakeProvider;
  changeType: IntakeChangeType;
  parsedOccurrence?: IntakeParsedOccurrence;
  matchContext?: IntakeMatchContext;
}

export interface ClassifyProviderIntakeInput {
  source: "gmail" | "google_calendar";
  text: string;
  provider?: IntakeProvider;
  changeType?: IntakeChangeType;
  parsedOccurrence?: IntakeParsedOccurrence;
  matchContext?: IntakeMatchContext;
  duplicate?: boolean;
}

const boundedConfidence = (value: number) =>
  Math.max(0, Math.min(1, Number(value.toFixed(3))));

export function providerFromText(text: string): IntakeProvider | undefined {
  return /lessonface/i.test(text)
    ? "lessonface"
    : /wyzant/i.test(text)
      ? "wyzant"
      : /lessons\.com/i.test(text)
        ? "lessons_com"
        : /(acuity|squarespace scheduling)/i.test(text)
          ? "acuity"
          : undefined;
}

const explicitLessonContext = (text: string) =>
  /\b(lessons?|coaching|acting sessions?|audition (?:coaching|prep|sessions?)|voice sessions?|scene study|classes?)\b/i.test(
    text,
  );

const plausibleLessonContext = (text: string) =>
  explicitLessonContext(text) ||
  /\b(acting|audition|consultation|practice session|rehearsal)\b/i.test(text);

const explicitBooking = (text: string) =>
  /\b(booked|booking (?:confirmed|confirmation)|confirmed|scheduled|upcoming|new (?:lesson|session|booking)|(?:lesson|session) (?:request )?accepted|reservation|lesson reminder|session reminder|starts? (?:soon|in))\b/i.test(
    text,
  );

const changeFromText = (text: string): IntakeChangeType =>
  /\b(cancelled|canceled|cancellation)\b/i.test(text)
    ? "cancellation"
    : /\b(rescheduled|reschedule|new (?:date|time))\b/i.test(text)
      ? "reschedule"
      : "confirmation";

function decision(
  input: ClassifyProviderIntakeInput,
  disposition: IntakeDisposition,
  confidence: number,
  reasonCode: string,
  provider: IntakeProvider,
  changeType: IntakeChangeType,
): IntakeDecision {
  return {
    disposition,
    confidence: boundedConfidence(confidence),
    reasonCode,
    provider,
    changeType,
    ...(input.parsedOccurrence
      ? { parsedOccurrence: input.parsedOccurrence }
      : {}),
    ...(input.matchContext ? { matchContext: input.matchContext } : {}),
  };
}

/**
 * The single trust decision used by both Gmail and Calendar intake.
 * It intentionally prefers review/ignore over inventing a student or lesson.
 */
export function classifyProviderIntake(
  input: ClassifyProviderIntakeInput,
): IntakeDecision {
  const text = input.text.replace(/\s+/g, " ").trim();
  const detected =
    input.provider || providerFromText(text) || (input.source as IntakeProvider);
  const changeType = input.changeType || changeFromText(text);
  const matchConfidence = input.matchContext?.confidence || 0;
  const hasStudent = Boolean(input.matchContext?.studentId);
  const hasTargetLesson = Boolean(input.matchContext?.lessonId);
  const hasIdentity = Boolean(input.matchContext?.identityEvidence);
  const hasOccurrence = Boolean(input.parsedOccurrence?.startsAt);
  const hasLesson = explicitLessonContext(text);
  const isPlausibleLesson = plausibleLessonContext(text);
  const supportedProvider = !["gmail", "google_calendar"].includes(detected);

  if (input.duplicate) {
    return decision(
      input,
      "ignore",
      1,
      "duplicate_existing_lesson",
      detected,
      changeType,
    );
  }

  if (
    /\b(newsletter|weekly digest|digest email|promotion|special offer|marketing update)\b/i.test(
      text,
    )
  ) {
    return decision(
      input,
      "ignore",
      0.99,
      "non_booking_newsletter",
      detected,
      changeType,
    );
  }

  if (
    changeType === "confirmation" &&
    /\b(receipt|invoice|payment|payout|billing statement|refund receipt)\b/i.test(
      text,
    )
  ) {
    return decision(
      input,
      "ignore",
      0.98,
      "non_booking_financial_message",
      detected,
      changeType,
    );
  }

  if (
    /\b(timelycare|medical|doctor|dentist|dental|therapy|therapist|healthcare|health care|clinic|patient|telehealth|prescription)\b/i.test(
      text,
    )
  ) {
    return decision(
      input,
      "ignore",
      0.99,
      "medical_or_health_appointment",
      detected,
      changeType,
    );
  }

  if (
    /\b(birthday|anniversary|vacation|holiday|dinner|lunch|breakfast|flight|travel|personal appointment|family event)\b/i.test(
      text,
    )
  ) {
    return decision(
      input,
      "ignore",
      0.98,
      "personal_calendar_event",
      detected,
      changeType,
    );
  }

  if (/\brehearsal\b/i.test(text) && !hasStudent && !hasTargetLesson) {
    return decision(
      input,
      "ignore",
      0.96,
      "unmatched_rehearsal",
      detected,
      changeType,
    );
  }

  if (/\bcancellation policy\b/i.test(text)) {
    return decision(
      input,
      "ignore",
      0.98,
      "provider_policy_message",
      detected,
      changeType,
    );
  }

  if (
    /\b(inquiry|new message|unread message|review request|profile update)\b/i.test(
      text,
    ) &&
    changeType === "confirmation"
  ) {
    return decision(
      input,
      "ignore",
      0.96,
      "provider_message_not_booking",
      detected,
      changeType,
    );
  }

  if (changeType !== "confirmation") {
    if (
      supportedProvider &&
      hasTargetLesson &&
      (hasLesson || /\b(lessons?|sessions?|bookings?|classes?)\b/i.test(text)) &&
      (changeType === "cancellation" || hasOccurrence)
    ) {
      return decision(
        input,
        "auto_import",
        Math.max(0.97, matchConfidence),
        `matched_provider_${changeType}`,
        detected,
        changeType,
      );
    }
    if (
      supportedProvider &&
      hasStudent &&
      hasLesson &&
      (changeType === "cancellation" || hasOccurrence)
    ) {
      return decision(
        input,
        "auto_import",
        Math.max(0.9, matchConfidence),
        `matched_student_${changeType}`,
        detected,
        changeType,
      );
    }
    if (supportedProvider && (hasLesson || isPlausibleLesson)) {
      return decision(
        input,
        "needs_review",
        0.72,
        `unmatched_provider_${changeType}`,
        detected,
        changeType,
      );
    }
    return decision(
      input,
      "ignore",
      0.9,
      "change_without_lesson_context",
      detected,
      changeType,
    );
  }

  if (
    input.source === "google_calendar" &&
    hasStudent &&
    matchConfidence >= 0.9 &&
    hasLesson &&
    hasOccurrence
  ) {
    return decision(
      input,
      "auto_import",
      matchConfidence,
      "matched_calendar_lesson",
      detected,
      changeType,
    );
  }

  if (
    supportedProvider &&
    (explicitBooking(text) || input.source === "google_calendar") &&
    hasLesson &&
    hasOccurrence &&
    (hasStudent || hasIdentity)
  ) {
    return decision(
      input,
      "auto_import",
      Math.max(hasStudent ? matchConfidence : 0.86, 0.86),
      "supported_provider_confirmation",
      detected,
      changeType,
    );
  }

  if (
    supportedProvider &&
    explicitBooking(text) &&
    (hasLesson || isPlausibleLesson)
  ) {
    return decision(
      input,
      "needs_review",
      hasOccurrence ? 0.76 : 0.66,
      hasOccurrence
        ? "provider_confirmation_missing_identity"
        : "provider_confirmation_missing_time",
      detected,
      changeType,
    );
  }

  if (
    hasOccurrence &&
    isPlausibleLesson &&
    (hasStudent || hasIdentity || supportedProvider)
  ) {
    return decision(
      input,
      "needs_review",
      Math.max(0.55, Math.min(0.75, matchConfidence || 0.6)),
      "plausible_lesson_needs_review",
      detected,
      changeType,
    );
  }

  if (/\b(appointment|visit|meeting|call)\b/i.test(text) && !hasLesson) {
    return decision(
      input,
      "ignore",
      0.92,
      "general_appointment_without_lesson_context",
      detected,
      changeType,
    );
  }

  return decision(
    input,
    "ignore",
    0.9,
    "no_concrete_lesson_booking",
    detected,
    changeType,
  );
}
