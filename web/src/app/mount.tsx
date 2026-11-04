import { createRoot, type Root } from "react-dom/client";
import { isAuthPopupWindow } from "../auth";
import { App, type AppProps } from "./App";

/**
 * Starts the app. In the Microsoft sign-in popup (the app URL with #code=... in the hash) it renders nothing at all:
 * the router must not touch the hash while the opener is reading the response from it.
 */
export function mount(container: HTMLElement, props: AppProps = {}, popup: boolean = isAuthPopupWindow()): Root | null {
  if (popup) return null;
  const root = createRoot(container);
  root.render(<App {...props} />);
  return root;
}
