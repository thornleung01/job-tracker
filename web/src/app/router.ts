// Hash router. The route table is ROUTES in routes.ts; this file only matches and parses.
// It never writes the hash by itself: only navigate() does, and only when a person asks for it.
import { ROUTES } from "./routes";

export type Route = (typeof ROUTES)[number];
export type PageName = Route["page"];

export interface RouteMatch {
  route: Route;
  page: PageName;
  /** The normalised path that was asked for, e.g. /app/12 */
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  /** false when nothing in ROUTES matched and the Applications page is shown instead */
  known: boolean;
  /** the hash is an OAuth response (#code=..., #error=...), not a route */
  authResponse: boolean;
}

/**
 * True for the fragment an OAuth redirect leaves behind, e.g. "#code=abc&state=xyz".
 * Real routes always start with "#/", so they are never mistaken for it.
 */
export function isAuthResponseHash(hash: string): boolean {
  return !hash.startsWith("#/") && /[#&](code|error|state)=/.test(hash);
}

function safeDecode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** Addresses that moved. The Flow page is now Statistics, and old bookmarks to #/flow still land there. */
const MOVED: Readonly<Record<string, string>> = { "/flow": "/statistics" };

function normalise(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return "/" + parts.join("/");
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split("/").filter(Boolean);
  const have = path.split("/").filter(Boolean);
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(":")) {
      const value = safeDecode(have[i]);
      if (!value) return null;
      params[want[i].slice(1)] = value;
    } else if (want[i] !== have[i]) {
      return null;
    }
  }
  return params;
}

export function matchRoute(hash: string, routes: readonly Route[] = ROUTES): RouteMatch {
  const fallback = routes[0];
  if (isAuthResponseHash(hash)) {
    return { route: fallback, page: fallback.page, path: "/", params: {}, query: new URLSearchParams(), known: true, authResponse: true };
  }
  const raw = hash.replace(/^#/, "");
  const q = raw.indexOf("?");
  const pathPart = q < 0 ? raw : raw.slice(0, q);
  const query = new URLSearchParams(q < 0 ? "" : raw.slice(q + 1));
  const asked = normalise(pathPart);
  const path = MOVED[asked] ?? asked;
  for (const route of routes) {
    const params = matchPattern(route.path, path);
    if (params) return { route, page: route.page, path, params, query, known: true, authResponse: false };
  }
  return { route: fallback, page: fallback.page, path, params: {}, query, known: false, authResponse: false };
}

/** The new address for a hash that points at a page that moved (query kept), or null when it didn't move. */
export function movedTo(hash: string): string | null {
  if (isAuthResponseHash(hash)) return null;
  const raw = hash.replace(/^#/, "");
  const q = raw.indexOf("?");
  const target = MOVED[normalise(q < 0 ? raw : raw.slice(0, q))];
  return target ? target + (q < 0 ? "" : raw.slice(q)) : null;
}

/** The hash string for a route like "/app/12" or "/?stage=Applied". */
export function toHash(to: string): string {
  return "#" + (to.startsWith("/") ? to : "/" + to);
}

export function navigate(to: string, opts: { replace?: boolean } = {}, win: Window = window): void {
  const hash = toHash(to);
  if (opts.replace) {
    // replaceState does not fire hashchange, so announce it ourselves.
    win.history.replaceState(null, "", win.location.pathname + win.location.search + hash);
    win.dispatchEvent(new HashChangeEvent("hashchange"));
  } else if (win.location.hash !== hash) {
    win.location.hash = hash;
  }
}
