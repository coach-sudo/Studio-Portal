import { useEffect, useState } from "react";

const preferenceKey = "coachd.sidebar.collapsed";

export function useSidebarCollapse() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(preferenceKey) === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(preferenceKey, String(collapsed));
    } catch {
      // The workspace still works when browser storage is unavailable.
    }
  }, [collapsed]);
  return [collapsed, setCollapsed] as const;
}
