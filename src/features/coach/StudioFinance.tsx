import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleDollarSign } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  EmptyState,
  Section,
  Status,
} from "../../components/Primitives";
import { studioCommand } from "../../data/bookingCommands";
import {
  formatMoney,
  packageSummary,
  studentBalanceMinor,
} from "../../domain/finance";
import type {
  DiscountCode,
  PackageDefinition,
  StudioSnapshot,
} from "../../domain/model";
import {
  calculatePackagePrice,
  packagePricingChanged,
} from "../../domain/packagePricing";
import { invalidateStudioDomains } from "../../hooks/useStudio";
import { useStudioStore } from "../../state/StudioStore";

import { studentName } from "./StudioOperations.shared";

type PackageBuilderPayload = {
  id?: string;
  serviceIds: string[];
  sessionCounts: number[];
  deliveryFormats: ("google_meet" | "in_person")[];
  name?: string;
  description: string;
  expirationDays?: number;
  discountType: "none" | "fixed" | "percent";
  discountMinor: number;
  discountBasisPoints: number;
  visibility: "private" | "public";
  directPurchase: boolean;
  giftable: boolean;
  renewalModes: (
    "one_time" | "weekly" | "biweekly" | "monthly" | "balance_threshold"
  )[];
  balanceThreshold: number;
  active: boolean;
};

