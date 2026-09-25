import {
  CheckCircle2,
  Copy,
  Gift,
  RefreshCw,
  Search,
  Share2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader, Section } from "../../components/Primitives";
import {
  loadReferralOverview,
  type ReferralOverview,
} from "../../data/referrals";
import { formatMoney } from "../../domain/finance";
import type { Student, StudioSettings } from "../../domain/model";
import { useStudioRoute } from "../../hooks/useStudio";
import "./Referrals.css";

const demoCode = (id: string) =>
  id
    .replace(/[^a-fA-F0-9]/g, "")
    .padEnd(16, "0")
    .slice(0, 16)
    .toUpperCase();
const defaultReferralConfig: StudioSettings["referralProgram"] = {
  enabled: true,
  paidLessonRewardMinor: 1500,
  recurringSlotRewardSessionMinutes: 60,
};
const demoOverview = (
  students: Student[],
  config: StudioSettings["referralProgram"],
): ReferralOverview => ({
  config,
  students: students.map((student) => ({
    id: student.id,
    name: student.fullName,
    code: demoCode(student.id),
  })),
  referrals: [],
  rewards: [],
});
const rewardLabel = (
  kind: ReferralOverview["rewards"][number]["kind"],
  config: ReferralOverview["config"],
) =>
  kind === "paid_lesson"
    ? `${formatMoney(config.paidLessonRewardMinor)} off a lesson`
    : `Free ${config.recurringSlotRewardSessionMinutes}-minute private lesson`;
const referralLink = (code: string) =>
  `${window.location.origin}/book?ref=${code}`;

function useReferrals(
  students: Student[] | undefined,
  demo: boolean,
  config: StudioSettings["referralProgram"],
) {
  const [overview, setOverview] = useState<ReferralOverview>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    if (demo) {
      setOverview(demoOverview(students || [], config));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setOverview(await loadReferralOverview());
      setError("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load referrals.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (students) void refresh();
  }, [students, demo, config]);
  return { overview, error, loading, refresh };
}

function ShareLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = referralLink(code);
  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  };
  return (
    <div className="referral-share" data-copied={copied || undefined}>
      <input
        aria-label="Your referral link"
        readOnly
        value={link}
        onFocus={(event) => event.target.select()}
      />
      <button type="button" onClick={() => void copy()}>
        <Copy size={16} /> {copied ? "Copied" : "Copy link"}
      </button>
      <button
        type="button"
        className="primary-button"
        onClick={async () => {
          if (navigator.share) {
            try {
              await navigator.share({
                title: "Book coaching with Coach’D",
                text: "Here’s my personal coaching referral link.",
                url: link,
              });
              return;
            } catch (reason) {
              if (
                reason instanceof DOMException &&
                reason.name === "AbortError"
              )
                return;
            }
          }
          await copy();
        }}
      >
        <Share2 size={16} /> Share
      </button>
      <span className="visually-hidden" role="status" aria-live="polite">
        {copied ? "Referral link copied to clipboard." : ""}
      </span>
    </div>
  );
}

function RewardList({
  overview,
  referralId,
}: {
  overview: ReferralOverview;
  referralId: string;
}) {
  const rewards = overview.rewards.filter(
    (reward) => reward.referralId === referralId,
  );
  return (
    <div className="referral-rewards">
      {rewards.length ? (
        rewards.map((reward) => (
          <span key={reward.id} className="referral-reward">
            <Gift size={15} /> {rewardLabel(reward.kind, overview.config)} ·{" "}
            {reward.redeemed ? (
              "used"
            ) : (
              <>
                <code>{reward.code}</code>{" "}
                <Link to={`/book?discount=${encodeURIComponent(reward.code)}`}>
                  Book with reward
                </Link>
              </>
            )}
          </span>
        ))
      ) : (
        <span className="muted">Awaiting a paid booking</span>
      )}
    </div>
  );
}

