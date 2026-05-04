function padNumber(num, size = 6) {
  return String(num).padStart(size, "0");
}

function getNextStudentId() {
  const maxId = getStudentRecords().reduce((max, student) => {
    const match = String(student.student_id || "").match(/^STU-(\d{6})$/);
    if (!match) return max;
    return Math.max(max, Number(match[1]));
  }, 0);

  return `STU-${padNumber(maxId + 1)}`;
}

function splitFullName(fullName) {
  const cleaned = String(fullName || "").trim().replace(/\s+/g, " ");
  if (!cleaned) {
    return { first_name: "", last_name: "", full_name: "" };
  }

  const parts = cleaned.split(" ");
  const first_name = parts.shift() || "";
  const last_name = parts.join(" ");
  return {
    first_name,
    last_name,
    full_name: cleaned
  };
}

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function normalizeEmailListValue(value) {
  return Array.from(new Set(
    String(value || "")
      .split(/[,\n;]/)
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean)
  )).join(", ");
}

function normalizePhoneListValue(value) {
  return Array.from(new Set(
    String(value || "")
      .split(/[,\n;]/)
      .map((entry) => String(entry || "").trim())
      .filter(Boolean)
  )).join(", ");
}

function normalizeBoolean(value) {
  return Boolean(value);
}

function normalizeStudioStatusValue(value) {
  const raw = String(value || "").trim().toUpperCase();

  if (["LEAD", "ACTIVE", "PAUSED", "INACTIVE", "ALUMNI"].includes(raw)) {
    return raw;
  }

  const map = {
    "LEAD": "LEAD",
    "ACTIVE": "ACTIVE",
    "PAUSED": "PAUSED",
    "INACTIVE": "INACTIVE",
    "ALUMNI": "ALUMNI",
    "Lead": "LEAD",
    "Active": "ACTIVE",
    "Paused": "PAUSED",
    "Inactive": "INACTIVE",
    "Alumni": "ALUMNI"
  };

  return map[value] || raw;
}

function normalizeBillingModelValue(value) {
  const raw = String(value || "").trim().toUpperCase();

  if (["PAYG", "PACKAGE", "CUSTOM"].includes(raw)) {
    return raw;
  }

  const map = {
    "Pay-as-you-go": "PAYG",
    "Package": "PACKAGE",
    "Custom": "CUSTOM"
  };

  return map[value] || raw;
}

function normalizeBookingBehaviorValue(value) {
  const raw = String(value || "").trim().toUpperCase();

  if (["SELF_BOOKING", "COACH_BOOKED", "MIXED"].includes(raw)) {
    return raw;
  }

  const map = {
    "Self-Booking": "SELF_BOOKING",
    "Coach-Booked": "COACH_BOOKED",
    "Mixed/Transitioning": "MIXED"
  };

  return map[value] || raw;
}

function normalizeLeadSourceValue(value) {
  const raw = String(value || "").trim().toUpperCase();

  if (!raw) return "";
  if (["LESSONS_COM", "LESSONFACE", "ACUITY", "WORD_OF_MOUTH", "FLYER", "GOOGLE", "DIRECT", "REFERRAL", "OTHER"].includes(raw)) {
    return raw;
  }

  const map = {
    "Lessons.com": "LESSONS_COM",
    "Lessonface": "LESSONFACE",
    "Acuity": "ACUITY",
    "Word of Mouth": "WORD_OF_MOUTH",
    "Flyer": "FLYER",
    "Google": "GOOGLE",
    "Direct": "DIRECT",
    "Referral": "REFERRAL",
    "Other": "OTHER"
  };

  return map[value] || raw;
}

