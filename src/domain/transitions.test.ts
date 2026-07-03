import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "./transitions";
describe("domain transitions",()=>{
  it("allows only explicit lesson transitions",()=>{expect(canTransition("lesson","scheduled","completed")).toBe(true);expect(canTransition("lesson","completed","scheduled")).toBe(false)});
  it("rejects skipped actor publishing",()=>{expect(()=>assertTransition("actorProfile","draft","published")).toThrow("Invalid actorProfile transition")});
  it("allows students to reopen completed practice",()=>{expect(canTransition("assignment","completed","reopened")).toBe(true)});
});
