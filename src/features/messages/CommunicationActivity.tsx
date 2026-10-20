import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { loadCommunicationActivity } from "../../data/studioOperations";
import { usePrivateIdentity } from "../../hooks/usePrivateIdentity";
import { Status } from "../../components/Primitives";

export function CommunicationActivity({ isDemo }: { isDemo: boolean }) {
  const identity = usePrivateIdentity(),
    [open, setOpen] = useState(false),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [kind, setKind] = useState("");
  const attention = useQuery({
    queryKey: ["communication-attention", identity],
    queryFn: ({ signal }) => loadCommunicationActivity(1, true, "", signal),
    enabled: !isDemo && !!identity,
    refetchInterval: 30_000,
  });
  const all = useQuery({
    queryKey: ["communication-activity", identity, page, search, kind],
    queryFn: ({ signal }) =>
      loadCommunicationActivity(page, false, search, signal, kind),
    enabled: open && !isDemo && !!identity,
  });
  const list = (q: typeof attention) =>
    q.isError ? (
      <p role="alert">
        Activity unavailable.{" "}
        <button onClick={() => void q.refetch()}>Retry</button>
      </p>
    ) : q.isPending ? (
      <p role="status">Loading activity…</p>
    ) : (
      <div className="table-list">
        {q.data?.items.map((r) => (
          <article key={r.kind + r.id}>
            <div>
              <Link to={r.href}>{r.title || r.kind}</Link>
              <small>
                {r.kind} · {new Date(r.happened_at).toLocaleString()}
              </small>
            </div>
            <Status tone={r.attention ? "warn" : "neutral"}>{r.state}</Status>
          </article>
        ))}
        {!q.data?.items.length && <p>No matching activity.</p>}
      </div>
    );
  if (isDemo) return null;
  return (
    <div className="communication-activity">
      <details>
        <summary>
          Needs Attention{" "}
          {attention.data?.count ? `(${attention.data.count})` : ""}
        </summary>
        {list(attention)}
      </details>
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>All Activity</summary>
        {open && (
          <>
            <label>
              Search activity
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            <label>
              Activity type
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All activity</option>
                <option value="message">Messages</option>
                <option value="notification">Notifications</option>
                <option value="invitation">Invitations</option>
                <option value="campaign">Campaigns</option>
              </select>
            </label>
            {list(all)}
            <div className="form-actions">
              <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>Page {page}</span>
              <button
                disabled={page * 25 >= (all.data?.count || 0)}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </details>
    </div>
  );
}
