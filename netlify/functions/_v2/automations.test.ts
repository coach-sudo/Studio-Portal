import { describe, expect, it, vi } from "vitest";
import { handleAutomationCommands } from "./automations";
import { AppError } from "../_shared/http";
import type { V2CommandContext } from "./types";
vi.mock("../_shared/supabase", () => ({ serviceClient: vi.fn() }));
import { serviceClient } from "../_shared/supabase";
describe("automation API role boundary", () => {
  it.each(["test_rule", "run_rule", "save_rule", "send_now"])(
    "denies non-coach %s before service-role reads or writes",
    async (command) => {
      const ctx = {
        domain: "automations",
        input: { command, entityId: "rule" },
        requireCoach: async () => {
          throw AppError.forbidden();
        },
      } as unknown as V2CommandContext;
      await expect(handleAutomationCommands(ctx)).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
      expect(serviceClient).not.toHaveBeenCalled();
    },
  );
});
