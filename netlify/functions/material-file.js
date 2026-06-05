function getEnv(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function getNetlifyBlobCredentials() {
  return {
    siteID: getEnv("NETLIFY_BLOBS_SITE_ID") || getEnv("NETLIFY_SITE_ID") || getEnv("SITE_ID"),
    token: getEnv("NETLIFY_BLOBS_TOKEN") || getEnv("NETLIFY_AUTH_TOKEN") || getEnv("NETLIFY_API_TOKEN")
  };
}

async function getConfiguredBlobStore(name, options = {}) {
  const { getStore } = await import("@netlify/blobs");
  const credentials = getNetlifyBlobCredentials();
  const storeOptions = {
    name,
    consistency: options.consistency || "strong"
  };
  if (credentials.siteID && credentials.token) {
    storeOptions.siteID = credentials.siteID;
    storeOptions.token = credentials.token;
  }
  return getStore(storeOptions);
}

exports.handler = async (event) => {
  try {
    const key = String(event.queryStringParameters && event.queryStringParameters.key || "").trim();
    if (!key || !/^student-uploads\/[a-zA-Z0-9/_.,-]+$/.test(key)) {
      return { statusCode: 400, headers: { "Content-Type": "text/plain" }, body: "Missing file." };
    }

    const store = await getConfiguredBlobStore("studio-portal-files");
    const result = await store.getWithMetadata(key, { type: "arrayBuffer" });
    if (!result || !result.data) {
      return { statusCode: 404, headers: { "Content-Type": "text/plain" }, body: "File not found." };
    }

    const metadata = result.metadata || {};
    const contentType = metadata.contentType || "application/octet-stream";
    const fileName = String(metadata.fileName || "studio-material").replace(/[^\w.\- ]+/g, "").trim() || "studio-material";
    return {
      statusCode: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
        "Cache-Control": "public, max-age=31536000, immutable"
      },
      body: Buffer.from(result.data).toString("base64"),
      isBase64Encoded: true
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain" },
      body: String(error && error.message ? error.message : error || "Unable to load file.")
    };
  }
};
