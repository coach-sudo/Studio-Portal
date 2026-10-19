import { URL } from "node:url";
// Disposable validation adapter, never imported by the hosted runner. Auth is a
// local stub; public RPCs, RLS, triggers and the actual v2 HTTP handler are real.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { plan, authIds, quote } from "./policy.mjs";
export async function localHttp({ config, runtime }) {
  assert.equal(config.host, "127.0.0.1");
  assert.match(config.database, /^ui_[a-z_]+$/);
  const { Client } = createRequire(runtime + "/package.json")("pg");
  const rawFetch = globalThis.fetch;
  let origin;
  const token = (role) =>
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ) +
    "." +
    Buffer.from(
      JSON.stringify({
        sub: authIds[role],
        role: role === "service" ? "service_role" : "authenticated",
        exp: 4102444800,
      }),
    ).toString("base64url") +
    ".validation";
  const tokens = new Map(
    [...Object.keys(authIds), "service"].map((r) => [token(r), r]),
  );
  const server = createServer(async (req, res) => {
    let client;
    try {
      assert.equal(req.socket.remoteAddress, "127.0.0.1");
      const url = new URL(req.url, origin);
      const role = tokens.get(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
      );
      assert(role, "Unknown local validation token");
      if (url.pathname === "/auth/v1/user") {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            id: authIds[role],
            email: plan.accounts[role]?.email,
            aud: "authenticated",
            role: "authenticated",
          }),
        );
        return;
      }
      assert(url.pathname.startsWith("/rest/v1/"));
      client = new Client(config);
      await client.connect();
      await client.query("begin");
      await client.query(
        "set local role " +
          (role === "service" ? "service_role" : "authenticated"),
      );
      await client.query(
        "select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",
        [
          authIds[role] || authIds.coach,
          role === "service" ? "service_role" : "authenticated",
        ],
      );
      let data = "";
      for await (const b of req) data += b;
      const body = data ? JSON.parse(data) : null;
      let rows;
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        assert.equal(req.method, "POST");
        const fn = url.pathname.split("/").pop();
        assert.match(fn, /^[a-z_]+$/);
        const entries = Object.entries(body || {});
        const args = entries
          .map(([k], i) => quote(k) + " := $" + (i + 1))
          .join(",");
        rows = (
          await client.query(
            `select public.${quote(fn)}(${args}) value`,
            entries.map(([, v]) => v),
          )
        ).rows[0].value;
      } else {
        const table = url.pathname.split("/").pop();
        assert.match(table, /^[a-z_]+$/);
        const jsonColumns = new Set(
          (
            await client.query(
              "select attname from pg_attribute where attrelid=$1::regclass and atttypid in ('json'::regtype,'jsonb'::regtype)",
              ["public." + table],
            )
          ).rows.map((r) => r.attname),
        );
        const valueFor = (key, value) =>
          jsonColumns.has(key) && value !== null
            ? JSON.stringify(value)
            : value;
        const args = [];
        const conditions = [];
        for (const [k, v] of url.searchParams) {
          if (["select", "limit", "order"].includes(k)) continue;
          quote(k);
          const dot = v.indexOf("."),
            op = v.slice(0, dot),
            value = v.slice(dot + 1);
          if (op === "is") {
            assert(["null", "true", "false"].includes(value));
            conditions.push(quote(k) + " is " + value);
          } else {
            assert(["eq", "neq", "ilike", "in"].includes(op));
            args.push(op === "in" ? value.slice(1, -1).split(",") : value);
            conditions.push(
              quote(k) +
                (op === "eq"
                  ? " = "
                  : op === "neq"
                    ? " <> "
                    : op === "ilike"
                      ? " ilike "
                      : " = any(") +
                "$" +
                args.length +
                (op === "in" ? ")" : ""),
            );
          }
        }
        const where = conditions.length
          ? " where " + conditions.join(" and ")
          : "";
        const projection = url.searchParams.get("select") || "*";
        assert(projection === "*" || /^[a-z_,]+$/.test(projection));
        if (req.method === "GET") {
          let tail = "";
          if (url.searchParams.has("order")) {
            const [k, dir] = url.searchParams.get("order").split(".");
            assert(["asc", "desc"].includes(dir));
            tail = " order by " + quote(k) + " " + dir;
          }
          if (url.searchParams.has("limit")) {
            const n = Number(url.searchParams.get("limit"));
            assert(n >= 0 && n <= 5000);
            tail += " limit " + n;
          }
          rows = (
            await client.query(
              `select ${projection} from public.${quote(table)}${where}${tail}`,
              args,
            )
          ).rows;
        } else if (req.method === "PATCH") {
          assert(conditions.length, "Unbounded local update");
          const changes = Object.entries(body);
          const values = [...args, ...changes.map(([k, v]) => valueFor(k, v))];
          rows = (
            await client.query(
              `update public.${quote(table)} set ${changes.map(([k], i) => quote(k) + "=$" + (args.length + i + 1)).join(",")}${where} returning ${projection}`,
              values,
            )
          ).rows;
        } else if (req.method === "POST") {
          assert(body && !Array.isArray(body));
          const entries = Object.entries(body);
          rows = (
            await client.query(
              `insert into public.${quote(table)}(${entries.map(([k]) => quote(k)).join(",")}) values(${entries.map((_, i) => "$" + (i + 1)).join(",")}) returning ${projection}`,
              entries.map(([k, v]) => valueFor(k, v)),
            )
          ).rows;
        } else throw Error("Local REST operation prohibited");
        if (req.headers.accept?.includes("vnd.pgrst.object")) {
          if (rows.length !== 1) {
            await client.query("rollback");
            res.writeHead(406, { "content-type": "application/json" });
            res.end(
              JSON.stringify({ code: "PGRST116", message: "Expected one row" }),
            );
            return;
          }
          rows = rows[0];
        }
      }
      await client.query("commit");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(rows));
    } catch (e) {
      if (client) await client.query("rollback");
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          code: e.code || "LOCAL_VALIDATION_REFUSAL",
          message: e.message,
        }),
      );
    } finally {
      if (client) await client.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = "http://127.0.0.1:" + server.address().port;
  globalThis.Netlify = {
    env: {
      get: (k) =>
        ({
          SUPABASE_URL: origin,
          SUPABASE_ANON_KEY: token("student"),
          SUPABASE_SERVICE_ROLE_KEY: token("service"),
        })[k],
    },
  };
  globalThis.fetch = (url, options) => {
    assert.equal(
      new URL(typeof url === "string" ? url : url.url || url.href).origin,
      origin,
      "Non-loopback/provider request in local integration",
    );
    return rawFetch(url, options);
  };
  const handler = (await import("../../../netlify/functions/v2.ts")).default;
  return {
    token,
    async read(request, role) {
      const u = new URL(request.url());
      const result = await rawFetch(origin + u.pathname + u.search, {
        method: request.method(),
        headers: {
          authorization: "Bearer " + token(role),
          "content-type": "application/json",
          ...(request.headers().accept
            ? { accept: request.headers().accept }
            : {}),
        },
        ...(request.method() === "POST" ? { body: request.postData() } : {}),
        redirect: "error",
      });
      return {
        status: result.status,
        contentType: "application/json",
        body: await result.text(),
      };
    },
    async send(path, body, role) {
      const request = new globalThis.Request(origin + path, {
        method: "POST",
        headers: {
          authorization: "Bearer " + token(role),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const result = await handler(request, {
        requestId: "local-ui-validation",
        params: { domain: path.split("/").pop() },
        waitUntil: () => {
          throw Error("Background dispatch prohibited");
        },
      });
      return { status: result.status, body: await result.json() };
    },
    close: async () => {
      globalThis.fetch = rawFetch;
      await new Promise((r) => server.close(r));
    },
  };
}