export function FinanceView({
  data,
  isDemo,
}: {
  data: StudioSnapshot;
  isDemo: boolean;
}) {
  const navigate = useNavigate(),
    store = useStudioStore(),
    queryClient = useQueryClient(),
    [dialog, setDialog] = useState<PackageDefinition | "new">(),
    [discountDialog, setDiscountDialog] = useState<DiscountCode | "new">(),
    [notice, setNotice] = useState("");
  const saveDiscount = async (value: DiscountCode) => {
    try {
      if (isDemo)
        store.transact((draft) => {
          const current = draft.discountCodes.find(
            (item) => item.id === value.id,
          );
          if (current)
            Object.assign(current, value, {
              version: current.version + 1,
              updatedAt: new Date().toISOString(),
            });
          else draft.discountCodes.push(value);
        });
      else {
        await studioCommand("discounts", {
          command: data.discountCodes.some((item) => item.id === value.id)
            ? "update"
            : "create",
          entityId: data.discountCodes.some((item) => item.id === value.id)
            ? value.id
            : undefined,
          expectedVersion:
            data.discountCodes.find((item) => item.id === value.id)?.version ??
            0,
          payload: value as unknown as Record<string, unknown>,
          reason: "Coach configured a booking discount",
        });
        await invalidateStudioDomains(queryClient, [
          "booking",
          "administration",
        ]);
      }
      setDiscountDialog(undefined);
      setNotice("Discount code saved and available to the booking checkout.");
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Discount code could not be saved.",
      );
    }
  };
  const save = async (value: PackageBuilderPayload) => {
    try {
      if (isDemo) {
        store.transact((draft) => {
          for (const serviceId of value.serviceIds)
            for (const sessionCount of value.sessionCounts)
              for (const deliveryFormat of value.deliveryFormats) {
                const service = draft.bookingServices.find(
                  (item) => item.id === serviceId,
                );
                if (!service) continue;
                const unitPrice =
                  service.priceMinor +
                  (deliveryFormat === "in_person"
                    ? draft.settings.bookingDefaults.inPersonUpchargeMinor
                    : 0);
                const price = calculatePackagePrice({
                  unitPriceMinor: unitPrice,
                  sessionCount,
                  discountType: value.discountType,
                  discountMinor: value.discountMinor,
                  discountBasisPoints: value.discountBasisPoints,
                });
                const definition: PackageDefinition = {
                  id: value.id || `package-definition-${crypto.randomUUID()}`,
                  studioId: draft.studioId,
                  name:
                    value.name ||
                    `${service.name} — ${sessionCount} lesson${sessionCount === 1 ? "" : "s"}`,
                  description: value.description,
                  sessionCount,
                  sessionDurationMinutes: service.durationMinutes,
                  priceMinor: price.priceMinor,
                  basePriceMinor: price.basePriceMinor,
                  discountMinor: price.discountMinor,
                  discountType: value.discountType,
                  discountBasisPoints: value.discountBasisPoints,
                  currency: service.currency,
                  expirationDays: value.expirationDays,
                  eligibleServiceIds: [service.id],
                  meetingProviders: [deliveryFormat],
                  deliveryFormat,
                  recurringEligible: value.renewalModes.some(
                    (mode) => mode !== "one_time",
                  ),
                  visibility: value.visibility,
                  directPurchase: value.directPurchase,
                  giftable: value.giftable,
                  active: value.active,
                  pricingServiceId: service.id,
                  pricingServiceVersion: service.version,
                  pricingStatus: "current",
                  version: 1,
                  updatedAt: new Date().toISOString(),
                };
                const current = draft.packageDefinitions.find(
                  (item) => item.id === definition.id,
                );
                if (current)
                  Object.assign(current, definition, {
                    version: current.version + 1,
                  });
                else draft.packageDefinitions.push(definition);
              }
        });
        setNotice("Package catalog saved.");
      } else {
        const existing = value.id
          ? data.packageDefinitions.find((item) => item.id === value.id)
          : undefined;
        const commandPayload = existing
          ? {
              ...value,
              pricingServiceId: value.serviceIds[0],
              sessionCount: value.sessionCounts[0],
              deliveryFormat: value.deliveryFormats[0],
            }
          : value;
        await studioCommand("packages", {
          command: existing ? "update" : "bulk_create",
          entityId: existing?.id,
          expectedVersion: existing?.version ?? 0,
          payload: commandPayload as unknown as Record<string, unknown>,
          reason: "Coach configured lesson package",
        });
        await invalidateStudioDomains(queryClient, ["finance"]);
      }
      setDialog(undefined);
      if (!isDemo)
        setNotice(
          value.id
            ? "Package recalculated and saved."
            : "Package combinations created with server-calculated prices.",
        );
    } catch (reason) {
      setNotice(
        reason instanceof Error
          ? reason.message
          : "Package could not be saved.",
      );
    }
  };
  return (
    <div>
      {notice && (
        <p className="portal-notice" role="status">
          {notice}
        </p>
      )}
      <div className="two-section-grid">
        <Section
          title="Package catalog"
          marked
          aside={<button onClick={() => setDialog("new")}>Add package</button>}
        >
          <div className="table-list">
            {data.packageDefinitions.map((definition) => (
              <article key={definition.id}>
                <CircleDollarSign />
                <div>
                  <strong>{definition.name}</strong>
                  <small>
                    {definition.sessionCount} ×{" "}
                    {definition.sessionDurationMinutes} minutes ·{" "}
                    {formatMoney(definition.priceMinor, definition.currency)}
                  </small>
                </div>
                <Status
                  tone={
                    definition.active
                      ? definition.visibility === "public"
                        ? "good"
                        : "warn"
                      : "neutral"
                  }
                >
                  {definition.active ? definition.visibility : "archived"}
                </Status>
                {packagePricingChanged(
                  definition,
                  data.bookingServices.find(
                    (service) => service.id === definition.pricingServiceId,
                  ),
                ) && <Status tone="warn">Pricing changed</Status>}
                {definition.giftable && definition.visibility === "public" && (
                  <a
                    className="button-link"
                    href={`/gift/${definition.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Gift link
                  </a>
                )}
                {definition.visibility === "public" &&
                  definition.directPurchase && (
                    <a
                      className="button-link"
                      href={`/package/${definition.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Direct link
                    </a>
                  )}
                <button onClick={() => setDialog(definition)}>Edit</button>
              </article>
            ))}
            {!data.packageDefinitions.length && (
              <EmptyState
                title="No package products"
                detail="Create reusable 4-, 6-, 8-, 10-, or custom-session packages here."
              />
            )}
          </div>
        </Section>
        <Section title="Student packages">
          <div className="table-list">
            {data.packages.map((pkg) => (
              <article key={pkg.id}>
                <CircleDollarSign />
                <div>
                  <strong>
                    {studentName(data, pkg.studentId)} · {pkg.name}
                  </strong>
                  <small>{formatMoney(pkg.priceMinor, pkg.currency)}</small>
                </div>
                <Status
                  tone={
                    packageSummary(pkg, data.creditEntries).remainingCredits <=
                    1
                      ? "warn"
                      : "good"
                  }
                >
                  {packageSummary(pkg, data.creditEntries).remainingCredits}{" "}
                  left
                </Status>
                <button
                  onClick={() =>
                    navigate(`/coach/students/${pkg.studentId}/payments`)
                  }
                >
                  Open
                </button>
              </article>
            ))}
            {!data.packages.length && (
              <EmptyState
                title="No student packages"
                detail="Purchased or coach-assigned package balances will appear here."
              />
            )}
          </div>
        </Section>
        <Section title="Balances">
          <div className="table-list">
            {data.students.map((student) => (
              <article key={student.id}>
                <CheckCircle2 />
                <div>
                  <strong>{student.fullName}</strong>
                  <small>Payments, refunds, and adjustments</small>
                </div>
                <strong>
                  {formatMoney(studentBalanceMinor(student.id, data.payments))}
                </strong>
                <button
                  onClick={() =>
                    navigate(`/coach/students/${student.id}/payments`)
                  }
                >
                  Open
                </button>
              </article>
            ))}
            {!data.students.length && (
              <EmptyState
                title="No balances yet"
                detail="Add a student to begin tracking charges, payments, refunds, and adjustments."
              />
            )}
          </div>
        </Section>
        <Section
          title="Coupons & discounts"
          marked
          aside={
            <button onClick={() => setDiscountDialog("new")}>
              Create code
            </button>
          }
        >
          <div className="table-list">
            {data.discountCodes.map((code) => (
              <article key={code.id}>
                <CircleDollarSign />
                <div>
                  <strong>{code.code}</strong>
                  <small>
                    {code.description || "Booking discount"} ·{" "}
                    {code.discountType === "percent"
                      ? `${code.amount}%`
                      : formatMoney(code.amount, code.currency)}{" "}
                    · {code.redemptionCount} used
                  </small>
                </div>
                <Status tone={code.active ? "good" : "neutral"}>
                  {code.active ? "active" : "inactive"}
                </Status>
                <button onClick={() => setDiscountDialog(code)}>Edit</button>
              </article>
            ))}
            {!data.discountCodes.length && (
              <EmptyState
                title="No discount codes"
                detail="Create optional codes that can apply to every service or selected services."
              />
            )}
          </div>
        </Section>
      </div>
      {dialog && (
        <PackageDefinitionDialog
          value={dialog === "new" ? undefined : dialog}
          data={data}
          onClose={() => setDialog(undefined)}
          onSave={(value) => void save(value)}
        />
      )}
      {discountDialog && (
        <DiscountDialog
          value={discountDialog === "new" ? undefined : discountDialog}
          data={data}
          onClose={() => setDiscountDialog(undefined)}
          onSave={(value) => void saveDiscount(value)}
        />
      )}
    </div>
  );
}

function DiscountDialog({
  value,
  data,
  onClose,
  onSave,
}: {
  value?: DiscountCode;
  data: StudioSnapshot;
  onClose: () => void;
  onSave: (value: DiscountCode) => void;
}) {
  const [form, setForm] = useState<DiscountCode>(() =>
    value
      ? structuredClone(value)
      : {
          id: `discount-${crypto.randomUUID()}`,
          studioId: data.studioId,
          code: "",
          description: "",
          discountType: "percent",
          amount: 10,
          currency: "USD",
          serviceIds: [],
          active: true,
          redemptionCount: 0,
          version: 1,
          updatedAt: new Date().toISOString(),
        },
  );
  const toggle = (id: string, checked: boolean) =>
    setForm({
      ...form,
      serviceIds: checked
        ? [...new Set([...form.serviceIds, id])]
        : form.serviceIds.filter((item) => item !== id),
    });
  return (
    <Dialog
      title={value ? `Edit ${value.code}` : "Create discount code"}
      description="Codes are validated on the server and snapshotted on each booking."
      onClose={onClose}
    >
      <form
        className="workflow-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ ...form, code: form.code.toUpperCase() });
        }}
      >
        <label>
          Code
          <input
            required
            minLength={3}
            value={form.code}
            onChange={(event) =>
              setForm({
                ...form,
                code: event.target.value
                  .toUpperCase()
                  .replace(/[^A-Z0-9_-]/g, ""),
              })
            }
            placeholder="WELCOME10"
          />
        </label>
        <label>
          Discount
          <select
            value={form.discountType}
            onChange={(event) =>
              setForm({
                ...form,
                discountType: event.target
                  .value as DiscountCode["discountType"],
              })
            }
          >
            <option value="percent">Percentage</option>
            <option value="fixed">Fixed USD amount</option>
          </select>
        </label>
        <label>
          Amount
          <input
            required
            type="number"
            min="1"
            max={form.discountType === "percent" ? 100 : 100000}
            value={
              form.discountType === "fixed" ? form.amount / 100 : form.amount
            }
            onChange={(event) =>
              setForm({
                ...form,
                amount:
                  form.discountType === "fixed"
                    ? Math.round(Number(event.target.value) * 100)
                    : Number(event.target.value),
              })
            }
          />
        </label>
        <label>
          Maximum uses
          <input
            type="number"
            min="1"
            value={form.maxRedemptions || ""}
            onChange={(event) =>
              setForm({
                ...form,
                maxRedemptions: event.target.value
                  ? Number(event.target.value)
                  : undefined,
              })
            }
          />
        </label>
        <label className="full">
          Description
          <input
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
          />
        </label>
        <fieldset className="full option-fieldset">
          <legend>Eligible services</legend>
          <small>
            Leave every service unchecked to apply the code studio-wide.
          </small>
          {data.bookingServices.map((service) => (
            <label className="check-row" key={service.id}>
              <input
                type="checkbox"
                checked={form.serviceIds.includes(service.id)}
                onChange={(event) => toggle(service.id, event.target.checked)}
              />
              {service.name}
            </label>
          ))}
        </fieldset>
        <label className="check-row full">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) =>
              setForm({ ...form, active: event.target.checked })
            }
          />
          Active
        </label>
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary">Save discount</button>
        </div>
      </form>
    </Dialog>
  );
}

