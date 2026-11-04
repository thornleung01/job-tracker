import type { PageUser } from "./localUser";
import type { JobTrackerDB } from "../db/schema";

/** What every page component receives. Pages never touch auth or providers directly. */
export interface PageProps {
  /** The signed-in user's own database (opened with dbNameFor(user)), or the one local database in a local build. */
  db: JobTrackerDB;
  /** The signed-in person, or the local stand-in (check with isLocalUser) in a build with no client IDs. */
  user: PageUser;
  /** Route params, e.g. { id: "12" } for #/app/12. */
  params: Record<string, string>;
  /** Query string of the hash route, e.g. #/?stage=Applied&q=acme. */
  query: URLSearchParams;
  /** Go to a hash route, e.g. navigate("/app/12") or navigate("/?stage=Applied"). Use replace to avoid a history entry. */
  navigate(to: string, opts?: { replace?: boolean }): void;
}

/** Routes. Each page lives in web/src/pages/<name>/index.tsx and default-exports a component taking PageProps. */
export const ROUTES = [
  { path: "/", page: "applications", nav: "Applications" },
  { path: "/app/:id", page: "detail", nav: null },
  { path: "/people", page: "people", nav: "People" },
  { path: "/flow", page: "flow", nav: "Flow" },
  { path: "/review", page: "review", nav: "Needs review" },
  { path: "/settings", page: "settings", nav: null },
] as const;
