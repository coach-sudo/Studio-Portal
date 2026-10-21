import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateTemporaryPassword,
  provisionPortalAccount,
} from "./portal-access";
vi.mock("./portal-url", () => ({
  portalOrigin: () => "https://isolated.example.test",
  portalActionUrl: () => "https://isolated.example.test/login",
}));
afterEach(() => vi.unstubAllGlobals());

describe("portal invitation credentials", () => {
  it("generates strong, unique one-time passwords on the server", () => {
    const passwords = Array.from({ length: 32 }, () =>
      generateTemporaryPassword(),
    );
    expect(new Set(passwords)).toHaveLength(passwords.length);
    for (const password of passwords) {
      expect(password.length).toBeGreaterThanOrEqual(16);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[^A-Za-z0-9]/);
    }
  });
  it("provisions the selected guardian with its restricted permissions and no outbound networking", async () => {
    const network = vi.fn(() => {
      throw new Error("Outbound networking forbidden");
    });
    vi.stubGlobal("fetch", network);
    const relationship = vi.fn();
    const contact = {
      id: "contact",
      version: 2,
      user_id: "guardian",
      email: "guardian@example.test",
      full_name: "Guardian",
      relationship_type: "guardian",
      can_view_schedule: true,
      can_view_work: false,
      can_view_finance: false,
      can_manage_lessons: false,
      can_manage_profile: false,
      can_receive_notifications: false,
    };
    const identity = {
      id: "student",
      studio_id: "studio",
      full_name: "Student",
      version: 5,
      is_minor: false,
      user_id: null,
    };
    const db = {
      auth: { admin: { updateUserById: async () => ({ error: null }) } },
      from: (table: string) => {
        let write = false;
        const response = () => ({
          error: null,
          data:
            table === "students"
              ? { ...identity, version: write ? 6 : 5 }
              : table === "studios"
                ? { name: "Isolated" }
                : table === "linked_contacts"
                  ? contact
                  : table === "portal_accounts"
                    ? write
                      ? { id: "account" }
                      : null
                    : table === "outbox_messages"
                      ? { id: "outbox", status: "queued" }
                      : null,
        });
        const q = {
          select: () => q,
          eq: () => q,
          is: () => q,
          ilike: () => q,
          update: () => {
            write = true;
            return q;
          },
          insert: () => {
            write = true;
            return q;
          },
          upsert: (value: unknown) => {
            relationship(value);
            return q;
          },
          single: async () => response(),
          maybeSingle: async () => response(),
          then: (resolve: (v: ReturnType<typeof response>) => unknown) =>
            Promise.resolve(response()).then(resolve),
        };
        return q;
      },
    } as unknown as SupabaseClient;
    const result = await provisionPortalAccount(db, {
      studioId: "studio",
      studentId: "student",
      accountType: "guardian",
      linkedContactId: "contact",
      expectedRecipient: contact.email,
      contactVersion: 2,
      expectedVersion: 5,
      resetExisting: false,
    });
    expect(relationship).toHaveBeenCalledWith(
      expect.objectContaining({
        linked_contact_id: "contact",
        can_view_schedule: true,
        can_view_work: false,
        can_view_finance: false,
        can_manage_lessons: false,
        can_manage_profile: false,
      }),
    );
    expect(result.student.version).toBe(6);
    expect(network).not.toHaveBeenCalled();
  });
});
