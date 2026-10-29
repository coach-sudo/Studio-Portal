import { execFileSync } from "node:child_process";
import process from "node:process";
import console from "node:console";
for (const timezone of [
  "America/New_York",
  "UTC",
  "America/Los_Angeles",
  "Asia/Tokyo",
  "Pacific/Honolulu",
]) {
  console.log(`Booking fixture host timezone: ${timezone}`);
  execFileSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "src/domain/booking.test.ts",
      "--maxWorkers=1",
    ],
    {
      env: { ...process.env, TZ: timezone },
      stdio: "inherit",
      windowsHide: true,
    },
  );
}
