import { readFileSync } from "node:fs";
import { URL } from "node:url";
import assert from "node:assert/strict";
import { target } from "./policy.mjs";
export function schemaQuery() {
  const source = readFileSync(
    new URL("../schema-fingerprint.sql", import.meta.url),
    "utf8",
  )
    .trim()
    .replace(/;$/, "");
  return `with source as (${source}), triggers as (select n.nspname,c.relname,t.tgname,replace(pg_get_triggerdef(t.oid),E'\\r\\n',E'\\n') definition,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('public','credit_internal','lesson_ops','auth') order by 1,2,3) select encode(sha256(convert_to(jsonb_build_object('catalog',source.catalog,'triggers',(select jsonb_agg(triggers) from triggers))::text,'UTF8')),'hex') digest from source`;
}
export async function schemaDigest(db) {
  return (await db.query(schemaQuery())).rows[0].digest;
}
export async function verifySchema(db) {
  const expected = JSON.parse(
    readFileSync(new URL("./schema-seal.json", import.meta.url), "utf8"),
  );
  assert.equal(expected.candidate, target.application);
  assert.equal(
    await schemaDigest(db),
    expected.sha256,
    "Unreviewed schema/function/trigger change",
  );
}
