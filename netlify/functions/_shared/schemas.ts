import { z } from "zod";
export const commandSchema = z.object({
  command: z.string().min(1), idempotencyKey: z.string().min(8).max(200), expectedVersion: z.number().int().positive(), reason: z.string().min(3).max(500),
  entityType: z.enum(["student","lesson","note","assignment","material","reader_request"]).optional(), entityId: z.string().uuid().optional(), nextStatus: z.string().optional(), payload: z.record(z.string(),z.unknown()).default({}),
});
