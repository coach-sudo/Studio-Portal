import { supabase } from "../../lib/supabase";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Section, Status } from "../../components/Primitives";
import { CreditPackageMetrics } from "../../components/CreditPackageMetrics";
import { StudentCreditHistory } from "../../components/StudentCreditHistory";
import { PortalSharedCreditPools } from "../../components/SharedCreditPools";
import { loadCreditCoverage } from "../../data/creditCoverage";
import { studioCommand } from "../../data/bookingCommands";
import type { PortalContext } from "../../data/portalContext";
import type { CreditCoverage } from "../../domain/creditCoverage";
import { formatMoney } from "../../domain/finance";
import { formatStudioDateTime } from "../../domain/presentation";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";

const statusDetails = {
  covered: [
    "Covered",
    "An eligible credit is reserved for this lesson.",
    "good",
  ],
  needs_credit: [
    "Needs Credit",
    "The lesson is still scheduled and needs an eligible credit.",
    "warn",
  ],
  expiration_review: [
    "Expiration review",
    "The studio needs to check whether the reserved credit will still be valid.",
    "warn",
  ],
  processing: [
    "Processing",
    "The studio is confirming payment or coverage.",
    "neutral",
  ],
  studio_review: [
    "Under Review",
    "The studio is checking the credit coverage for this lesson.",
    "neutral",
  ],
  separate_payment: [
    "Separate payment",
    "This lesson uses a separate payment arrangement.",
    "neutral",
  ],
  awaiting_reservation: [
    "Awaiting credit reservation",
    "An eligible credit may be available. The lesson will show Covered once it is reserved.",
    "neutral",
  ],
} as const;

type CoverageLesson = CreditCoverage["items"][number];
const renewalSchema = z.object({
  canPurchase: z.boolean(),
  options: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      credits: z.number().int().positive(),
      durationMinutes: z.number().int().positive(),
      expirationDays: z.number().int().positive().nullable(),
      priceMinor: z.number().int().positive(),
      currency: z.string().length(3),
    }),
  ),
});

function useCoverage(
  studentId: string,
  page: number,
  enabled: boolean,
  processing = false,
) {
  const identity = usePrivateIdentity();
  return useQuery({
    queryKey: ["credit-coverage", identity, studentId, page],
    enabled: enabled && !!identity,
    queryFn: ({ signal }) =>
      loadCreditCoverage({ studentId, page, pageSize: 5 }, signal),
    refetchInterval: (query) =>
      processing || query.state.data?.maintenance?.pending ? 5000 : 30000,
  });
}

function coverageHref(studentId: string, lessonId?: string) {
  const params = new URLSearchParams({ student: studentId });
  if (lessonId) params.set("lesson", lessonId);
  return "/portal/credits?" + params;
}

