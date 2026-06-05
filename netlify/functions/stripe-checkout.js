const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const SESSION_COOKIE_NAME = "studio_student_session";

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

function getHeader(event, key) {
  const headers = event && event.headers ? event.headers : {};
  return headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()] || "";
}

function parseCookies(event) {
  return String(getHeader(event, "cookie") || "").split(";").reduce((cookies, part) => {
    const index = part.indexOf("=");
    if (index === -1) return cookies;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(encodedPayload) {
  const secret = getEnv("STUDENT_PORTAL_SESSION_SECRET");
  if (!secret) throw new Error("Missing STUDENT_PORTAL_SESSION_SECRET.");
  return crypto.createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function verifySignedSession(token) {
  const [encodedPayload, signature] = String(token || "").split(".");
  if (!encodedPayload || !signature) return null;
  const expected = signPayload(encodedPayload);
  const provided = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");
  if (provided.length !== expectedBuffer.length || !crypto.timingSafeEqual(provided, expectedBuffer)) return null;
  const payload = JSON.parse(decodeBase64Url(encodedPayload));
  if (!payload || !payload.student_id || !payload.email || !payload.exp || Date.now() > Number(payload.exp)) return null;
  return payload;
}

function loadLocalSampleSnapshot() {
  const schemaPath = path.resolve(__dirname, "../../assets/js/schema.js");
  const source = fs.readFileSync(schemaPath, "utf8");
  const script = new vm.Script(`${source}
    ;({
      students: sampleStudents,
      packages: samplePackages,
      studentAccounts: typeof sampleStudentAccounts !== "undefined" ? sampleStudentAccounts : []
    });`);
  return script.runInNewContext({ console, Date, Math, JSON });
}

async function fetchAppsScriptSnapshot() {
  const url = getEnv("GOOGLE_APPS_SCRIPT_URL") || getEnv("NETLIFY_GAS_URL");
  const token = getEnv("GOOGLE_APPS_SCRIPT_TOKEN") || getEnv("STUDIO_PORTAL_TOKEN");
  if (!url || !token) return null;
  const response = await fetch(`${url}?action=snapshot&token=${encodeURIComponent(token)}`, {
    headers: { Accept: "application/json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || "Unable to load studio snapshot.");
  return payload.snapshot || payload.data || payload;
}

async function loadTrustedSnapshot() {
  return await fetchAppsScriptSnapshot() || loadLocalSampleSnapshot();
}

function getSiteBaseUrl(event) {
  const envUrl = getEnv("URL") || getEnv("DEPLOY_PRIME_URL");
  if (envUrl) return envUrl.replace(/\/$/, "");
  const protocol = getHeader(event, "x-forwarded-proto") || "https";
  const host = getHeader(event, "host");
  return host ? `${protocol}://${host}` : "";
}

function getPriceMap() {
  const raw = getEnv("STRIPE_PACKAGE_PRICE_MAP") || getEnv("STUDENT_PORTAL_STRIPE_PRICE_MAP") || "{}";
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    return {};
  }
}

function getPackagePriceId(pkg, body) {
  const explicit = String(body.price_id || body.stripe_price_id || "").trim();
  if (explicit) return explicit;
  const map = getPriceMap();
  return String(
    map[pkg.package_id] ||
    map[pkg.package_name] ||
    map.default ||
    ""
  ).trim();
}

function canRenewPackage(identity, student, pkg) {
  if (!identity || !student || !pkg) return false;
  if (String(pkg.student_id || "") !== String(identity.student_id || "")) return false;
  if (String(identity.role || "").toUpperCase() === "GUARDIAN") {
    if (student.portal_guardian_finance_access === false) return false;
  } else if (student.portal_student_finance_access === false) {
    return false;
  }
  if (student.student_is_minor === true && student.portal_minor_finance_access === false && String(identity.role || "").toUpperCase() !== "GUARDIAN") {
    return false;
  }
  return true;
}

async function createCheckoutSession(event, identity, student, pkg, priceId) {
  const secretKey = getEnv("STRIPE_SECRET_KEY");
  if (!secretKey) throw new Error("Missing STRIPE_SECRET_KEY.");
  const siteUrl = getSiteBaseUrl(event);
  const body = new URLSearchParams();
  body.set("mode", "payment");
  body.set("line_items[0][price]", priceId);
  body.set("line_items[0][quantity]", "1");
  body.set("customer_email", identity.email);
  body.set("client_reference_id", `${identity.student_id}:${pkg.package_id}`);
  body.set("success_url", `${siteUrl}/portal?checkout=success`);
  body.set("cancel_url", `${siteUrl}/portal?checkout=cancelled`);
  body.set("metadata[student_id]", identity.student_id);
  body.set("metadata[account_id]", identity.account_id || "");
  body.set("metadata[student_email]", identity.email);
  body.set("metadata[student_name]", student.full_name || "");
  body.set("metadata[package_id]", pkg.package_id);
  body.set("metadata[package_name]", pkg.package_name || "");
  body.set("metadata[stripe_price_id]", priceId);
  body.set("metadata[role]", identity.role || "STUDENT");

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": "2026-02-25.clover"
    },
    body: body.toString()
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error && payload.error.message ? payload.error.message : "Stripe checkout session failed.");
  }
  return payload;
}

exports.handler = async function (event) {
  try {
    if (String(event.httpMethod || "").toUpperCase() !== "POST") {
      return json(405, { ok: false, error: "Method not allowed." });
    }
    const session = verifySignedSession(parseCookies(event)[SESSION_COOKIE_NAME]);
    if (!session) return json(401, { ok: false, error: "Not signed in." });

    const body = JSON.parse(event.body || "{}");
    const snapshot = await loadTrustedSnapshot();
    const student = (snapshot.students || []).find((row) => row.student_id === session.student_id);
    const account = session.account_id
      ? (snapshot.studentAccounts || []).find((row) => row.account_id === session.account_id)
      : null;
    const identity = {
      ...session,
      role: account ? account.role : "STUDENT",
      email: session.email
    };
    const pkg = (snapshot.packages || []).find((row) => row.package_id === String(body.package_id || "").trim() && row.student_id === session.student_id)
      || (snapshot.packages || []).find((row) => row.student_id === session.student_id && !row.archived_at);
    if (!student || !pkg || !canRenewPackage(identity, student, pkg)) {
      return json(403, { ok: false, error: "Package renewal is not available for this account." });
    }
    const priceId = getPackagePriceId(pkg, body);
    if (!priceId) {
      return json(400, { ok: false, error: "No Stripe Price ID is configured for this package." });
    }
    const checkout = await createCheckoutSession(event, identity, student, pkg, priceId);
    return json(200, {
      ok: true,
      checkout: {
        id: checkout.id,
        url: checkout.url
      }
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: String(error && error.message ? error.message : error || "Unable to start Stripe checkout.")
    });
  }
};
