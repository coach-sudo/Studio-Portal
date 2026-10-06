import type {
  CreditEntry,
  Lesson,
  PackageAccount,
  StudioSnapshot,
  LessonParticipant,
} from "./model";

export function lessonCreditDebit(
  entries: CreditEntry[],
  lessonId: string,
  packageId?: string,
) {
  return Math.max(
    0,
    -entries
      .filter(
        (e) =>
          e.lessonId === lessonId && (!packageId || e.packageId === packageId),
      )
      .reduce((n, e) => n + e.quantity, 0),
  );
}

export function creditTotals(
  packages: PackageAccount[],
  entries: CreditEntry[],
  lessons: Lesson[],
  studentId: string,
  now = Date.now(),
  participants: LessonParticipant[] = [],
) {
  let available = 0,
    reserved = 0,
    expired = 0;
  const lots = packages
    .filter((p) => p.studentId === studentId)
    .map((p) => {
      const net = entries
        .filter((e) => e.packageId === p.id)
        .reduce((n, e) => n + e.quantity, 0);
      const held = lessons
        .filter(
          (l) =>
            l.status === "scheduled" &&
            (l.studentId === studentId ||
              participants.some(
                (p) =>
                  p.lessonId === l.id &&
                  p.studentId === studentId &&
                  ["reserved", "confirmed"].includes(p.status),
              )),
        )
        .reduce((n, l) => n + lessonCreditDebit(entries, l.id, p.id), 0);
      const isExpired = !!p.expiresAt && Date.parse(p.expiresAt) <= now;
      reserved += held;
      if (isExpired) expired += Math.max(0, net);
      else available += net;
      return {
        package: p,
        available: isExpired ? 0 : net,
        reserved: held,
        expired: isExpired ? Math.max(0, net) : 0,
      };
    });
  return {
    available,
    reserved,
    remaining: available + reserved,
    expired,
    lots,
  };
}

