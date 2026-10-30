import { beforeEach, afterEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  exec: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  unlink: vi.fn(),
  realpath: vi.fn(),
}));
vi.mock("node:child_process", () => ({
  execFileSync: f.exec,
  default: { execFileSync: f.exec },
}));
vi.mock("node:fs/promises", () => ({
  default: {
    readFile: f.read,
    writeFile: f.write,
    unlink: f.unlink,
    realpath: f.realpath,
  },
  readFile: f.read,
  writeFile: f.write,
  unlink: f.unlink,
  realpath: f.realpath,
}));
import {
  cleanupEphemeralPaymentReceipt,
  paymentFixtureCleanupSQL,
} from "./e2e-payment-receipt-cleanup";
import { createHash } from "node:crypto";
const runId = "e2e-cleanup-safety1";
const fixture = (label: string) => {
  const h = createHash("sha256").update(`${runId}:${label}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const manifest = {
  runId,
  studioId: "11111111-1111-4111-8111-111111111111",
  lessonId: fixture("lessonDue"),
  studentId: fixture("operationalStudent"),
  actorId: "e2990000-0000-4000-8000-000000000001",
  receiptId: "e2990000-0000-4000-8000-000000000002",
  paymentEntryId: "e2990000-0000-4000-8000-000000000003",
  auditEventId: "e2990000-0000-4000-8000-000000000004",
  key: "e2990000-0000-4000-8000-000000000005",
  amountMinor: 7500,
  currency: "USD",
  canonicalAssertionsPassed: true,
};
const runtime = {
  runId,
  baseURL: "http://127.0.0.1:8888",
  fixtureReady: true,
  ids: { lessonDue: manifest.lessonId, operationalStudent: manifest.studentId },
};
beforeEach(() => {
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({
    CI: "true",
    E2E_EPHEMERAL: "true",
    SUPABASE_URL: "http://127.0.0.1:54321",
    DB_CONTAINER: "supabase_db_studio-portal",
    GITHUB_REPOSITORY: "coach-sudo/Studio-Portal",
    GITHUB_WORKSPACE: process.cwd(),
  }))
    vi.stubEnv(key, value);
  f.read.mockResolvedValue(JSON.stringify(manifest));
  f.realpath.mockImplementation(async (path: string) => path);
  f.exec.mockImplementation(
    (_bin: string, _args: string[], options: { input: string }) =>
      options.input === "select version()"
        ? "PostgreSQL 17.6"
        : '{"privateReceiptsRemoved":1,"ledgerEntriesRemoved":0,"hostedOperations":0}',
  );
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  ["runId", "e2e-other-run"],
  ["lessonId", "e2990000-0000-4000-8000-000000000099"],
  ["studentId", "e2990000-0000-4000-8000-000000000099"],
  ["canonicalAssertionsPassed", false],
  ["amountMinor", 1],
  ["key", "arbitrary SQL input"],
])(
  "rejects changed manifest %s before constructing cleanup",
  (field, value) => {
    expect(() =>
      paymentFixtureCleanupSQL(
        { ...manifest, [String(field)]: value },
        runtime,
      ),
    ).toThrow();
    expect(f.exec).not.toHaveBeenCalled();
  },
);
it.each([
  ["CI", "false"],
  ["E2E_EPHEMERAL", "false"],
  ["SUPABASE_URL", "https://production.example.test"],
  ["DB_CONTAINER", "another-project-db"],
  ["GITHUB_REPOSITORY", "another/repo"],
])("denies unsafe %s before any database call", async (key, value) => {
  vi.stubEnv(key, value);
  await expect(cleanupEphemeralPaymentReceipt(runtime)).rejects.toThrow();
  expect(f.exec).not.toHaveBeenCalled();
});
it("denies hosted API and mismatched workspace before any database call", async () => {
  await expect(
    cleanupEphemeralPaymentReceipt({
      ...runtime,
      baseURL: "https://portal.d-a-j.com",
    }),
  ).rejects.toThrow();
  expect(f.exec).not.toHaveBeenCalled();
  vi.stubEnv("GITHUB_WORKSPACE", "another-workspace");
  await expect(cleanupEphemeralPaymentReceipt(runtime)).rejects.toThrow();
  expect(f.exec).not.toHaveBeenCalled();
});
it("keeps the manifest on PostgreSQL version or cleanup-count failure", async () => {
  f.exec.mockReturnValueOnce("PostgreSQL 16.9");
  await expect(cleanupEphemeralPaymentReceipt(runtime)).rejects.toThrow();
  expect(f.unlink).not.toHaveBeenCalled();
  f.exec
    .mockReturnValueOnce("PostgreSQL 17.6")
    .mockReturnValueOnce(
      '{"privateReceiptsRemoved":0,"ledgerEntriesRemoved":0,"hostedOperations":0}',
    );
  await expect(cleanupEphemeralPaymentReceipt(runtime)).rejects.toThrow();
  expect(f.unlink).not.toHaveBeenCalled();
});
it("records exact cleanup counts only after the guarded transaction succeeds", async () => {
  await cleanupEphemeralPaymentReceipt(runtime);
  expect(f.exec).toHaveBeenCalledTimes(2);
  expect(f.exec.mock.calls[1][1]).toContain("supabase_db_studio-portal");
  expect(f.write).toHaveBeenCalledOnce();
  expect(f.unlink).toHaveBeenCalledOnce();
});
