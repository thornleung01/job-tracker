// Page loading. Each page is its own chunk: web/src/pages/<name>/index.tsx with a default export taking PageProps.
// import.meta.glob is one dynamic import per page file, and it tolerates a page that does not exist yet.
import type { ComponentType } from "react";
import type { PageProps } from "./pageProps";

export type PageComponent = ComponentType<PageProps>;
/** page name -> function that loads its module */
export type PageLoaders = Record<string, () => Promise<unknown>>;

const modules = import.meta.glob("../pages/*/index.tsx") as Record<string, () => Promise<unknown>>;

export const defaultLoaders: PageLoaders = Object.fromEntries(
  Object.entries(modules).map(([file, load]) => [file.split("/")[2], load]),
);
