import {
  createElement,
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { safeReturnPath } from "../app/recordLinks";

type UpdateParams = (
  change: (current: URLSearchParams) => URLSearchParams,
  replace?: boolean,
) => void;
const WorkspaceParams = createContext<UpdateParams | null>(null);
type DraftGuard = {
  register: (key: symbol, dirty: boolean) => () => void;
  confirm: () => boolean;
};
const WorkspaceDrafts = createContext<DraftGuard | null>(null);
let activeHistoryGuard: {
  index: number | undefined;
  confirm: () => boolean;
} | null = null;
let historyGuardInstalled = false;
/** Install before BrowserRouter subscribes so declined POPs cannot unmount drafts. */
export function installWorkspaceHistoryGuard() {
  if (historyGuardInstalled) return;
  historyGuardInstalled = true;
  let restoring = false;
  window.addEventListener(
    "popstate",
    (event) => {
      if (restoring) {
        restoring = false;
        event.stopImmediatePropagation();
        return;
      }
      const target = window.history.state?.idx,
        current = activeHistoryGuard;
      if (
        current &&
        typeof target === "number" &&
        typeof current.index === "number" &&
        target !== current.index &&
        !current.confirm()
      ) {
        event.stopImmediatePropagation();
        restoring = true;
        window.history.go(current.index - target);
      }
    },
    true,
  );
}
/** Queue same-event filter/page changes together instead of losing URL fields. */
export function WorkspaceLocationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const location = useLocation(),
    [, setParams] = useSearchParams();
  const pending = useRef({
    key: location.key,
    params: new URLSearchParams(location.search),
  });
  const dirty = useRef(new Set<symbol>());
  const guards = useMemo<DraftGuard>(
    () => ({
      register: (key, value) => {
        if (value) dirty.current.add(key);
        else dirty.current.delete(key);
        return () => {
          dirty.current.delete(key);
        };
      },
      confirm: () =>
        dirty.current.size === 0 ||
        window.confirm("Leave without saving your changes?"),
    }),
    [],
  );
  useLayoutEffect(() => {
    const current = {
      index: window.history.state?.idx,
      confirm: guards.confirm,
    };
    activeHistoryGuard = current;
    return () => {
      if (activeHistoryGuard === current) activeHistoryGuard = null;
    };
  }, [location.key, guards]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current.size) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!link || link.target === "_blank") return;
      const target = new URL(link.href, window.location.href);
      if (
        target.origin === window.location.origin &&
        (target.pathname !== window.location.pathname ||
          target.search !== window.location.search) &&
        !guards.confirm()
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", click, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", click, true);
    };
  }, [guards]);
  if (pending.current.key !== location.key)
    pending.current = {
      key: location.key,
      params: new URLSearchParams(location.search),
    };
  const update: UpdateParams = (change, replace = false) => {
    const next = change(new URLSearchParams(pending.current.params));
    pending.current.params = next;
    setParams(next, { replace });
  };
  return createElement(
    WorkspaceDrafts.Provider,
    { value: guards },
    createElement(WorkspaceParams.Provider, { value: update }, children),
  );
}

export function useUnsavedWorkspaceChanges(dirty: boolean) {
  const guards = useContext(WorkspaceDrafts),
    key = useRef(Symbol("draft"));
  useEffect(() => guards?.register(key.current, dirty), [guards, dirty]);
  return () => !dirty || window.confirm("Discard these unsaved changes?");
}

export function useUrlValue(key: string, fallback = "") {
  const [params, setParams] = useSearchParams();
  const update = useContext(WorkspaceParams);
  const value = params.get(key) ?? fallback;
  const set = useCallback(
    (next: string | ((previous: string) => string), replace = false) => {
      const apply = (previous: URLSearchParams) => {
        const copy = new URLSearchParams(previous);
        const text =
          typeof next === "function"
            ? next(previous.get(key) ?? fallback)
            : next;
        if (!text || text === fallback) copy.delete(key);
        else copy.set(key, text);
        if (
          key !== "page" &&
          ["q", "status", "sort", "student", "pageSize"].includes(key)
        )
          copy.delete("page");
        return copy;
      };
      if (update) update(apply, replace);
      else setParams(apply, { replace });
    },
    [fallback, key, setParams, update],
  );
  return [value, set] as const;
}

export function useWorkspaceNavigation(fallback = "/coach/students") {
  const location = useLocation(),
    navigate = useNavigate();
  const guards = useContext(WorkspaceDrafts);
  const returnState = () => ({
    returnTo: location.pathname + location.search,
    returnKey: location.key,
    returnScroll: window.scrollY,
    returnState: location.state,
  });
  const open = (to: string) => {
    if (guards && !guards.confirm()) return false;
    navigate(to, { state: returnState() });
    return true;
  };
  const back = () => {
    if (guards && !guards.confirm()) return;
    const state = location.state as {
      returnTo?: unknown;
      returnState?: Record<string, unknown>;
      returnScroll?: number;
    } | null;
    navigate(safeReturnPath(state?.returnTo, fallback), {
      replace: true,
      state: { ...state?.returnState, restoredScroll: state?.returnScroll },
    });
  };
  return { open, back, returnState };
}

export function useUrlNumber(key: string, fallback: number, maximum = 10000) {
  const [raw, setRaw] = useUrlValue(key, String(fallback));
  const value = Math.max(
    1,
    Math.min(
      maximum,
      Number.isSafeInteger(Number(raw)) ? Number(raw) : fallback,
    ),
  );
  const set = (next: number | ((previous: number) => number)) =>
    setRaw(String(typeof next === "function" ? next(value) : next));
  return [value, set] as const;
}

export function useUrlChoice<T extends string>(
  key: string,
  choices: readonly T[],
  fallback: T,
) {
  const [raw, set] = useUrlValue(key, fallback);
  return [
    choices.includes(raw as T) ? (raw as T) : fallback,
    (next: T) => set(next),
  ] as const;
}

const scrollPositions = new Map<string, number>();
export function WorkspaceScrollRestoration() {
  const location = useLocation();
  useLayoutEffect(() => {
    const key = location.key;
    const restored = (location.state as { restoredScroll?: unknown } | null)
      ?.restoredScroll;
    window.scrollTo?.(
      0,
      typeof restored === "number" && Number.isFinite(restored)
        ? Math.max(0, restored)
        : (scrollPositions.get(key) ?? 0),
    );
    return () => {
      scrollPositions.set(key, window.scrollY);
      if (scrollPositions.size > 100)
        scrollPositions.delete(scrollPositions.keys().next().value!);
    };
  }, [location.key, location.state]);
  return null;
}
