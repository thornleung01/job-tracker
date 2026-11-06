import { Settings } from "lucide-react";
import type { RefObject } from "react";
import type { JobTrackerDB } from "../db/schema";
import { reviewCount } from "../sync/queries";
import { ROUTES } from "./routes";
import type { PageName } from "./router";
import { useQuery } from "./useQuery";

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

/** The nav entry that is current for a page. An application's own page belongs to Applications. */
export function currentNav(page: PageName): PageName {
  return page === "detail" ? "applications" : page;
}

function ReviewCount({ db }: { db: JobTrackerDB }) {
  const n = useQuery(() => reviewCount(db), [db]);
  if (!n) return null;
  return (
    <>
      <span className="count" aria-hidden="true">{n}</span>
      {/* aria-label on a plain span is not read by most screen readers, so the count has real text beside it. */}
      <span className="sr">, {n} {n === 1 ? "email" : "emails"}</span>
    </>
  );
}

/** "Needs review" in full, and "Review" on a phone so five links fit one row. The short one is hidden from screen readers and the long one is only clipped on a phone, so the link's name stays "Needs review". */
function ReviewLabel({ text }: { text: string }) {
  return (
    <>
      <span className="nav-full">{text}</span>
      <span className="nav-short" aria-hidden="true">Review</span>
    </>
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
            {r.page === "review" ? <ReviewLabel text={r.nav!} /> : r.nav}
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
