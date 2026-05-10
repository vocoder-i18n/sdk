export interface LocaleInfo {
	nativeName: string;
	dir?: "rtl";
}

export type LocalesMap = Record<string, LocaleInfo>;

export interface TranslateOptions {
	branch?: string;
	force?: boolean;
	dryRun?: boolean;
	verbose?: boolean;
	include?: string[];
	exclude?: string[];
	mode?: RequestedSyncMode;
	maxWaitMs?: number;
	noFallback?: boolean;
}

export type EffectiveSyncMode = "required" | "best-effort";
export type RequestedSyncMode = "auto" | EffectiveSyncMode;

export interface SyncPolicyConfig {
	blockingBranches: string[];
	blockingMode: EffectiveSyncMode;
	nonBlockingMode: EffectiveSyncMode;
	defaultMaxWaitMs: number;
}

export interface InitOptions {
	apiUrl?: string;
	yes?: boolean;
	ci?: boolean;
	appName?: string;
	sourceLocale?: string;
	targetLocales?: string;
}

export interface RepoIdentityPayload {
	repoCanonical?: string;
	repoAppDir?: string;
	commitSha?: string;
}

// Local configuration (from env vars)
export interface LocalConfig {
	apiKey: string;
	apiUrl: string;
}

export interface APIAppConfig {
	projectName: string;
	organizationName: string;
	sourceLocale: string;
	targetLocales: string[];
	targetBranches: string[];
	primaryBranch?: string;
	syncPolicy: SyncPolicyConfig;
}

// Combined configuration used by CLI
export interface AppConfig extends LocalConfig, APIAppConfig {
	includePattern: string | string[];
	excludePattern?: string | string[];
	timeout: number;
	/** From vocoder.config.ts — synced to App on every push */
	industry?: string;
}

export type { ExtractedString } from "@vocoder/extractor";

export interface TranslationStringEntry {
	key: string;
	/** Source text. null for id-only entries (<T id="key" /> with no message). */
	text: string | null;
	context?: string;
	formality?: "formal" | "informal" | "neutral" | "auto";
	uiRole?: string;
}

export interface TranslationBatchResponse {
	batchId: string;
	newStrings: number;
	deletedStrings?: number;
	totalStrings: number;
	status: "PENDING" | "TRANSLATING" | "COMPLETED" | "FAILED" | "UP_TO_DATE";
	noChanges?: boolean;
	estimatedTime?: number;
	effectiveMode?: EffectiveSyncMode;
	queueStatus?: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
	snapshotAvailable?: boolean;
	latestCompletedBatchId?: string;
	translations?: Record<string, Record<string, string>>;
}

export interface TranslationStatusResponse {
	status: "PENDING" | "TRANSLATING" | "COMPLETED" | "FAILED";
	progress: number;
	jobs?: Array<{
		locale: string;
		status: string;
		progress: number;
	}>;
	translations?: Record<string, Record<string, string>>;
	localeMetadata?: LocalesMap;
	errorMessage?: string;
}

export interface TranslationSnapshotResponse {
	status: "FOUND" | "NOT_FOUND";
	branch: string;
	sourceLocale?: string;
	targetLocales?: string[];
	snapshotBatchId?: string;
	completedAt?: string | null;
	translations?: Record<string, Record<string, string>>;
	localeMetadata?: LocalesMap;
}

export interface LimitErrorResponse {
	errorCode: "LIMIT_EXCEEDED" | "INSUFFICIENT_CREDITS";
	limitType:
		| "organizations"
		| "projects"
		| "git_connections"
		| "members"
		| "providers"
		| "translation_chars"
		| "source_strings"
		| "target_locales"
		| "credits";
	planId: string;
	current: number;
	required: number;
	upgradeUrl: string;
	message: string;
}

export interface SyncPolicyErrorResponse {
	errorCode: "BRANCH_NOT_ALLOWED" | "PROJECT_REPOSITORY_MISMATCH";
	message: string;
	branch?: string;
	// targetBranches removed
	boundRepoLabel?: string | null;
	boundScopePath?: string | null;
}

export interface InitStartResponse {
	sessionId: string;
	deviceCode: string;
	verificationUrl: string;
	expiresAt: string;
	poll: {
		token: string;
		intervalSeconds: number;
	};
}

export type InitStatusResponse =
	| {
			status: "pending";
			pollIntervalSeconds: number;
			expiresAt: string;
			message?: string;
	  }
	| {
			status: "failed";
			message: string;
	  }
	| {
			status: "completed";
			credentials: {
				apiKey: string;
				apiUrl: string;
				organizationId: string;
				organizationName: string;
				projectId: string;
				projectName: string;
				sourceLocale: string;
				targetLocales: string[];
				targetBranches?: string[];
			};
	  };
