import {
  BookOpen,
  CalendarDays,
  CircleDollarSign,
  Gift,
  Home,
  Settings,
  MessageSquare,
  Users,
} from "lucide-react";
import type { NavigationItem } from "./navigation";

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

export function portalNavigation(
  role: "student" | "guardian",
  isMinor: boolean,
  permissions?: {
    canViewSchedule?: boolean;
    canViewWork?: boolean;
    canViewFinance?: boolean;
    canManageProfile?: boolean;
  },
) {
  return studentNavigation
    .map((item) =>
      role === "guardian" && item.to === ""
        ? { ...item, label: "Overview" }
        : item,
    )
    .filter((item) => {
      if (item.to === "payments")
        return role === "guardian"
          ? permissions?.canViewFinance !== false
          : !isMinor;
      if (role !== "guardian") return true;
      if (item.to === "bookings") return permissions?.canViewSchedule !== false;
      if (item.to === "work") return permissions?.canViewWork !== false;
      if (item.to === "actor-page")
        return permissions?.canManageProfile !== false;
      return true;
    });
}
