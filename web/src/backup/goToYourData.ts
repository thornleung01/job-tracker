import { navigate } from "../app/router";

const LOOK_EVERY_MS = 50;
const GIVE_UP_AFTER_MS = 3000;

/** Opens Settings, Data and brings the "Back up" card into view with focus on its heading. */
export function goToYourData(): void {
  navigate("/settings/data");
  const started = Date.now();
  const look = () => {
    if (!window.location.hash.startsWith("#/settings/data")) return;
    const card = document.getElementById("data");
    if (card) {
      const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth" });
      card.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    } else if (Date.now() - started < GIVE_UP_AFTER_MS) setTimeout(look, LOOK_EVERY_MS);
  };
  look();
}
