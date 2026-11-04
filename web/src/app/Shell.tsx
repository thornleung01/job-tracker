import { Settings } from "lucide-react";
import type { RefObject } from "react";
import type { JobTrackerDB } from "../db/schema";
import { reviewCount } from "../sync/queries";
import { ROUTES } from "./pageProps";
import type { PageName } from "./router";
import { useQuery } from "./useQuery";

export const PAGE_TITLES: Record<PageName, string> = {
  applications: "Applications",
  detail: "Application",
  people: "People",
  flow: "Flow",
  review: "Needs review",
  settings: "Settings",
};

const hrefFor = (path: string) => "#" + path;

/** The nav entry that is current for a page. An application's own page belongs to Applications. */
export function currentNav(page: PageName): PageName {
  return page === "detail" ? "applications" : page;
}

function ReviewCount({ db }: { db: JobTrackerDB }) {
  const n = useQuery(() => reviewCount(db), [db]);
  if (!n) return null;
  return (
    <span className="count" aria-label={`${n} to review`}>
      {n}
    </span>
  );
}

export function Header({ db, page }: { db: JobTrackerDB; page: PageName }) {
  const current = currentNav(page);
  const settings = ROUTES.find((r) => r.page === "settings")!;
  return (
    <header className="top">
      <div className="brand">Job Tracker</div>
      <nav aria-label="Main">
        {ROUTES.filter((r) => r.nav).map((r) => (
          <a key={r.page} href={hrefFor(r.path)} aria-current={current === r.page ? "page" : undefined}>
            {r.nav}
            {r.page === "review" && <ReviewCount db={db} />}
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
