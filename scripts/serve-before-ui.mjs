// Read-only baseline UI on loopback; all API requests use the isolated current stack.
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(process.env.BASELINE_UI_DIR || "");
if (!process.env.BASELINE_UI_DIR || process.env.E2E_EPHEMERAL !== "true")
  throw new Error("Isolated baseline required");
const types = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".html": "text/html",
  ".woff2": "font/woff2",
};
http
  .createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1:8889");
    if (
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/.netlify/")
    ) {
      const proxy = http.request(
        {
          hostname: "127.0.0.1",
          port: 8888,
          path: request.url,
          method: request.method,
          headers: request.headers,
        },
        (result) => {
          response.writeHead(result.statusCode, result.headers);
          result.pipe(response);
        },
      );
      proxy.on("error", () => {
        response.writeHead(502);
        response.end();
      });
      request.pipe(proxy);
      return;
    }
    const target = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!target.startsWith(root + path.sep) && target !== root) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      const file = path.extname(target)
        ? target
        : path.join(root, "index.html");
      response.setHeader(
        "Content-Type",
        types[path.extname(file)] || "application/octet-stream",
      );
      response.end(await readFile(file));
    } catch {
      response.writeHead(404);
      response.end();
    }
  })
  .listen(8889, "127.0.0.1");
