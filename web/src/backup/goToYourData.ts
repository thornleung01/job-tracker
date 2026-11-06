import { navigate } from "../app/router";

const LOOK_EVERY_MS = 50;
const GIVE_UP_AFTER_MS = 3000;

/** Opens Settings and brings the "Your data" card into view with focus on its heading, as the section links on that page do. */
export function goToYourData(): void {
  navigate("/settings");
  const started = Date.now();
  const look = () => {
    if (!window.location.hash.startsWith("#/settings")) return;
    const card = document.getElementById("data");
    if (card) {
      const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth" });
      card.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    } else if (Date.now() - started < GIVE_UP_AFTER_MS) setTimeout(look, LOOK_EVERY_MS);
  };
  look();
}
