import { describe,expect,it } from "vitest";
import { demoSnapshot } from "../data/demo";
import { mergeStudioSettings } from "../data/settings";

describe("studio settings compatibility",()=>{
  it("fills newly added nested settings without overwriting saved values",()=>{
    const merged=mergeStudioSettings(demoSnapshot.settings,{studioName:"Saved studio",branding:{primaryColor:"#123456"} as never});
    expect(merged.studioName).toBe("Saved studio");
    expect(merged.branding.primaryColor).toBe("#123456");
    expect(merged.branding.secondaryColor).toBe(demoSnapshot.settings.branding.secondaryColor);
    expect(merged.bookingPage.footerWebsiteLabel).toBeTruthy();
  });
});
