// The AI side of the app: the person's own Anthropic key (locked on the device), the API call, and the errors. No React here.
import { callClaude } from "./client";
import type { AiDeps } from "./deps";
import { realVault } from "./vault";

export * from "./deps";
export * from "./errors";
export { callClaude, realVault };
export { lockAllVaults } from "./vault";
export { TAILOR_TONES, convertRequest, tailorRequest } from "./prompts";
export type { TailorInput, TailorTone } from "./prompts";
export { isSummarySection, masterText, readMaster } from "./master";
export type { MasterJob, MasterLine, TailorMaster } from "./master";
export { buildSections, checkAgainstSource, checkTailored, parseConvertReply, parseTailorReply } from "./verify";
export type { CheckedLine, CheckedTailor, ConvertFlag, TailorReply } from "./verify";
export { extractJobRequest, parseExtractReply, verifyExtract } from "./extractJob";
export type { ExtractedJob } from "./extractJob";

/** The real vault and the real API call. Pages and use cases take `deps?: Partial<AiDeps>` and fall back to this, so tests pass fakes. */
export const realAiDeps: AiDeps = { vault: realVault, complete: callClaude };