function validateStudentPayload(payload, { isEdit = false } = {}) {
  const errors = [];

  const fullName = String(payload.full_name || "").trim();
  const email = String(payload.email || "").trim();
  const additionalEmails = normalizeEmailListValue(payload.additional_emails || "");
  const phone = String(payload.phone || "").trim();
  const additionalPhones = normalizePhoneListValue(payload.additional_phones || "");
  const guardianName = String(payload.guardian_name || "").trim();
  const guardianEmail = String(payload.guardian_email || "").trim();
  const guardianPhone = String(payload.guardian_phone || "").trim();
  const preferredContactMethod = String(payload.preferred_contact_method || "").trim().toUpperCase();
  const preferredContactName = String(payload.preferred_contact_name || "").trim();
  const preferredContactEmail = String(payload.preferred_contact_email || "").trim();
  const preferredContactPhone = String(payload.preferred_contact_phone || "").trim();
  const emergencyContactName = String(payload.emergency_contact_name || "").trim();
  const emergencyContactPhone = String(payload.emergency_contact_phone || "").trim();
  const businessNotes = String(payload.business_notes || "").trim();
  const timezone = String(payload.timezone || "").trim();
  const studioStatus = normalizeStudioStatusValue(payload.studio_status);
  const billingModel = normalizeBillingModelValue(payload.billing_model);
  const bookingBehavior = normalizeBookingBehaviorValue(payload.booking_behavior);
  const leadSource = normalizeLeadSourceValue(payload.lead_source);
  const leadSourceDetail = String(payload.lead_source_detail || "").trim();
  const focusArea = String(payload.focus_area || "").trim();
  const actorPageEligible = normalizeBoolean(payload.actor_page_eligible);

  if (!isEdit || "full_name" in payload) {
    if (!fullName) errors.push("Full name is required.");
  }

  if ((!isEdit || "email" in payload) && email && !isValidEmailAddress(email)) {
    errors.push("Enter a valid email address.");
  }

  if (additionalEmails) {
    const invalidAdditionalEmail = additionalEmails
      .split(",")
      .map((entry) => entry.trim())
      .find((entry) => entry && !isValidEmailAddress(entry));

    if (invalidAdditionalEmail) {
      errors.push(`Enter a valid additional email address. "${invalidAdditionalEmail}" is not valid.`);
    }
  }

  if (guardianEmail && !isValidEmailAddress(guardianEmail)) {
    errors.push("Enter a valid guardian email address.");
  }

  if (preferredContactEmail && !isValidEmailAddress(preferredContactEmail)) {
    errors.push("Enter a valid preferred contact email address.");
  }

  if (preferredContactMethod && !["STUDENT", "GUARDIAN", "EMAIL", "PHONE", "TEXT", "OTHER"].includes(preferredContactMethod)) {
    errors.push("Preferred contact method must be STUDENT, GUARDIAN, EMAIL, PHONE, TEXT, or OTHER.");
  }

  if (!isEdit) {
    if (!email && !phone && !guardianEmail && !guardianPhone) {
      errors.push("Provide at least a direct or guardian email / phone number.");
    }
  } else if (("email" in payload || "phone" in payload || "guardian_email" in payload || "guardian_phone" in payload) && !email && !phone && !guardianEmail && !guardianPhone) {
    errors.push("Provide at least a direct or guardian email / phone number.");
  }

  if (!["LEAD", "ACTIVE", "PAUSED", "INACTIVE", "ALUMNI"].includes(studioStatus)) {
    errors.push("Studio status must be LEAD, ACTIVE, PAUSED, INACTIVE, or ALUMNI.");
  }

  if (!["PAYG", "PACKAGE", "CUSTOM"].includes(billingModel)) {
    errors.push("Billing model must be PAYG, PACKAGE, or CUSTOM.");
  }

  if (!["SELF_BOOKING", "COACH_BOOKED", "MIXED"].includes(bookingBehavior)) {
    errors.push("Booking behavior must be SELF_BOOKING, COACH_BOOKED, or MIXED.");
  }

  if (leadSource && !["LESSONS_COM", "LESSONFACE", "ACUITY", "WORD_OF_MOUTH", "FLYER", "GOOGLE", "DIRECT", "REFERRAL", "OTHER"].includes(leadSource)) {
    errors.push("Lead source must be LESSONS_COM, LESSONFACE, ACUITY, WORD_OF_MOUTH, FLYER, GOOGLE, DIRECT, REFERRAL, or OTHER.");
  }

  return {
    ok: errors.length === 0,
    errors,
    cleaned: {
      ...splitFullName(fullName),
      email,
      additional_emails: additionalEmails,
      phone,
      additional_phones: additionalPhones,
      guardian_name: guardianName,
      guardian_email: guardianEmail,
      guardian_phone: guardianPhone,
      preferred_contact_method: preferredContactMethod,
      preferred_contact_name: preferredContactName,
      preferred_contact_email: preferredContactEmail,
      preferred_contact_phone: preferredContactPhone,
      emergency_contact_name: emergencyContactName,
      emergency_contact_phone: emergencyContactPhone,
      business_notes: businessNotes,
      timezone,
      studio_status: studioStatus,
      billing_model: billingModel,
      booking_behavior: bookingBehavior,
      lead_source: leadSource,
      lead_source_detail: leadSourceDetail,
      focus_area: focusArea,
      actor_page_eligible: actorPageEligible,
      portal_access_enabled: payload.portal_access_enabled !== false,
      guardian_portal_access_enabled: payload.guardian_portal_access_enabled !== false,
      student_is_minor: payload.student_is_minor === true,
      portal_student_finance_access: payload.portal_student_finance_access !== false,
      portal_guardian_finance_access: payload.portal_guardian_finance_access === true,
      portal_minor_finance_access: payload.portal_minor_finance_access === true,
      portal_notes_access: payload.portal_notes_access !== false,
      portal_homework_access: payload.portal_homework_access !== false,
      portal_materials_access: payload.portal_materials_access !== false,
      portal_public_page_access: payload.portal_public_page_access !== false,
      portal_script_access: payload.portal_script_access !== false
    }
  };
}

