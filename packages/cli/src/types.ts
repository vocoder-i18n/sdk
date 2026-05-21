export interface LocaleInfo {
	nativeName: string;
	dir?: "rtl";
}

export type LocalesMap = Record<string, LocaleInfo>;

export interface CleanOptions {
	/** Single app directory to process (e.g. "apps/web"). Overrides vocoder.config.ts apps[]. */
	appDir?: string;
	/** Skip the confirmation prompt and delete without asking. */
	yes?: boolean;
	/** Override Vocoder API URL. */
	apiUrl?: string;
}

export interface PullOptions {
	/**
	 * Comma-separated app directories for monorepos (e.g. "apps/web,apps/admin").
	 * When omitted, defaults to single-app root ("").
	 */
	appDirs?: string;
	/** Write locale files to this root instead of the git root. */
	output?: string;
	/** Override Vocoder API URL. */
	apiUrl?: string;
	/** Branch to pull translations for. Auto-detected from git when omitted. */
	branch?: string;
}

export interface LocaleFilesResponse {
	status: "FOUND" | "NOT_FOUND";
	branch: string;
	apps: Array<{
		appDir: string;
		localeFileTree?: Record<string, string>;
	}>;
}

export interface TranslateCommandOptions {
	branch?: string;
	commitSha?: string;
	dryRun?: boolean;
	verbose?: boolean;
	apiUrl?: string;
	/** Single app directory to process (e.g. "apps/web"). Overrides vocoder.config.ts apps[]. */
	appDir?: string;
}

/** Per-app string submission for POST /api/translate */
export interface BatchTranslateAppEntry {
	appDir: string;
	strings: Array<{
		key: string;
		text: string;
		context?: string;
		formality?: string;
		uiRole?: string;
	}>;
	sourceEntriesHash?: string;
	commitMode?: "PR" | "COMMIT";
}

export interface BatchTranslateRequestBody {
	apps: BatchTranslateAppEntry[];
	branch: string;
	commitSha?: string;
	/** Git remote URL or canonical (e.g. "github:owner/repo") */
	repoUrl: string;
	clientRunId?: string;
	/** Branches parsed from the workflow YAML — server reconciles project.targetBranches when present. */
	targetBranches?: string[];
}

/** @deprecated Use BatchTranslateRequestBody for POST /api/translate */
export interface TranslateRequestBody {
	branch: string;
	commitSha?: string;
	stringEntries: Array<{
		key: string;
		text: string;
		context?: string;
		formality?: string;
		uiRole?: string;
	}>;
	targetLocales: string[];
	sourceEntriesHash: string;
	repoCanonical?: string;
	repoAppDir?: string;
	clientRunId?: string;
}

export interface AppTranslateStatus {
	appDir: string;
	appId: string;
	status: "pending" | "running" | "complete" | "failed";
	providers: Record<string, { status: string; completed: number; total: number }>;
	progress: { completed: number; total: number };
	fingerprint?: string;
	error?: string;
	localeFileTree?: Record<string, string>;
	commitConfig?: {
		commitMode: string;
		autoMergePRs: boolean;
		skipCiOnDirectCommit: boolean;
	};
}

export interface BatchTranslateStatusResponse {
	jobId: string;
	status: "pending" | "running" | "complete" | "failed";
	apps: AppTranslateStatus[];
}

/** @deprecated Use BatchTranslateStatusResponse for GET /api/translate/:jobId/status */
export interface TranslateStatusResponse {
	status: "pending" | "running" | "complete" | "failed";
	progress: { completed: number; total: number };
	locales: Record<string, "pending" | "running" | "complete" | "failed">;
	fingerprint?: string;
	error?: string;
}

export type EffectiveSyncMode = "required" | "best-effort";

export interface SyncPolicyConfig {
	blockingBranches: string[];
	blockingMode: EffectiveSyncMode;
	nonBlockingMode: EffectiveSyncMode;
	defaultMaxWaitMs: number;
}

export interface AccountAuthOptions {
	apiUrl?: string;
	yes?: boolean;
	ci?: boolean;
	verbose?: boolean;
}

export interface InitOptions extends AccountAuthOptions {
	appName?: string;
	sourceLocale?: string;
	targetLocales?: string;
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

export type { ExtractedString } from "@vocoder/extractor";

export interface TranslationStringEntry {
	key: string;
	/** Source text. null for id-only entries (<T id="key" /> with no message). */
	text: string | null;
	context?: string;
	formality?: "formal" | "informal" | "auto";
	uiRole?: string;
}

export interface TranslationBatchResponse {
	batchId: string;
	newSourceEntries: number;
	deletedSourceEntries?: number;
	totalSourceEntries: number;
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