function PackageDefinitionDialog({
  value,
  data,
  onClose,
  onSave,
}: {
  value?: PackageDefinition;
  data: StudioSnapshot;
  onClose: () => void;
  onSave: (value: PackageBuilderPayload) => void;
}) {
  const [form, setForm] = useState<PackageBuilderPayload>(() => ({
    id: value?.id,
    serviceIds: value?.pricingServiceId
      ? [value.pricingServiceId]
      : value?.eligibleServiceIds.slice(0, 1) || [],
    sessionCounts: [value?.sessionCount || 4],
    deliveryFormats: [
      (value?.deliveryFormat || value?.meetingProviders[0] || "google_meet") as
        "google_meet" | "in_person",
    ],
    name: value?.name || "",
    description: value?.description || "",
    expirationDays: value?.expirationDays || 180,
    discountType: value?.discountType || "none",
    discountMinor: value?.discountMinor || 0,
    discountBasisPoints: value?.discountBasisPoints || 0,
    visibility: value?.visibility || "private",
    directPurchase: value?.directPurchase ?? true,
    giftable: value?.giftable ?? true,
    renewalModes: ["one_time"],
    balanceThreshold: 1,
    active: value?.active ?? true,
  }));
  const toggle = <T extends string>(items: T[], item: T, checked: boolean) =>
    checked
      ? [...new Set([...items, item])]
      : items.filter((current) => current !== item);
  const toggleCount = (count: number, checked: boolean) =>
    checked
      ? [...new Set([...form.sessionCounts, count])]
      : form.sessionCounts.filter((current) => current !== count);
  const previewService = data.bookingServices.find(
    (service) => service.id === form.serviceIds[0],
  );
  const previewCount = form.sessionCounts[0] || 1;
  const previewUnit =
    (previewService?.priceMinor || 0) +
    (form.deliveryFormats[0] === "in_person"
      ? data.settings.bookingDefaults.inPersonUpchargeMinor
      : 0);
  const preview = calculatePackagePrice({
    unitPriceMinor: previewUnit,
    sessionCount: previewCount,
    discountType: form.discountType,
    discountMinor: form.discountMinor,
    discountBasisPoints: form.discountBasisPoints,
  });
  const combinationCount =
    form.serviceIds.length *
    form.sessionCounts.length *
    form.deliveryFormats.length;
  return (
    <Dialog
      title={value ? "Edit and recalculate package" : "Create packages"}
      description="Choose services, lesson counts, and formats. Coach’D calculates every price from your current service catalog—there is no editable price field."
      onClose={onClose}
    >
      <form
        className="workflow-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !form.serviceIds.length ||
            !form.sessionCounts.length ||
            !form.deliveryFormats.length
          )
            return;
          onSave(form);
        }}
      >
        <fieldset className="full option-fieldset">
          <legend>Services</legend>
          {data.bookingServices
            .filter((service) => service.published)
            .map((service) => (
              <label className="check-row" key={service.id}>
                <input
                  type="checkbox"
                  disabled={Boolean(value)}
                  checked={form.serviceIds.includes(service.id)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      serviceIds: toggle(
                        form.serviceIds,
                        service.id,
                        event.target.checked,
                      ),
                    })
                  }
                />
                <span>
                  <strong>{service.name}</strong>
                  <small>
                    {formatMoney(service.priceMinor, service.currency)} per
                    lesson
                  </small>
                </span>
              </label>
            ))}
          {!data.bookingServices.some((service) => service.published) && (
            <small>Publish a booking service before creating a package.</small>
          )}
        </fieldset>
        <fieldset className="full option-fieldset">
          <legend>Lesson counts</legend>
          <div className="package-choice-grid">
            {[1, 4, 6, 8, 10, 12].map((count) => (
              <label className="choice-chip" key={count}>
                <input
                  type="checkbox"
                  disabled={Boolean(value)}
                  checked={form.sessionCounts.includes(count)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      sessionCounts: toggleCount(count, event.target.checked),
                    })
                  }
                />
                {count}
              </label>
            ))}
          </div>
          {!value && (
            <label>
              Custom count
              <input
                type="number"
                min="1"
                max="100"
                placeholder="e.g. 16"
                onBlur={(event) => {
                  const count = Number(event.target.value);
                  if (count > 0)
                    setForm({
                      ...form,
                      sessionCounts: [
                        ...new Set([...form.sessionCounts, count]),
                      ],
                    });
                }}
              />
            </label>
          )}
        </fieldset>
        <fieldset className="full option-fieldset">
          <legend>Delivery formats</legend>
          {(["google_meet", "in_person"] as const).map((format) => (
            <label className="check-row" key={format}>
              <input
                type="checkbox"
                disabled={Boolean(value)}
                checked={form.deliveryFormats.includes(format)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    deliveryFormats: toggle(
                      form.deliveryFormats,
                      format,
                      event.target.checked,
                    ),
                  })
                }
              />
              <span>
                <strong>
                  {format === "google_meet" ? "Google Meet" : "In person"}
                </strong>
                {format === "in_person" &&
                  data.settings.bookingDefaults.inPersonUpchargeMinor > 0 && (
                    <small>
                      {formatMoney(
                        data.settings.bookingDefaults.inPersonUpchargeMinor,
                      )}{" "}
                      upcharge per lesson
                    </small>
                  )}
              </span>
            </label>
          ))}
        </fieldset>
        <label>
          Discount type
          <select
            value={form.discountType}
            onChange={(event) =>
              setForm({
                ...form,
                discountType: event.target
                  .value as PackageBuilderPayload["discountType"],
              })
            }
          >
            <option value="none">No discount</option>
            <option value="percent">Percentage</option>
            <option value="fixed">Fixed amount</option>
          </select>
        </label>
        {form.discountType === "percent" && (
          <label>
            Discount percentage
            <input
              type="number"
              min="0"
              max="100"
              value={form.discountBasisPoints / 100}
              onChange={(event) =>
                setForm({
                  ...form,
                  discountBasisPoints: Math.round(
                    Number(event.target.value) * 100,
                  ),
                })
              }
            />
          </label>
        )}
        {form.discountType === "fixed" && (
          <label>
            Discount amount
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.discountMinor / 100}
              onChange={(event) =>
                setForm({
                  ...form,
                  discountMinor: Math.round(Number(event.target.value) * 100),
                })
              }
            />
          </label>
        )}
        <div className="full package-price-preview" role="status">
          <div>
            <small>Example base price</small>
            <strong>{formatMoney(preview.basePriceMinor)}</strong>
          </div>
          <div>
            <small>Savings</small>
            <strong>{formatMoney(preview.discountMinor)}</strong>
          </div>
          <div>
            <small>Calculated total</small>
            <strong>{formatMoney(preview.priceMinor)}</strong>
          </div>
          <p>
            {combinationCount || 0} package{combinationCount === 1 ? "" : "s"}{" "}
            will be {value ? "recalculated" : "created"}. Final prices are
            verified on the server.
          </p>
        </div>
        <label>
          Name override
          <input
            value={form.name || ""}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Leave blank for automatic names"
          />
          <small>
            For bulk creation, automatic names keep every combination clear.
          </small>
        </label>
        <label>
          Expires after days
          <input
            type="number"
            min="1"
            value={form.expirationDays ?? ""}
            onChange={(event) =>
              setForm({
                ...form,
                expirationDays: event.target.value
                  ? Number(event.target.value)
                  : undefined,
              })
            }
          />
        </label>
        <label>
          Visibility
          <select
            value={form.visibility}
            onChange={(event) =>
              setForm({
                ...form,
                visibility: event.target
                  .value as PackageDefinition["visibility"],
              })
            }
          >
            <option value="private">Private</option>
            <option value="public">Public</option>
          </select>
        </label>
        <label className="full">
          Description
          <textarea
            value={form.description}
            onChange={(event) =>
              setForm({ ...form, description: event.target.value })
            }
          />
        </label>
        <fieldset className="full option-fieldset">
          <legend>Purchase and renewal choices</legend>
          {(
            [
              ["one_time", "One-time purchase"],
              ["weekly", "Every week"],
              ["biweekly", "Every two weeks"],
              ["monthly", "Monthly"],
              ["balance_threshold", "When credits run low"],
            ] as const
          ).map(([mode, label]) => (
            <label className="check-row" key={mode}>
              <input
                type="checkbox"
                checked={form.renewalModes.includes(mode)}
                onChange={(event) =>
                  setForm({
                    ...form,
                    renewalModes: toggle(
                      form.renewalModes,
                      mode,
                      event.target.checked,
                    ),
                  })
                }
              />
              {label}
            </label>
          ))}
          {form.renewalModes.includes("balance_threshold") && (
            <label>
              Renew at this balance
              <input
                type="number"
                min="0"
                max="20"
                value={form.balanceThreshold}
                onChange={(event) =>
                  setForm({
                    ...form,
                    balanceThreshold: Number(event.target.value),
                  })
                }
              />
            </label>
          )}
        </fieldset>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.directPurchase}
            onChange={(event) =>
              setForm({ ...form, directPurchase: event.target.checked })
            }
          />
          Student can buy directly
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={form.giftable}
            onChange={(event) =>
              setForm({ ...form, giftable: event.target.checked })
            }
          />
          Can be purchased as a gift
        </label>
        <label className="check-row full">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) =>
              setForm({ ...form, active: event.target.checked })
            }
          />
          Active package
        </label>
        <div className="form-actions full">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={!combinationCount}>
            {value
              ? "Recalculate package"
              : `Create ${combinationCount || ""} package${combinationCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
