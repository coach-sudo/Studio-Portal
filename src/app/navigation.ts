import {
  BookOpen,
  CalendarCheck2,
  CalendarDays,
  Clapperboard,
  CircleDollarSign,
  FolderOpen,
  Home,
  Settings,
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
  { to: "/coach/materials", label: "Materials", icon: FolderOpen },
  { to: "/coach/finance", label: "Payments", icon: WalletCards },
  { to: "/coach/actor-pages", label: "Actor Pages", icon: Clapperboard },
  { to: "/coach/settings", label: "Settings", icon: Settings },
];

const studentNavigation: NavigationItem[] = [
  { to: "", label: "Home", icon: Home },
  { to: "work", label: "Current Work", icon: BookOpen },
  { to: "bookings", label: "Schedule", icon: CalendarDays },
  { to: "payments", label: "Payments", icon: CircleDollarSign },
  { to: "actor-page", label: "Actor Page", icon: Users },
  { to: "settings", label: "Settings", icon: Settings },
];

export function portalNavigation(role: "student" | "guardian", isMinor: boolean) {
  return studentNavigation
    .map((item) =>
      role === "guardian" && item.to === ""
        ? { ...item, label: "Overview" }
        : item,
    )
    .filter((item) => role === "guardian" || !isMinor || item.to !== "payments");
}
