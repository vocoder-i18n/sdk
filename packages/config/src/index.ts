/**
 * Supported industry classifications for an app.
 * Set once in vocoder.config.ts; synced to App at extraction time.
 * Used as a TM pool bucket key — matching values across orgs share cache entries.
 * Cannot be edited from the dashboard — config file is the source of truth.
 */
export type Industry =
	| "ecommerce"
	| "b2b_saas"
	| "healthcare"
	| "fintech"
	| "gaming"
	| "education"
	| "media"
	| "productivity"
	| "travel"
	| "legal"
	| "government"
	| "nonprofit"
	| "other";

/**
 * Translation formality level.
 * Can be set project-wide in vocoder.config.ts or overridden per-string
 * via <T formality="formal"> (requires allowAiTranslations plan).
 */
export type Formality = "formal" | "informal" | "auto";

export interface VocoderConfig {
	/** Glob patterns for files to extract strings from. */
	include?: string[];
	/** Glob patterns to exclude. */
	exclude?: string[];
	/**
	 * Git branches that trigger string extraction and translation.
	 * Synced to the Vocoder dashboard on each push — change here to update.
	 */
	targetBranches?: string[];
	/**
	 * Directory to write translated locale files after sync (optional).
	 * If set, `vocoder translate` writes {locale}.json files to this path.
	 */
	localesDir?: string;
	/**
	 * The industry or domain of this application.
	 * Used to improve translation quality for domain-specific terminology
	 * and to isolate cache entries by industry in the global translation cache.
	 * Synced to App at extraction time.
	 */
	industry?: Industry;
	appIndustry?: Industry;
	/**
	 * Project-wide default formality level for translations.
	 * Can be overridden per-string via <T formality="..."> on the AI plan.
	 * Synced to App at extraction time.
	 */
	formality?: Formality;
	/**
	 * Controls how `vocoder translate` exits when translation fails.
	 * 'proceed' (default): exit 0, allow build to continue.
	 * 'fail': exit 1, halt the workflow before the build step.
	 * Not written by `vocoder init` — undocumented escape hatch only.
	 */
	onTranslationFailure?: "fail" | "proceed";
	/**
	 * Monorepo app directories. Each entry represents one app within the repo.
	 * When set, `vocoder translate` and `vocoder clean` operate on each app
	 * independently using per-app overrides merged over root-level defaults.
	 * Omit for single-app repos.
	 */
	apps?: AppConfig[];
}

/**
 * Per-app configuration for monorepos. Extends VocoderConfig so all fields
 * are overrideable per-app. `apps` (no nesting) and `onTranslationFailure`
 * (job-level only) are not overrideable at the app level.
 */
export interface AppConfig extends Omit<VocoderConfig, "apps" | "onTranslationFailure"> {
	/** Directory of this app relative to the repo root (e.g. 'apps/web'). */
	appDir: string;
}

/** Type helper for vocoder.config.ts — provides autocomplete and type checking. */
export function defineConfig(config: VocoderConfig): VocoderConfig {
	return config;
}

// Canonical translation bundle format — defined in @vocoder/core and re-exported here
// so consumers can import it from either package.
export type { VocoderTranslationData } from "@vocoder/core";