export function CoachReferrals() {
  const { data, isDemo } = useStudioRoute("coach", undefined, [
    "identity",
    "students",
    "referrals",
  ]);
  const { overview, error, loading, refresh } = useReferrals(
    data?.students,
    isDemo,
    data?.settings.referralProgram || defaultReferralConfig,
  );
  const [studentSearch, setStudentSearch] = useState("");
  const names = useMemo(
    () =>
      new Map(overview?.students.map((student) => [student.id, student.name])),
    [overview],
  );
  const visibleStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();
    return (overview?.students || []).filter(
      (student) =>
        !query ||
        student.name.toLowerCase().includes(query) ||
        student.code.toLowerCase().includes(query),
    );
  }, [overview?.students, studentSearch]);
  return (
    <div className="referrals-page">
      <PageHeader title="Referrals">
        Shareable student links, earned rewards, and referred bookings.
      </PageHeader>
      <div className="referral-intro">
        <Users size={22} />
        <p>
          A student earns{" "}
          {formatMoney(overview?.config.paidLessonRewardMinor ?? 1500)} off a
          lesson after a friend’s first paid booking. A paid recurring private
          slot also earns one free{" "}
          {overview?.config.recurringSlotRewardSessionMinutes ?? 60}-minute
          private lesson. Each configured reward is issued once per referred
          person.
          {overview?.config.referredPersonBenefit
            ? ` Their friend also receives ${overview.config.referredPersonBenefit}.`
            : ""}
        </p>
      </div>
      <Section title="Student links">
        {loading && !overview ? (
          <p>Loading referrals…</p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : null}
        <button
          type="button"
          className="referral-refresh"
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} /> Refresh
        </button>
        <label className="referral-search">
          <Search size={16} />
          <span className="visually-hidden">Search student referral links</span>
          <input
            value={studentSearch}
            onChange={(event) => setStudentSearch(event.target.value)}
            placeholder="Search student or referral code"
          />
        </label>
        <div className="referral-student-grid">
          {visibleStudents.map((student) => (
            <article key={student.id}>
              <strong>{student.name}</strong>
              <small>{student.code}</small>
              <ShareLink code={student.code} />
            </article>
          ))}
        </div>
      </Section>
      <Section
        title={`Referred people${overview ? ` (${overview.referrals.length})` : ""}`}
      >
        {!overview?.referrals.length ? (
          <p>No referrals have booked yet.</p>
        ) : (
          <div className="referral-tracking">
            {overview.referrals.map((referral) => (
              <article key={referral.id}>
                <div>
                  <strong>{referral.referred_email}</strong>
                  <small>
                    Referred by{" "}
                    {names.get(referral.referrer_student_id) || "Student"} ·{" "}
                    {new Date(referral.created_at).toLocaleDateString()}
                  </small>
                </div>
                <RewardList overview={overview} referralId={referral.id} />
              </article>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

export function StudentReferrals({
  students,
  settings,
  isDemo,
}: {
  students: Student[];
  settings: StudioSettings;
  isDemo: boolean;
}) {
  const { overview, error, loading, refresh } = useReferrals(
    students,
    isDemo,
    settings.referralProgram,
  );
  const student = overview?.students.find(
    (item) => item.id === students[0]?.id,
  );
  return (
    <div className="student-page referrals-page">
      <header className="student-header">
        <small>Share and save</small>
        <h1>Refer a friend</h1>
        <p>
          Give a friend your personal booking link. Your rewards stay here,
          ready to use.
        </p>
      </header>
      <Section title="Your referral link">
        {loading && !overview ? (
          <p>Loading your link…</p>
        ) : error ? (
          <p role="alert">{error}</p>
        ) : null}
        {student && overview && (
          <>
            <ShareLink code={student.code} />
            <p>
              After your friend books and pays for a lesson, you earn{" "}
              <strong>
                {formatMoney(overview.config.paidLessonRewardMinor)} off your
                next lesson
              </strong>
              . If they ever buy a paid recurring private slot, you also earn{" "}
              <strong>
                one free {overview.config.recurringSlotRewardSessionMinutes}
                -minute private lesson
              </strong>
              . Each configured reward is earned once per friend.
              {overview.config.referredPersonBenefit && (
                <>
                  {" "}
                  Your friend receives {overview.config.referredPersonBenefit}.
                </>
              )}
            </p>
          </>
        )}
      </Section>
      <Section
        title={`Your referrals${overview ? ` (${overview.referrals.length})` : ""}`}
      >
        <button
          type="button"
          className="referral-refresh"
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} /> Refresh
        </button>
        {overview?.rewards.some((reward) => !reward.redeemed) && (
          <div className="referral-celebration" role="status">
            <CheckCircle2 />
            <span>
              <strong>A referral reward is ready</strong>
              <small>Use the reward code below when you book.</small>
            </span>
          </div>
        )}
        {!overview?.referrals.length ? (
          <p>
            No one has used your link yet. Share it with a friend to get
            started.
          </p>
        ) : (
          <div className="referral-tracking">
            {overview.referrals.map((referral) => (
              <article key={referral.id}>
                <div>
                  <strong>{referral.referred_email}</strong>
                  <small>
                    Joined {new Date(referral.created_at).toLocaleDateString()}
                  </small>
                </div>
                <span className="status neutral">
                  {overview.rewards.some(
                    (reward) =>
                      reward.referralId === referral.id && reward.redeemed,
                  )
                    ? "redeemed"
                    : overview.rewards.some(
                          (reward) => reward.referralId === referral.id,
                        )
                      ? "earned"
                      : "pending"}
                </span>
                <RewardList overview={overview} referralId={referral.id} />
              </article>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
