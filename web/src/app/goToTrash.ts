import { navigate } from "./router";

const LOOK_EVERY_MS = 50;
const GIVE_UP_AFTER_MS = 3000;

/** Opens Settings, Data and brings the Recently deleted card (id "trash") into view with focus on its heading. Same pattern as backup/goToYourData. */
export function goToTrash(): void {
  navigate("/settings/data");
  const started = Date.now();
  const look = () => {
    if (!window.location.hash.startsWith("#/settings/data")) return;
    const card = document.getElementById("trash");
    if (card) {
      const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      card.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth" });
      card.querySelector<HTMLElement>("h2, h3")?.focus({ preventScroll: true });
    } else if (Date.now() - started < GIVE_UP_AFTER_MS) setTimeout(look, LOOK_EVERY_MS);
  };
  look();
}
