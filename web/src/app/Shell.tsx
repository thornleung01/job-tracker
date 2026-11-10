import { Settings } from "lucide-react";
import type { MouseEvent, RefObject } from "react";
import { blockLeave } from "./leaveGuard";
import { ROUTES } from "./routes";
import type { PageName } from "./router";

export const PAGE_TITLES: Record<PageName, string> = {
  applications: "Applications",
  detail: "Application",
  people: "People",
  resume: "Resume",
  tailor: "Tailor",
  statistics: "Statistics",
  review: "Needs review",
  settings: "Settings",
  setup: "Site setup",
};

const hrefFor = (path: string) => "#" + path;

/** The nav entry that is current for a page. An application's own page and the review queue (reached from a banner there) belong to Applications, and Tailor (a task started from the Resume page) belongs to Resume. */
export function currentNav(page: PageName): PageName {
  if (page === "tailor") return "resume";
  return page === "detail" || page === "review" ? "applications" : page;
}

/** A plain click on a nav link asks the open page's leave guard first (unsaved work); a new-tab or modified click is left to the browser. */
const guarded = (path: string) => (e: MouseEvent<HTMLAnchorElement>) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (blockLeave(hrefFor(path))) e.preventDefault();
};

export function Header({ page }: { page: PageName }) {
  const current = currentNav(page);
  const settings = ROUTES.find((r) => r.page === "settings")!;
  return (
    <header className="top">
      <div className="brand">Job Tracker</div>
      <nav aria-label="Main">
        {ROUTES.filter((r) => r.nav).map((r) => (
          <a key={r.page} href={hrefFor(r.path)} onClick={guarded(r.path)} aria-current={current === r.page ? "page" : undefined}>
            {r.nav}
          </a>
        ))}
        <a
          href={hrefFor(settings.path)}
          onClick={guarded(settings.path)}
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
