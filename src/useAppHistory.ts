import { useCallback, useEffect, useRef, useState } from "react";

export type NavigationEntry =
  | { view: "rules"; year: number }
  | { view: "rule-edit"; year: number; id: number }
  | { view: "year-new"; year: number }
  | { view: "destination-new"; year: number }
  | { view: "destination-detail"; year: number; id: number }
  | { view: "data"; year: number }
  | { view: "income-edit"; year: number; id: number };

type AppHistoryState = {
  __aportesNavigation: 1;
  stack: NavigationEntry[];
};

const validViews = new Set<NavigationEntry["view"]>([
  "rules",
  "rule-edit",
  "year-new",
  "destination-new",
  "destination-detail",
  "data",
  "income-edit",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStack(value: unknown): NavigationEntry[] {
  if (
    !isRecord(value) ||
    value.__aportesNavigation !== 1 ||
    !Array.isArray(value.stack)
  )
    return [];

  return value.stack.filter((item): item is NavigationEntry => {
    if (
      !isRecord(item) ||
      typeof item.view !== "string" ||
      !validViews.has(item.view as NavigationEntry["view"]) ||
      !Number.isInteger(item.year)
    )
      return false;
    return item.view !== "rule-edit" &&
      item.view !== "destination-detail" &&
      item.view !== "income-edit"
      ? true
      : Number.isInteger(item.id);
  });
}

function stateWithStack(stack: NavigationEntry[]) {
  const current = isRecord(window.history.state) ? window.history.state : {};
  return {
    ...current,
    __aportesNavigation: 1,
    stack,
  } satisfies AppHistoryState;
}

function sameEntry(left: NavigationEntry | undefined, right: NavigationEntry) {
  return (
    left?.view === right.view &&
    left.year === right.year &&
    (!("id" in right) || ("id" in left && left.id === right.id))
  );
}

/** Keeps transient app screens in the browser/WebView history without changing the URL. */
export function useAppHistory() {
  const [stack, setStack] = useState<NavigationEntry[]>(() =>
    readStack(window.history.state),
  );
  const stackRef = useRef(stack);

  useEffect(() => {
    stackRef.current = stack;
  }, [stack]);

  useEffect(() => {
    const initialStack = readStack(window.history.state);
    window.history.replaceState(stateWithStack(initialStack), "");

    const handlePopState = (event: PopStateEvent) => {
      const nextStack = readStack(event.state);
      stackRef.current = nextStack;
      setStack(nextStack);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const push = useCallback((entry: NavigationEntry) => {
    const current = stackRef.current;
    if (sameEntry(current.at(-1), entry)) return;

    const nextStack = [...current, entry];
    stackRef.current = nextStack;
    window.history.pushState(stateWithStack(nextStack), "");
    setStack(nextStack);
  }, []);

  const close = useCallback((view?: NavigationEntry["view"]) => {
    const top = stackRef.current.at(-1);
    if (!top || (view && top.view !== view)) return;
    window.history.back();
  }, []);

  const clearCurrentEntry = useCallback(() => {
    stackRef.current = [];
    window.history.replaceState(stateWithStack([]), "");
    setStack([]);
  }, []);

  return { stack, push, close, clearCurrentEntry };
}
