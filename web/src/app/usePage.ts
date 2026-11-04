import { useEffect, useRef, useState } from "react";
import type { PageComponent, PageLoaders } from "./pages";

export type PageState =
  | { status: "loading" }
  | { status: "ready"; Component: PageComponent }
  | { status: "missing" }
  | { status: "failed"; error: unknown };

/** Loads a page once and remembers it. A failed load (for example a stale chunk after a deploy) can be retried. */
export function usePage(name: string, loaders: PageLoaders, attempt = 0): PageState {
  const cache = useRef(new Map<string, PageComponent | "missing">());
  const [, bump] = useState(0);
  const [failure, setFailure] = useState<{ name: string; attempt: number; error: unknown } | null>(null);

  const cached = cache.current.get(name);
  useEffect(() => {
    if (cache.current.has(name)) return;
    const load = loaders[name];
    if (!load) {
      cache.current.set(name, "missing");
      bump((n) => n + 1);
      return;
    }
    let live = true;
    load().then(
      (mod) => {
        const Component = (mod as { default?: PageComponent }).default;
        if (!live) return;
        if (typeof Component !== "function") {
          setFailure({ name, attempt, error: new Error(`Page ${name} has no default export`) });
          return;
        }
        cache.current.set(name, Component);
        bump((n) => n + 1);
      },
      (error) => live && setFailure({ name, attempt, error }),
    );
    return () => {
      live = false;
    };
  }, [name, loaders, attempt]);

  if (cached === "missing") return { status: "missing" };
  if (cached) return { status: "ready", Component: cached };
  if (failure && failure.name === name && failure.attempt === attempt) return { status: "failed", error: failure.error };
  return { status: "loading" };
}
