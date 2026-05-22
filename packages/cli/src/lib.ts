export type {
	APIAppConfig,
	ExtractedString,
	LimitErrorResponse,
	LocaleInfo,
	LocalesMap,
	SyncPolicyConfig,
	SyncPolicyErrorResponse,
	TranslationBatchResponse,
	TranslationSnapshotResponse,
	TranslationStatusResponse,
} from "./types.js";
export type {
	DetectedEcosystem,
	DetectedFramework,
	LocalDetectionResult,
	PackageManager,
} from "./utils/detect-local.js";
export {
	buildInstallCommand,
	detectLocalEcosystem,
	getPackagesToInstall,
} from "./utils/detect-local.js";
export { StringExtractor } from "./utils/extract.js";
export { VocoderAPI, VocoderAPIError, computeSourceEntriesHash } from "./utils/api.js";
export type { SourceEntriesHashInput } from "./utils/api.js";
export { buildStringEntries } from "./utils/string-entries.js";
export { extractProjectShortIdFromApiKey } from "@vocoder/core";
export type { TranslationStringEntry } from "./types.js";
export { readAuthData, writeAuthData, clearAuthData, verifyStoredAuth } from "./utils/auth-store.js";
export { detectBranch } from "./utils/branch.js";
export { detectCommitSha, detectRepoIdentity } from "./utils/git-identity.js";
export type { GitRepositoryIdentity } from "./utils/git-identity.js";
export type { AuthData, StoredAuthStatus } from "./utils/auth-store.js";
export { detectAppDir, loadVocoderConfig } from "@vocoder/extractor";
export type { VocoderConfig } from "@vocoder/extractor";
export { defineConfig } from "@vocoder/config";
export type { SetupSnippets } from "./utils/setup-snippets.js";
export { getSetupSnippets } from "./utils/setup-snippets.js";
