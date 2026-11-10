// Tests run as the demo build (no OAuth client IDs). A test about what a hosted build shows pretends an ID is set, then puts it back.
import { config } from "../../src/config";

export function hostedBuild(): () => void {
  const was = config.googleClientId;
  config.googleClientId = "test-client-id";
  return () => {
    config.googleClientId = was;
  };
}