export function setDemoCreditTotal(
  data: StudioSnapshot,
  studentId: string,
  target: number,
  reason: string,
) {
  const totals = creditTotals(
    data.packages,
    data.creditEntries,
    data.lessons,
    studentId,
    Date.now(),
    data.lessonParticipants,
  );
  if (!Number.isInteger(target) || target < totals.reserved || target < 0)
    throw new Error(
      "The total must include credits already reserved for lessons.",
    );
  let delta = target - totals.remaining;
  if (delta > 0) {
    let pkg = data.packages.find(
      (p) =>
        p.studentId === studentId &&
        p.name === "Studio lesson credits" &&
        !p.expiresAt,
    );
    if (!pkg) {
      pkg = {
        id: crypto.randomUUID(),
        studentId,
        name: "Studio lesson credits",
        priceMinor: 0,
        currency: data.settings.currency,
        autoApply:
          data.packages.some((p) => p.studentId === studentId) &&
          data.packages
            .filter((p) => p.studentId === studentId)
            .every((p) => p.autoApply),
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      data.packages.push(pkg);
    }
    data.creditEntries.push({
      id: crypto.randomUUID(),
      packageId: pkg.id,
      kind: "adjustment",
      quantity: delta,
      reason,
      createdAt: new Date().toISOString(),
    });
  } else if (delta < 0) {
    const lots = totals.lots
      .filter((l) => l.available > 0)
      .sort((a, b) =>
        (b.package.expiresAt ?? "9999").localeCompare(
          a.package.expiresAt ?? "9999",
        ),
      );
    for (const lot of lots) {
      const take = Math.min(-delta, lot.available);
      data.creditEntries.push({
        id: crypto.randomUUID(),
        packageId: lot.package.id,
        kind: "adjustment",
        quantity: -take,
        reason,
        createdAt: new Date().toISOString(),
      });
      delta += take;
      if (!delta) break;
    }
  }
}

export function settleDemoLessonCredits(
  data: StudioSnapshot,
  lessonId: string,
  useCredit: boolean,
  studentId?: string,
) {
  if (useCredit) return;
  for (const pkg of data.packages.filter(
    (p) => !studentId || p.studentId === studentId,
  )) {
    const quantity = lessonCreditDebit(data.creditEntries, lessonId, pkg.id);
    if (!quantity) continue;
    const createdAt = new Date().toISOString();
    data.creditEntries.push({
      id: crypto.randomUUID(),
      packageId: pkg.id,
      lessonId,
      kind: "release",
      quantity,
      reason: "Credit returned after cancellation",
      createdAt,
    });
    if (pkg.expiresAt && Date.parse(pkg.expiresAt) <= Date.now()) {
      data.creditEntries.push({
        id: crypto.randomUUID(),
        packageId: pkg.id,
        kind: "adjustment",
        quantity: -quantity,
        reason: "Returned credit transferred to 30-day balance",
        createdAt,
      });
      const restored = {
        ...pkg,
        id: crypto.randomUUID(),
        name: "Returned lesson credits",
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        priceMinor: 0,
        version: 1,
        updatedAt: createdAt,
      };
      data.packages.push(restored);
      data.creditEntries.push({
        id: crypto.randomUUID(),
        packageId: restored.id,
        kind: "adjustment",
        quantity,
        reason: "Cancelled lesson credit available for 30 days",
        createdAt,
      });
    }
  }
}

export function reserveDemoCredits(data: StudioSnapshot, studentId: string) {
  let applied = 0;
  for (const lesson of data.lessons
    .filter(
      (l) =>
        (l.studentId === studentId ||
          data.lessonParticipants.some(
            (p) =>
              p.lessonId === l.id &&
              p.studentId === studentId &&
              ["confirmed", "reserved"].includes(p.status),
          )) &&
        l.status === "scheduled" &&
        Date.parse(l.startsAt) >= Date.now(),
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    if (
      lesson.invoicePaymentPending ||
      data.packages.some(
        (p) =>
          p.studentId === studentId &&
          lessonCreditDebit(data.creditEntries, lesson.id, p.id),
      ) ||
      data.lessonParticipants.some(
        (p) =>
          p.lessonId === lesson.id &&
          data.bookings.some(
            (b) =>
              b.id === p.bookingId &&
              b.studentId === studentId &&
              b.paymentPolicy !== "credits" &&
              ["paid", "partially_paid", "processing"].includes(
                b.paymentStatus,
              ),
          ),
      ) ||
      (lesson.studentId === studentId &&
        ["paid", "partially_paid", "waived", "refunded"].includes(
          lesson.paymentStatus ?? "",
        )) ||
      (lesson.paidMinor ?? 0) > 0
    )
      continue;
    const pkg = data.packages
      .filter(
        (p) =>
          p.studentId === studentId &&
          p.autoApply &&
          (!p.expiresAt || p.expiresAt > lesson.startsAt) &&
          data.creditEntries
            .filter((e) => e.packageId === p.id)
            .reduce((n, e) => n + e.quantity, 0) > 0,
      )
      .sort((a, b) =>
        (a.expiresAt ?? "9999").localeCompare(b.expiresAt ?? "9999"),
      )[0];
    if (!pkg) continue;
    data.creditEntries.push({
      id: crypto.randomUUID(),
      packageId: pkg.id,
      lessonId: lesson.id,
      kind: "reservation",
      quantity: -1,
      reason: "Credit reserved for upcoming lesson",
      createdAt: new Date().toISOString(),
    });
    if (lesson.studentId === studentId) {
      lesson.packageId = pkg.id;
      lesson.paymentStatus = "paid_by_credit";
    }
    for (const b of data.bookings.filter(
      (b) =>
        b.studentId === studentId &&
        data.lessonParticipants.some(
          (p) => p.bookingId === b.id && p.lessonId === lesson.id,
        ),
    )) {
      b.paymentPolicy = "credits";
      b.paymentStatus = "paid";
      b.version++;
    }
    applied++;
  }
  return applied;
}
