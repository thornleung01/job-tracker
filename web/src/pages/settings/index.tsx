import type { PageProps } from "../../app/pageProps";
import { SettingsView } from "./SettingsPage";
import "./settings.css";

export default function Settings(props: PageProps) {
  return <SettingsView {...props} />;
}
