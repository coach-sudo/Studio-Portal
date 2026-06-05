const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function getEnv(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function getAppsScriptUrl() {
  return getEnv("GOOGLE_APPS_SCRIPT_URL") || getEnv("NETLIFY_GAS_URL");
}

function getAppsScriptToken() {
  return getEnv("GOOGLE_APPS_SCRIPT_TOKEN") || getEnv("STUDIO_PORTAL_TOKEN");
}

function getHeader(event, key) {
  const headers = event && event.headers ? event.headers : {};
  return headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()] || "";
}

function getRawBody(event) {
  return event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : String(event.body || "");
}

function verifyStripeSignature(rawBody, signatureHeader) {
  const secret = getEnv("STRIPE_WEBHOOK_SECRET");
  if (!secret) throw new Error("Missing STRIPE_WEBHOOK_SECRET.");
  const parts = String(signatureHeader || "").split(",").reduce((acc, part) => {
    const [key, value] = part.split("=");
    if (key && value) {
      acc[key.trim()] = acc[key.trim()] || [];
      acc[key.trim()].push(value.trim());
    }
    return acc;
  }, {});
  const timestamp = parts.t && parts.t[0];
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) throw new Error("Missing Stripe signature.");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const valid = signatures.some((signature) => {
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
  });
  if (!valid) throw new Error("Invalid Stripe signature.");
}

function loadLocalSampleSnapshot() {
  const schemaPath = path.resolve(__dirname, "../../assets/js/schema.js");
  const source = fs.readFileSync(schemaPath, "utf8");
  const script = new vm.Script(`${source}
    ;({
      students: sampleStudents,
      lessons: sampleLessons,
      notes: sampleNotes,
      homework: sampleHomework,
      packages: samplePackages,
      payments: samplePayments,
      actorProfiles: sampleActorProfiles,
      files: sampleFiles,
      studentAccounts: typeof sampleStudentAccounts !== "undefined" ? sampleStudentAccounts : [],
      readerRequests: typeof sampleReaderRequests !== "undefined" ? sampleReaderRequests : []
    });`);
  return script.runInNewContext({ console, Date, Math, JSON });
}

async function fetchAppsScriptSnapshot() {
  const url = getAppsScriptUrl();
  const token = getAppsScriptToken();
  if (!url || !token) return null;
  const response = await fetch(`${url}?action=snapshot&token=${encodeURIComponent(token)}`, {
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || "Unable to load studio snapshot.");
  return payload.snapshot || payload.data || payload;
}

async function pushAppsScriptSnapshot(snapshot) {
  const url = getAppsScriptUrl();
  const token = getAppsScriptToken();
  if (!url || !token) return null;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      action: "push_snapshot",
      token,
      snapshot
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || "Unable to save Stripe payment.");
  return payload;
}

async function loadTrustedSnapshot() {
  return await fetchAppsScriptSnapshot() || loadLocalSampleSnapshot();
}

function nextId(records, prefix, fieldName) {
  const year = new Date().getFullYear();
  const max = (records || []).reduce((value, record) => {
    const match = String(record[fieldName] || "").match(new RegExp(`^${prefix}-${year}-(\\d{6})$`));
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `${prefix}-${year}-${String(max + 1).padStart(6, "0")}`;
}

function upsertStripePayment(snapshot, session) {
  const metadata = session.metadata || {};
  const now = new Date().toISOString();
  snapshot.payments = Array.isArray(snapshot.payments) ? snapshot.payments : [];
  const existing = snapshot.payments.find((payment) => payment.external_reference === session.id);
  const amount = Number(session.amount_total || 0) / 100;
  const payment = existing || {
    payment_id: nextId(snapshot.payments, "PAY", "payment_id"),
    created_at: now
  };
  payment.student_id = metadata.student_id || payment.student_id || "";
  payment.related_package_id = metadata.package_id || payment.related_package_id || "";
  payment.related_lesson_id = "";
  payment.amount = String(amount);
  payment.currency = String(session.currency || "usd").toUpperCase();
  payment.payment_date = now;
  payment.payment_type = "STRIPE_CHECKOUT";
  payment.applies_to = "PACKAGE";
  payment.review_state = "CONFIRMED";
  payment.import_source = "STRIPE";
  payment.external_reference = session.id;
  payment.match_confidence = "100";
  payment.review_note = `Stripe checkout confirmed for ${metadata.package_name || "package renewal"}.`;
  payment.status = String(session.payment_status || "paid").toUpperCase();
  payment.archived_at = "";
  payment.updated_at = now;
  if (!existing) snapshot.payments.push(payment);

  const pkg = (snapshot.packages || []).find((row) => row.package_id === metadata.package_id && row.student_id === metadata.student_id);
  if (pkg) {
    pkg.payment_status = "PAID";
    pkg.package_lifecycle_status = "ACTIVE";
    pkg.status = "Active";
    pkg.updated_at = now;
  }
  return payment;
}

exports.handler = async function (event) {
  try {
    if (String(event.httpMethod || "").toUpperCase() !== "POST") {
      return json(405, { ok: false, error: "Method not allowed." });
    }
    const rawBody = getRawBody(event);
    verifyStripeSignature(rawBody, getHeader(event, "stripe-signature"));
    const stripeEvent = JSON.parse(rawBody);
    if (stripeEvent.type !== "checkout.session.completed") {
      return json(200, { ok: true, ignored: stripeEvent.type });
    }
    const session = stripeEvent.data && stripeEvent.data.object;
    if (!session || !session.id) throw new Error("Stripe checkout session payload missing.");
    const snapshot = await loadTrustedSnapshot();
    const payment = upsertStripePayment(snapshot, session);
    await pushAppsScriptSnapshot(snapshot);
    return json(200, { ok: true, payment_id: payment.payment_id });
  } catch (error) {
    return json(400, {
      ok: false,
      error: String(error && error.message ? error.message : error || "Stripe webhook failed.")
    });
  }
};
