import { Client, Query } from "pg";
import assert from "node:assert/strict";
import process from "node:process";
const port = Number(process.argv[2]);
assert.ok(Number.isInteger(port) && port >= 49152 && port <= 65535);
const client = new Client({
  host: "127.0.0.1",
  port,
  user: "postgres",
  database: "postgres",
});
try {
  await client.connect();
  const guard = (
    await client.query(
      "select current_setting('server_version_num')::int as version,current_setting('studio.disposable_recovery',true) as marker",
    )
  ).rows[0];
  assert.ok(guard.version >= 170000 && guard.version < 180000);
  assert.equal(guard.marker, "wave-one-pr45-20261016");
  let sql = "";
  for await (const chunk of process.stdin) sql += chunk;
  // Like psql, send top-level statements separately so a lock-acquired
  // sentinel is flushed before the following pg_sleep statement.
  const statements = [];
  let start = 0,
    quote = null,
    dollar = null,
    comment = 0,
    line = false,
    escape = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i],
      next = sql[i + 1];
    if (line) {
      if (ch === "\n") line = false;
      continue;
    }
    if (comment) {
      if (ch === "/" && next === "*") {
        comment++;
        i++;
      } else if (ch === "*" && next === "/") {
        comment--;
        i++;
      }
      continue;
    }
    if (dollar) {
      if (sql.startsWith(dollar, i)) {
        i += dollar.length - 1;
        dollar = null;
      }
      continue;
    }
    if (quote) {
      if (escape && ch === "\\") {
        i++;
        continue;
      }
      if (ch === quote) {
        if (next === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (ch === "-" && next === "-") {
      line = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      comment = 1;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      escape =
        ch === "'" &&
        /[Ee]/.test(sql[i - 1] || "") &&
        !/[A-Za-z0-9_]/.test(sql[i - 2] || "");
      continue;
    }
    if (ch === "$") {
      const m = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (m) {
        dollar = m[0];
        i += dollar.length - 1;
        continue;
      }
    }
    if (ch === ";") {
      statements.push(sql.slice(start, i + 1));
      start = i + 1;
    }
  }
  assert.ok(!quote && !dollar && !comment, "Unterminated SQL input");
  if (sql.slice(start).trim()) statements.push(sql.slice(start));
  for (const statement of statements)
    await new Promise((resolve, reject) => {
      const query = client.query(
        new Query({ text: statement, rowMode: "array" }),
      );
      query.on("row", (row, result) =>
        process.stdout.write(
          row
            .map((v, i) =>
              v === null
                ? ""
                : [114, 3802].includes(result.fields[i].dataTypeID)
                  ? JSON.stringify(v)
                  : typeof v === "boolean"
                    ? v
                      ? "t"
                      : "f"
                    : typeof v === "object"
                      ? JSON.stringify(v)
                      : String(v),
            )
            .join("|") + "\n",
        ),
      );
      query.on("end", resolve);
      query.on("error", reject);
    });
} catch (e) {
  process.stderr.write(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
