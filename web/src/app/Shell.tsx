import { Settings } from "lucide-react";
import type { RefObject } from "react";
import { ROUTES } from "./routes";
import type { PageName } from "./router";

export const PAGE_TITLES: Record<PageName, string> = {
  applications: "Applications",
  detail: "Application",
  people: "People",
  resume: "Resume",
  statistics: "Statistics",
  review: "Needs review",
  settings: "Settings",
  setup: "Set up",
};

const hrefFor = (path: string) => "#" + path;

/** The nav entry that is current for a page. An application's own page and the review queue (reached from a banner there) belong to Applications. */
export function currentNav(page: PageName): PageName {
  return page === "detail" || page === "review" ? "applications" : page;
}

export function Header({ page }: { page: PageName }) {
  const current = currentNav(page);
  const settings = ROUTES.find((r) => r.page === "settings")!;
  return (
    <header className="top">
      <div className="brand">Job Tracker</div>
      <nav aria-label="Main">
        {ROUTES.filter((r) => r.nav).map((r) => (
          <a key={r.page} href={hrefFor(r.path)} aria-current={current === r.page ? "page" : undefined}>
            {r.nav}
          </a>
        ))}
        <a
          href={hrefFor(settings.path)}
          className="icon-link"
          aria-label="Settings"
          title="Settings"
          aria-current={current === "settings" ? "page" : undefined}
        >
          <Settings size={24} strokeWidth={2} aria-hidden="true" />
        </a>
      </nav>
    </header>
  );
}

/** The skip link cannot be a plain #main anchor: the hash belongs to the router. */
export function SkipLink({ target }: { target: RefObject<HTMLElement | null> }) {
  return (
    <a
      className="skip"
      href="#main"
      onClick={(e) => {
        e.preventDefault();
        target.current?.focus();
      }}
    >
      Skip to content
    </a>
  );
}
