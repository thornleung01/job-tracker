import type { PageProps } from "../../app/pageProps";
import type { DocumentsDeps } from "../../components/documents/deps";
import { Picker } from "./Picker";
import { Workspace } from "./Workspace";
import "./tailor.css";

/** `#/tailor` is the list of applications to choose from, `#/tailor/:id` the workspace for one. `?baseline=<id>` pre-selects a resume version. */
export default function TailorPage({ db, params, query, navigate, deps }: PageProps & { deps?: Partial<DocumentsDeps> }) {
  const baseline = Number(query.get("baseline")) || null;
  if (params.id === undefined) return <Picker db={db} baseline={baseline} navigate={navigate} />;
  // Keyed by the application, so nothing typed or drafted for one carries over to the next.
  return <Workspace key={params.id} db={db} appId={Number(params.id)} baseline={baseline} navigate={navigate} deps={deps} />;
}
