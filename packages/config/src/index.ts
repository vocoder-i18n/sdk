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

/** @deprecated Use `Industry` */
export type AppIndustry = Industry;

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
	/** @deprecated Use `industry` */
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
}

/** Type helper for vocoder.config.ts — provides autocomplete and type checking. */
export function defineConfig(config: VocoderConfig): VocoderConfig {
	return config;
}

// Canonical translation bundle format — defined in @vocoder/core and re-exported here
// so consumers can import it from either package.
export type { VocoderTranslationData } from "@vocoder/core";