function getSchemaStudentByIdForStore(studentId) {
  return getStudentRecords().find((student) => student.student_id === studentId) || null;
}

function createStudent(payload) {
  const result = validateStudentPayload(payload);

  if (!result.ok) {
    return result;
  }

  const now = new Date().toISOString().slice(0, 10);

  const newStudent = {
    student_id: getNextStudentId(),
    first_name: result.cleaned.first_name,
    last_name: result.cleaned.last_name,
    full_name: result.cleaned.full_name,
    email: result.cleaned.email,
    additional_emails: result.cleaned.additional_emails,
    phone: result.cleaned.phone,
    additional_phones: result.cleaned.additional_phones,
    guardian_name: result.cleaned.guardian_name,
    guardian_email: result.cleaned.guardian_email,
    guardian_phone: result.cleaned.guardian_phone,
    preferred_contact_method: result.cleaned.preferred_contact_method,
    preferred_contact_name: result.cleaned.preferred_contact_name,
    preferred_contact_email: result.cleaned.preferred_contact_email,
    preferred_contact_phone: result.cleaned.preferred_contact_phone,
    emergency_contact_name: result.cleaned.emergency_contact_name,
    emergency_contact_phone: result.cleaned.emergency_contact_phone,
    business_notes: result.cleaned.business_notes,
    timezone: result.cleaned.timezone,
    studio_status: result.cleaned.studio_status,
    billing_model: result.cleaned.billing_model,
    booking_behavior: result.cleaned.booking_behavior,
    lead_source: result.cleaned.lead_source,
    lead_source_detail: result.cleaned.lead_source_detail,
    focus_area: result.cleaned.focus_area,
    actor_page_eligible: result.cleaned.actor_page_eligible,
    actor_profile_id: null,
    actor_page_status: null,
    portal_access_enabled: result.cleaned.portal_access_enabled,
    guardian_portal_access_enabled: result.cleaned.guardian_portal_access_enabled,
    student_is_minor: result.cleaned.student_is_minor,
    portal_student_finance_access: result.cleaned.portal_student_finance_access,
    portal_guardian_finance_access: result.cleaned.portal_guardian_finance_access,
    portal_minor_finance_access: result.cleaned.portal_minor_finance_access,
    portal_notes_access: result.cleaned.portal_notes_access,
    portal_homework_access: result.cleaned.portal_homework_access,
    portal_materials_access: result.cleaned.portal_materials_access,
    portal_public_page_access: result.cleaned.portal_public_page_access,
    portal_script_access: result.cleaned.portal_script_access,
    created_at: now,
    updated_at: now
  };

  insertRecord("students", newStudent, { prepend: true });

  return {
    ok: true,
    student: newStudent
  };
}

