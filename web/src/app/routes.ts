// The route table: the one source of truth for URLs, page names and the main navigation. router.ts matches against it and Shell.tsx draws the nav from it.

/** Routes. Each page lives in web/src/pages/<name>/index.tsx and default-exports a component taking PageProps. */
export const ROUTES = [
  { path: "/", page: "applications", nav: "Applications" },
  { path: "/app/:id", page: "detail", nav: null },
  { path: "/people", page: "people", nav: "People" },
  { path: "/resume", page: "resume", nav: "Resume" },
  { path: "/resume/print/:id", page: "resume", nav: null },
  { path: "/statistics", page: "statistics", nav: "Statistics" },
  { path: "/review", page: "review", nav: null },
  { path: "/settings", page: "settings", nav: null },
  { path: "/settings/:section", page: "settings", nav: null },
  { path: "/setup", page: "setup", nav: null },
] as const;
