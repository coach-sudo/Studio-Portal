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
  const phone = String(payload.phone || "").trim();
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

  if ((!isEdit || "email" in payload) && email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push("Enter a valid email address.");
  }

  if (!isEdit) {
    if (!email && !phone) {
      errors.push("Provide at least an email or phone number.");
    }
  } else if (("email" in payload || "phone" in payload) && !email && !phone) {
    errors.push("Provide at least an email or phone number.");
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
      phone,
      timezone,
      studio_status: studioStatus,
      billing_model: billingModel,
      booking_behavior: bookingBehavior,
      lead_source: leadSource,
      lead_source_detail: leadSourceDetail,
      focus_area: focusArea,
      actor_page_eligible: actorPageEligible
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
    phone: result.cleaned.phone,
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
  if ("phone" in payload) updates.phone = result.cleaned.phone;
  if ("timezone" in payload) updates.timezone = result.cleaned.timezone;
  if ("studio_status" in payload) updates.studio_status = result.cleaned.studio_status;
  if ("billing_model" in payload) updates.billing_model = result.cleaned.billing_model;
  if ("booking_behavior" in payload) updates.booking_behavior = result.cleaned.booking_behavior;
  if ("lead_source" in payload) updates.lead_source = result.cleaned.lead_source;
  if ("lead_source_detail" in payload) updates.lead_source_detail = result.cleaned.lead_source_detail;
  if ("focus_area" in payload) updates.focus_area = result.cleaned.focus_area;
  if ("actor_page_eligible" in payload) updates.actor_page_eligible = result.cleaned.actor_page_eligible;

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
