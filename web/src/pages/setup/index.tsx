import SetupGuide from "./SetupGuide";

/** The #/setup route. The guide takes no props, so the signed-out screen can load it without a database or a user. */
export default function Setup() {
  return <SetupGuide />;
}
