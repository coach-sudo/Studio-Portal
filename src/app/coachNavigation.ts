import {
  CalendarCheck2,
  CalendarDays,
  Clapperboard,
  FolderOpen,
  Gift,
  Building2,
  Settings,
  MessageSquare,
  Megaphone,
  Users,
  WalletCards,
} from "lucide-react";
import type { NavigationItem } from "./navigation";

export const coachNavigation: NavigationItem[] = [
  { to: "/coach/today", label: "Today", icon: CalendarDays },
  { to: "/coach/bookings", label: "Calendar", icon: CalendarCheck2 },
  { to: "/coach/students", label: "Students", icon: Users },
  { to: "/coach/inbox", label: "Inbox", icon: MessageSquare },
  { to: "/coach/materials", label: "Library", icon: FolderOpen },
  { to: "/coach/studio", label: "Studio", icon: Building2 },
];
export const studioNavigation: NavigationItem[] = [
  { to: "/coach/finance", label: "Payments", icon: WalletCards },
  { to: "/coach/actor-pages", label: "Actor Pages", icon: Clapperboard },
  { to: "/coach/referrals", label: "Referrals", icon: Gift },
  { to: "/coach/campaigns", label: "Campaigns", icon: Megaphone },
  {
    to: "/coach/bookings?view=services",
    label: "Services",
    icon: CalendarCheck2,
  },
  {
    to: "/coach/bookings?view=availability",
    label: "Availability",
    icon: CalendarDays,
  },
  {
    to: "/coach/bookings?view=setup",
    label: "Booking setup",
    icon: CalendarCheck2,
  },
  { to: "/coach/settings", label: "Settings", icon: Settings },
];