function updateStudent(studentId, payload) {
  const student = getSchemaStudentByIdForStore(studentId);

  if (!student) {
    return {
      ok: false,
      errors: ["Student not found."]
    };
  }

  const result = validateStudentPayload(payload, { isEdit: true });

  if (!result.ok) {
    return result;
  }

  const updates = {
    updated_at: new Date().toISOString().slice(0, 10)
  };

  if ("full_name" in payload) {
    updates.first_name = result.cleaned.first_name;
    updates.last_name = result.cleaned.last_name;
    updates.full_name = result.cleaned.full_name;
  }

  if ("email" in payload) updates.email = result.cleaned.email;
  if ("additional_emails" in payload) updates.additional_emails = result.cleaned.additional_emails;
  if ("phone" in payload) updates.phone = result.cleaned.phone;
  if ("additional_phones" in payload) updates.additional_phones = result.cleaned.additional_phones;
  if ("guardian_name" in payload) updates.guardian_name = result.cleaned.guardian_name;
  if ("guardian_email" in payload) updates.guardian_email = result.cleaned.guardian_email;
  if ("guardian_phone" in payload) updates.guardian_phone = result.cleaned.guardian_phone;
  if ("preferred_contact_method" in payload) updates.preferred_contact_method = result.cleaned.preferred_contact_method;
  if ("preferred_contact_name" in payload) updates.preferred_contact_name = result.cleaned.preferred_contact_name;
  if ("preferred_contact_email" in payload) updates.preferred_contact_email = result.cleaned.preferred_contact_email;
  if ("preferred_contact_phone" in payload) updates.preferred_contact_phone = result.cleaned.preferred_contact_phone;
  if ("emergency_contact_name" in payload) updates.emergency_contact_name = result.cleaned.emergency_contact_name;
  if ("emergency_contact_phone" in payload) updates.emergency_contact_phone = result.cleaned.emergency_contact_phone;
  if ("business_notes" in payload) updates.business_notes = result.cleaned.business_notes;
  if ("timezone" in payload) updates.timezone = result.cleaned.timezone;
  if ("studio_status" in payload) updates.studio_status = result.cleaned.studio_status;
  if ("billing_model" in payload) updates.billing_model = result.cleaned.billing_model;
  if ("booking_behavior" in payload) updates.booking_behavior = result.cleaned.booking_behavior;
  if ("lead_source" in payload) updates.lead_source = result.cleaned.lead_source;
  if ("lead_source_detail" in payload) updates.lead_source_detail = result.cleaned.lead_source_detail;
  if ("focus_area" in payload) updates.focus_area = result.cleaned.focus_area;
  if ("actor_page_eligible" in payload) updates.actor_page_eligible = result.cleaned.actor_page_eligible;
  if ("portal_access_enabled" in payload) updates.portal_access_enabled = result.cleaned.portal_access_enabled;
  if ("guardian_portal_access_enabled" in payload) updates.guardian_portal_access_enabled = result.cleaned.guardian_portal_access_enabled;
  if ("student_is_minor" in payload) updates.student_is_minor = result.cleaned.student_is_minor;
  if ("portal_student_finance_access" in payload) updates.portal_student_finance_access = result.cleaned.portal_student_finance_access;
  if ("portal_guardian_finance_access" in payload) updates.portal_guardian_finance_access = result.cleaned.portal_guardian_finance_access;
  if ("portal_minor_finance_access" in payload) updates.portal_minor_finance_access = result.cleaned.portal_minor_finance_access;
  if ("portal_notes_access" in payload) updates.portal_notes_access = result.cleaned.portal_notes_access;
  if ("portal_homework_access" in payload) updates.portal_homework_access = result.cleaned.portal_homework_access;
  if ("portal_materials_access" in payload) updates.portal_materials_access = result.cleaned.portal_materials_access;
  if ("portal_public_page_access" in payload) updates.portal_public_page_access = result.cleaned.portal_public_page_access;
  if ("portal_script_access" in payload) updates.portal_script_access = result.cleaned.portal_script_access;

  patchRecordById("students", studentId, updates);

  return {
    ok: true,
    student: getSchemaStudentByIdForStore(studentId)
  };
}

function setStudentStatus(studentId, nextStatus) {
  const student = getSchemaStudentById(studentId);
  if (!student) {
    return {
      ok: false,
      errors: ["Student not found."]
    };
  }

  return updateStudent(studentId, {
    studio_status: normalizeStudioStatusValue(nextStatus),
    billing_model: student.billing_model,
    booking_behavior: student.booking_behavior,
    lead_source: student.lead_source || "",
    lead_source_detail: student.lead_source_detail || "",
    full_name: student.full_name,
    email: student.email,
    phone: student.phone || "",
    timezone: student.timezone || "",
    focus_area: student.focus_area || "",
    actor_page_eligible: Boolean(student.actor_page_eligible)
  });
}
