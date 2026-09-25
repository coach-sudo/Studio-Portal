import {
  CalendarCheck2,
  CalendarDays,
  Clapperboard,
  FolderOpen,
  Gift,
  Home,
  Settings,
  MessageSquare,
  Megaphone,
  Users,
  WalletCards,
} from "lucide-react";
import type { NavigationItem } from "./navigation";

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
