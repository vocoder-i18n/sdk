export interface LocaleInfo {
	nativeName: string;
	dir?: "rtl";
}

export type LocalesMap = Record<string, LocaleInfo>;

export interface PullOptions {
	/**
	 * Comma-separated app directories for monorepos (e.g. "apps/web,apps/admin").
	 * When omitted, the app directory is auto-detected from cwd relative to the git root.
	 * Mirrors the --app-dirs convention used by `vocoder translate`.
	 */
	appDirs?: string;
	/** Filter output to a single locale (e.g. "fr"). Returns all locales when omitted. */
	locale?: string;
	/** Write one <locale>.json per locale to this directory instead of printing to stdout. */
	output?: string;
	/** Override Vocoder API URL. */
	apiUrl?: string;
	/**
	 * Audit / snapshot mode. Reads from raw Translation rows by branch instead of
	 * the compiled TranslationBundle. Does NOT include TranslationOverride wins.
	 * Useful for auditing what was translated for a branch; not for inspecting
	 * the live runtime bundle.
	 */
	snapshot?: boolean;
	/** Branch for --snapshot mode. Auto-detected from git when omitted. */
	branch?: string;
}

export interface TranslateCommandOptions {
	branch?: string;
	commitSha?: string;
	dryRun?: boolean;
	verbose?: boolean;
	apiUrl?: string;
	/** Comma-separated app directories for monorepos. Empty/absent = single-app. */
	appDirs?: string;
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

export interface InitOptions {
	apiUrl?: string;
	yes?: boolean;
	ci?: boolean;
	appName?: string;
	sourceLocale?: string;
	targetLocales?: string;
	verbose?: boolean;
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

