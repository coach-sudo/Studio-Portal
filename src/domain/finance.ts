import type { CreditEntry, PackageAccount, PaymentEntry } from "./model";

export const creditBalance = (packageId: string, entries: CreditEntry[]) => entries.filter((entry) => entry.packageId === packageId).reduce((sum, entry) => sum + entry.quantity, 0);
export const studentBalanceMinor = (studentId: string, entries: PaymentEntry[]) => entries.filter((entry) => entry.studentId === studentId).reduce((sum, entry) => sum + (entry.kind === "refund" ? entry.amountMinor : -entry.amountMinor), 0);
export const packageSummary = (pkg: PackageAccount, credits: CreditEntry[]) => ({ ...pkg, remainingCredits: pkg.expiresAt && new Date(pkg.expiresAt) <= new Date() ? 0 : creditBalance(pkg.id, credits) });
export const formatMoney = (minor: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
