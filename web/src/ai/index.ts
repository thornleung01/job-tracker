// The AI side of the app: the person's own Anthropic key (locked on the device), the API call, and the errors. No React here.
import { callClaude } from "./client";
import type { AiDeps } from "./deps";
import { realVault } from "./vault";

export * from "./deps";
export * from "./errors";
export { callClaude } from "./client";
export { realVault } from "./vault";

/** The real vault and the real API call. Pages and use cases take `deps?: Partial<AiDeps>` and fall back to this, so tests pass fakes. */
export const realAiDeps: AiDeps = { vault: realVault, complete: callClaude };
