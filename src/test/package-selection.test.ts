import { describe, expect, it } from "vitest";
import { recentLessonDuration, sortPackageDefinitions } from "../domain/packageSelection";
import type { Lesson, PackageDefinition } from "../domain/model";

const lesson = (id:string, minutes:number, startsAt:string):Lesson => ({ id, studioId:"studio", studentId:"student", topic:"Coaching", startsAt, endsAt:new Date(new Date(startsAt).getTime()+minutes*60_000).toISOString(), status:"completed", locationType:"virtual", locationLabel:"Meet", version:1, updatedAt:startsAt });
const pkg = (id:string, minutes:number, count:number):PackageDefinition => ({ id, studioId:"studio", name:`${minutes} minute package`, description:"", sessionCount:count, sessionDurationMinutes:minutes, priceMinor:10000, discountMinor:0, currency:"USD", eligibleServiceIds:[], meetingProviders:["google_meet"], recurringEligible:false, visibility:"public", directPurchase:true, active:true, version:1, updatedAt:"2026-09-04T00:00:00Z" });

describe("package selection",()=>{
  it("uses the latest completed lesson duration as the recommendation",()=>{
    expect(recentLessonDuration([lesson("older",45,"2026-08-01T12:00:00Z"),lesson("latest",60,"2026-09-01T12:00:00Z")],"student",Date.parse("2026-09-04T00:00:00Z"))).toBe(60);
  });
  it("places matching lengths first, then keeps lengths and counts predictable",()=>{
    expect(sortPackageDefinitions([pkg("90",90,4),pkg("60-8",60,8),pkg("45",45,4),pkg("60-4",60,4)],60).map((item)=>item.id)).toEqual(["60-4","60-8","45","90"]);
  });
});
