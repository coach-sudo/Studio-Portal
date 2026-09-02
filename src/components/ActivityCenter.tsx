import { Bell, CalendarCheck2, CheckSquare, FileText, FolderOpen, GraduationCap, Waypoints, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { StudioSnapshot } from "../domain/model";
import { buildActivityFeed, type ActivityItem } from "../domain/activityFeed";
import { supabase } from "../lib/supabase";
import { formatStudioDateTime } from "../domain/presentation";
import "./ActivityCenter.css";

const icons = { booking: CalendarCheck2, lesson: GraduationCap, material: FolderOpen, assignment: CheckSquare, note: FileText, import: Waypoints };

export function ActivityCenter({ data, audience }: { data: StudioSnapshot; audience: "coach" | "student" | "guardian" }) {
  const navigate = useNavigate();
  const root = useRef<HTMLDivElement>(null);
  const feed = useMemo(() => buildActivityFeed(data, audience), [data, audience]);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.from("notification_receipts").select("event_key").then(({ data: rows }) =>
      setRead(new Set((rows || []).map((row: { event_key: string }) => row.event_key))),
    );
  }, []);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, []);

  const unread = feed.filter((item) => !read.has(item.key)).length;
  const visibleFeed = feed.filter((item) => !read.has(item.key));
  async function markRead(item: ActivityItem) {
    setRead((current) => new Set(current).add(item.key));
    if (!supabase) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    await supabase.from("notification_receipts").upsert({
      studio_id: data.studioId,
      user_id: auth.user.id,
      event_key: item.key,
      read_at: new Date().toISOString(),
    }, { onConflict: "user_id,event_key" });
  }

  return <div className="activity-center" ref={root}>
    <button className="activity-bell" aria-label={`${unread} unread notifications`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Bell />{unread > 0 && <span>{unread > 9 ? "9+" : unread}</span>}
    </button>
    {open && <section className="activity-menu" aria-label="Recent activity">
      <header><div><strong>Recent activity</strong><small>Updates from the last 30 days</small></div><button aria-label="Close notifications" onClick={() => setOpen(false)}><X /></button></header>
      <div className="activity-list">
        {visibleFeed.map((item) => { const Icon = icons[item.kind]; return <button key={item.key} className={`unread ${item.priority}`} aria-label={`${item.title}. ${item.detail}`} onClick={() => { void markRead(item); setOpen(false); navigate(item.route); }}>
          <Icon /><span><strong>{item.title}</strong><small>{item.detail}</small><time>{formatStudioDateTime(item.occurredAt, data.settings.timezone)}</time></span>
        </button>; })}
        {!visibleFeed.length && <p>You’re all caught up. New bookings and studio work will appear here.</p>}
      </div>
    </section>}
  </div>;
}