function CoverageRows({
  view,
  timezone,
  compact,
  renewalLinks = true,
}: {
  view: CreditCoverage;
  timezone: string;
  compact?: boolean;
  renewalLinks?: boolean;
}) {
  const upcoming = view.items.filter((item) => item.coverageStatus);
  const ordered = compact
    ? [
        ...upcoming.filter((item) => item.coverageStatus === "needs_credit"),
        ...upcoming.filter((item) => item.coverageStatus !== "needs_credit"),
      ].slice(0, 2)
    : upcoming;
  return (
    <>
      {view.packages?.length ? (
        <div className="table-list" aria-label="Credit packages">
          {view.packages.map((balance) => (
            <article key={balance.id}>
              <div>
                <strong>{balance.name}</strong>
                <CreditPackageMetrics balance={balance} />
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p>No lesson packages.</p>
      )}
      {view.lessonsVisible && (
        <div className="table-list" aria-label="Upcoming lesson coverage">
          {ordered.map((item) => {
            const [label, description, tone] =
              statusDetails[item.coverageStatus!];
            return (
              <article key={item.lessonId}>
                <div>
                  <strong>{item.topic}</strong>
                  <small>
                    {formatStudioDateTime(item.startsAt, timezone)}
                    {item.durationMinutes
                      ? " · " + item.durationMinutes + " min"
                      : ""}
                  </small>
                  {!compact && <small>{description}</small>}
                </div>
                <Status tone={tone}>{label}</Status>
                {renewalLinks && item.coverageStatus === "needs_credit" && (
                  <Link to={coverageHref(view.studentId, item.lessonId)}>
                    Renew for this lesson
                  </Link>
                )}
              </article>
            );
          })}
          {!ordered.length && (
            <p>
              {view.total
                ? "Coverage status is unavailable."
                : "No upcoming lessons."}
            </p>
          )}
        </div>
      )}
    </>
  );
}

export function StudentCoverageSummary({
  studentId,
  timezone,
}: {
  studentId: string;
  timezone: string;
}) {
  const query = useCoverage(studentId, 1, true);
  return (
    <Section title="Lesson Credits" landmark>
      {query.data && !query.isError ? (
        <CoverageRows view={query.data} timezone={timezone} compact />
      ) : (
        <p role="status">
          {query.isError
            ? "Credit coverage is unavailable."
            : "Checking credit coverage…"}
        </p>
      )}
      <PortalSharedCreditPools studentIds={[studentId]} timezone={timezone} />
      <Link to={coverageHref(studentId)}>Credits &amp; Lessons</Link>
    </Section>
  );
}

function HouseholdPurchases({
  studentId,
  timezone,
}: {
  studentId: string;
  timezone: string;
}) {
  const identity = usePrivateIdentity();
  const [expanded, setExpanded] = useState(false);
  const purchases = useQuery({
    queryKey: ["household-purchases", identity, studentId],
    enabled: expanded && !!identity,
    queryFn: async ({ signal }) => {
      if (!supabase) throw new Error("Purchases unavailable.");
      const result = await supabase
        .from("payment_entries")
        .select("id,created_at,amount_minor,currency")
        .eq("student_id", studentId)
        .eq("kind", "payment")
        .not("package_id", "is", null)
        .order("created_at", { ascending: false })
        .order("id")
        .limit(10)
        .abortSignal(signal);
      if (result.error) throw result.error;
      return result.data;
    },
  });
  return (
    <details
      className="disclosure-section"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>Recent package purchases</summary>
      {purchases.isError ? (
        <p role="alert">Purchase history is unavailable.</p>
      ) : purchases.isPending ? (
        <p role="status">Checking purchases…</p>
      ) : purchases.data.length ? (
        <ul>
          {purchases.data.map((payment) => (
            <li key={payment.id}>
              {formatStudioDateTime(payment.created_at, timezone)} ·{" "}
              {formatMoney(payment.amount_minor, payment.currency)}
            </li>
          ))}
        </ul>
      ) : (
        <p>No package purchases recorded.</p>
      )}
      <Link to={"/portal/payments?student=" + studentId}>
        All payments and receipts
      </Link>
    </details>
  );
}

function HouseholdMember({
  member,
  timezone,
}: {
  member: PortalContext;
  timezone: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const query = useCoverage(member.id, 1, expanded && member.canViewFinance);
  return (
    <details
      className="disclosure-section"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>{member.preferredName || member.fullName}</summary>
      {member.canViewFinance ? (
        <>
          {query.data && !query.isError ? (
            <CoverageRows view={query.data} timezone={timezone} compact />
          ) : (
            <p role="status">
              {query.isError
                ? "Coverage is unavailable."
                : "Checking coverage…"}
            </p>
          )}
          <div className="header-actions">
            <Link to={coverageHref(member.id)}>Credits &amp; Lessons</Link>
          </div>
          <HouseholdPurchases studentId={member.id} timezone={timezone} />
        </>
      ) : (
        <p>Credit information is restricted for this student.</p>
      )}
    </details>
  );
}

export function HouseholdLessonCoverage({
  members,
  timezone,
}: {
  members: PortalContext[];
  timezone: string;
}) {
  return (
    <Section title="Household Lesson Coverage" landmark>
      <PortalSharedCreditPools
        studentIds={members
          .filter((member) => member.canViewFinance)
          .map((member) => member.id)}
        timezone={timezone}
      />
      {members.map((member) => (
        <HouseholdMember key={member.id} member={member} timezone={timezone} />
      ))}
      <details className="disclosure-section">
        <summary>Renewal reminders</summary>
        <p>Renewal reminder history is unavailable.</p>
      </details>
    </Section>
  );
}

function RenewalOptions({
  studentId,
  lesson,
  contact,
}: {
  studentId: string;
  lesson: CoverageLesson;
  contact: string;
}) {
  const identity = usePrivateIdentity();
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const options = useQuery({
    queryKey: ["lesson-renewal", identity, studentId, lesson.lessonId],
    enabled: !!identity,
    queryFn: async () =>
      renewalSchema.parse(
        (
          await studioCommand("finance", {
            command: "renewal_options",
            expectedVersion: 0,
            payload: { studentId, lessonId: lesson.lessonId },
            reason: "Review eligible lesson renewals",
          })
        ).resource,
      ),
  });
  async function openCheckout(
    option: z.infer<typeof renewalSchema>["options"][number],
  ) {
    if (pending) return;
    setPending(option.id);
    setError("");
    try {
      const result = await studioCommand("finance", {
        command: "checkout_definition",
        expectedVersion: 0,
        payload: {
          studentId,
          lessonId: lesson.lessonId,
          packageDefinitionId: option.id,
          renewalMode: "one_time",
          expectedPriceMinor: option.priceMinor,
          expectedCurrency: option.currency,
        },
        reason: "Start checkout for this lesson",
      });
      window.location.assign(result.resource.url);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Checkout could not be opened.",
      );
      setPending("");
    }
  }
  const eligible = options.isError ? undefined : options.data;
  return (
    <Section title="Renew for this lesson">
      <p>
        {lesson.topic}
        {lesson.durationMinutes ? " · " + lesson.durationMinutes + " min" : ""}
      </p>
      {options.isPending ? (
        <p role="status">Checking renewal options…</p>
      ) : eligible?.options.length ? (
        <div className="table-list">
          {eligible.options.map((option) => (
            <article key={option.id}>
              <div>
                <strong>{option.name}</strong>
                <small>
                  {option.credits} × {option.durationMinutes}-minute credits ·{" "}
                  {formatMoney(option.priceMinor, option.currency)}
                </small>
                <small>
                  {option.expirationDays
                    ? "Expires " +
                      option.expirationDays +
                      " days after issuance"
                    : "No expiration"}
                </small>
              </div>
              <button
                disabled={!!pending}
                onClick={() => void openCheckout(option)}
              >
                Continue to checkout
              </button>
            </article>
          ))}
        </div>
      ) : (
        <>
          <p>
            {eligible?.canPurchase === false
              ? "The designated billing contact can handle this renewal."
              : "No eligible renewal is available online for this lesson."}
          </p>
          <a href={"mailto:" + contact}>Contact Studio</a>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </Section>
  );
}

export function CreditsAndLessons({
  studentId,
  timezone,
  contact,
  enabled,
}: {
  studentId: string;
  timezone: string;
  contact: string;
  enabled: boolean;
}) {
  const [params] = useSearchParams();
  const [page, setPage] = useState(1);
  const processing = params.get("checkout") === "processing";
  const query = useCoverage(studentId, page, enabled, processing);
  const view = query.isError ? undefined : query.data;
  const selected = view?.items.find(
    (item) => item.lessonId === params.get("lesson"),
  );
  return (
    <div className="student-page">
      <h1>Credits &amp; Lessons</h1>
      {!enabled ? (
        <p>Credit information is restricted for this account.</p>
      ) : (
        <>
          {processing && (
            <p role="status">
              {selected?.coverageStatus === "covered"
                ? "An eligible credit is reserved for this lesson."
                : "Checkout has returned. Lesson coverage updates after the studio verifies the purchase and reserves a credit."}
            </p>
          )}
          {view ? (
            <Section title="Lesson Coverage">
              <CoverageRows
                view={view}
                timezone={timezone}
                renewalLinks={!processing}
              />
              {(page > 1 || view.hasMore) && (
                <div className="header-actions">
                  <button
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous lessons
                  </button>
                  <button
                    disabled={!view.hasMore}
                    onClick={() => setPage(page + 1)}
                  >
                    More lessons
                  </button>
                </div>
              )}
            </Section>
          ) : (
            <p role="status">
              {query.isError
                ? "Coverage is unavailable."
                : "Checking lesson coverage…"}
            </p>
          )}
          {!processing && selected?.coverageStatus === "needs_credit" && (
            <RenewalOptions
              studentId={studentId}
              lesson={selected}
              contact={contact}
            />
          )}
          <PortalSharedCreditPools
            studentIds={[studentId]}
            timezone={timezone}
          />
          <StudentCreditHistory studentId={studentId} timezone={timezone} />
        </>
      )}
    </div>
  );
}
