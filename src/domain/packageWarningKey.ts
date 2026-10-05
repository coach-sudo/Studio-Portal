import type { CreditEntry, PackageAccount } from "./model";
import { creditBalance } from "./finance";

/** Preserve established warning stages so explicit runs cannot duplicate maintenance email. */
export function packageWarningKey(
  pkg: PackageAccount,
  entries: readonly CreditEntry[],
  key: "package_low" | "package_expiration",
  now: number,
): string {
  if (key === "package_expiration") {
    const days = Math.max(
      1,
      Math.ceil((Date.parse(pkg.expiresAt ?? "") - now) / 86400000),
    );
    const threshold = days <= 7 ? 7 : days <= 14 ? 14 : 30;
    return `package:${pkg.id}:expiry:${threshold}:student`;
  }
  const latest =
    entries
      .filter(
        (entry) =>
          entry.packageId === pkg.id &&
          (entry.kind === "purchase" || entry.quantity > 0),
      )
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      )[0]?.id ?? "initial";
  return `package:${pkg.id}:purchase:${latest}:low:${creditBalance(pkg.id, [...entries])}`;
}
