import { describe,expect,it } from "vitest";
import { demoSnapshot } from "../data/demo";
import { buildRecommendations } from "./recommendations";
describe("recommendation reasoning",()=>{
  it("deduplicates reasons into stable identifiers",()=>{const items=buildRecommendations(demoSnapshot);expect(new Set(items.map(item=>item.id)).size).toBe(items.length)});
  it("explains every suggested action",()=>{for(const item of buildRecommendations(demoSnapshot)){expect(item.reasonCode).toBeTruthy();expect(item.explanation.length).toBeGreaterThan(12);expect(item.evidence.length).toBeGreaterThan(0);expect(item.suggestedAction).toBeTruthy()}});
  it("requires confirmation for finance pressure",()=>{expect(buildRecommendations(demoSnapshot).filter(item=>item.reasonCode==="package_low").every(item=>item.requiresConfirmation)).toBe(true)});
});
