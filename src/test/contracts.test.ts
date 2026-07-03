import fs from "node:fs";
import { describe,expect,it } from "vitest";
const core=fs.readFileSync("supabase/migrations/202607030001_core.sql","utf8");const rls=fs.readFileSync("supabase/migrations/202607030002_rls.sql","utf8");const commands=fs.readFileSync("supabase/migrations/202607030003_commands.sql","utf8");
describe("database contracts",()=>{
  it("enables RLS for every private aggregate",()=>{for(const table of ["students","lessons","notes","assignments","materials","packages","payment_entries","actor_profiles","reader_requests","outbox_messages","recommendations","audit_events"])expect(rls).toContain(`alter table public.${table} enable row level security`)});
  it("indexes foreign-key and policy columns",()=>{expect(core).toContain("lessons_student_id_idx");expect(core).toContain("memberships_user_id_idx");expect(core).toContain("student_relationships_user_id_idx")});
  it("implements version conflicts and idempotency",()=>{expect(commands).toContain("VERSION_CONFLICT");expect(commands).toContain("idempotency_keys");expect(commands).toContain("process_stripe_checkout")});
});
