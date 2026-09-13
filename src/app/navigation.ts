import {
  BookOpen,
  CalendarCheck2,
  CalendarDays,
  Clapperboard,
  CircleDollarSign,
  FolderOpen,
  Gift,
  Home,
  Settings,
  MessageSquare,
  Megaphone,
  Users,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

export type NavigationItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};

export const coachNavigation: NavigationItem[] = [
  { to: "/coach", label: "Home", icon: Home },
  { to: "/coach/today", label: "Today", icon: CalendarDays },
  { to: "/coach/bookings", label: "Bookings", icon: CalendarCheck2 },
  { to: "/coach/students", label: "Students", icon: Users },
  { to: "/coach/inbox", label: "Inbox", icon: MessageSquare },
  { to: "/coach/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/coach/referrals", label: "Referrals", icon: Gift },
  { to: "/coach/materials", label: "Materials", icon: FolderOpen },
  { to: "/coach/finance", label: "Payments", icon: WalletCards },
  { to: "/coach/actor-pages", label: "Actor Pages", icon: Clapperboard },
  { to: "/coach/settings", label: "Settings", icon: Settings },
];

const studentNavigation: NavigationItem[] = [
  { to: "", label: "Home", icon: Home },
  { to: "work", label: "Current Work", icon: BookOpen },
  { to: "bookings", label: "Schedule", icon: CalendarDays },
  { to: "inbox", label: "Inbox", icon: MessageSquare },
  { to: "payments", label: "Payments", icon: CircleDollarSign },
  { to: "referrals", label: "Referrals", icon: Gift },
  { to: "actor-page", label: "Actor Page", icon: Users },
  { to: "settings", label: "Settings", icon: Settings },
];

export function portalNavigation(role: "student" | "guardian", isMinor: boolean, permissions?: { canViewSchedule?: boolean; canViewWork?: boolean; canViewFinance?: boolean; canManageProfile?: boolean }) {
  return studentNavigation
    .map((item) =>
      role === "guardian" && item.to === ""
        ? { ...item, label: "Overview" }
        : item,
    )
    .filter((item) => {
      if (item.to === "payments") return role === "guardian" ? permissions?.canViewFinance !== false : !isMinor;
      if (role !== "guardian") return true;
      if (item.to === "bookings") return permissions?.canViewSchedule !== false;
      if (item.to === "work") return permissions?.canViewWork !== false;
      if (item.to === "actor-page") return permissions?.canManageProfile !== false;
      return true;
    });
}
