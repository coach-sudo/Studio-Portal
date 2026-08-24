import type { StudioSettings } from "../domain/model";

export function mergeStudioSettings(defaults: StudioSettings, value?: Partial<StudioSettings>): StudioSettings {
  const current=value||{};
  return {
    ...defaults,
    ...current,
    lessonRatesMinor:{...defaults.lessonRatesMinor,...current.lessonRatesMinor},
    bookingDefaults:{...defaults.bookingDefaults,...current.bookingDefaults},
    meetingFormats:{...defaults.meetingFormats,...current.meetingFormats},
    branding:{...defaults.branding,...current.branding},
    bookingCopy:{...defaults.bookingCopy,...current.bookingCopy},
    bookingPage:{...defaults.bookingPage,...current.bookingPage},
    emailAutomations:{...defaults.emailAutomations,...current.emailAutomations},
    portalDefaults:{...defaults.portalDefaults,...current.portalDefaults},
  };
}
