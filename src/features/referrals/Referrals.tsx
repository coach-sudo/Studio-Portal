import { Copy, Gift, RefreshCw, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader, Section } from "../../components/Primitives";
import {
  loadReferralOverview,
  type ReferralOverview,
} from "../../data/referrals";
import type { Student } from "../../domain/model";
import { useStudio } from "../../hooks/useStudio";
import "./Referrals.css";

const demoCode = (id: string) =>
  id
    .replace(/[^a-fA-F0-9]/g, "")
    .padEnd(16, "0")
    .slice(0, 16)
    .toUpperCase();
const demoOverview = (students: Student[]): ReferralOverview => ({
  students: students.map((student) => ({
    id: student.id,
    name: student.fullName,
    code: demoCode(student.id),
  })),
  referrals: [],
  rewards: [],
});
const rewardLabel = (kind: ReferralOverview["rewards"][number]["kind"]) =>
  kind === "paid_lesson" ? "$15 off a lesson" : "Free 60-minute private lesson";
const referralLink = (code: string) =>
  `${window.location.origin}/book?ref=${code}`;

function useReferrals(students: Student[] | undefined, demo: boolean) {
  const [overview, setOverview] = useState<ReferralOverview>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    if (demo) {
      setOverview(demoOverview(students || []));
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
  }, [Boolean(students), demo]);
  return { overview, error, loading, refresh };
}

function ShareLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const link = referralLink(code);
  return (
    <div className="referral-share">
      <input
        aria-label="Your referral link"
        readOnly
        value={link}
        onFocus={(event) => event.target.select()}
      />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(link);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2500);
        }}
      >
        <Copy size={16} /> {copied ? "Copied" : "Copy link"}
      </button>
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
            <Gift size={15} /> {rewardLabel(reward.kind)} ·{" "}
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
  const { data, isDemo } = useStudio();
  const { overview, error, loading, refresh } = useReferrals(
    data?.students,
    isDemo,
  );
  const names = useMemo(
    () =>
      new Map(overview?.students.map((student) => [student.id, student.name])),
    [overview],
  );
  return (
    <div className="referrals-page">
      <PageHeader title="Referrals">
        Shareable student links, earned rewards, and referred bookings.
      </PageHeader>
      <div className="referral-intro">
        <Users size={22} />
        <p>
          A referred person earns their student a $15 lesson discount after
          their first paid booking. A paid recurring private slot also earns one
          free 60-minute private lesson. Each reward is issued once per referred
          person.
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
        <div className="referral-student-grid">
          {overview?.students.map((student) => (
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
  isDemo,
}: {
  students: Student[];
  isDemo: boolean;
}) {
  const { overview, error, loading, refresh } = useReferrals(students, isDemo);
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
        {student && (
          <>
            <ShareLink code={student.code} />
            <p>
              After your friend books and pays for a lesson, you earn{" "}
              <strong>$15 off your next lesson</strong>. If they ever buy a paid
              recurring private slot, you also earn{" "}
              <strong>one free 60-minute private lesson</strong>. Each reward is
              earned once per friend.
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
                <RewardList overview={overview} referralId={referral.id} />
              </article>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
