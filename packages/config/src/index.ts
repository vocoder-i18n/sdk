/**
 * Supported app industry classifications.
 * Set once in vocoder.config.ts; synced to App at extraction time.
 * Cannot be edited from the dashboard — config file is the source of truth.
 *
 * Keep in sync with APP_INDUSTRIES in
 * vocoder-app/lib/vocoder/translation/context-constants.ts.
 */
export type AppIndustry =
	| "ecommerce"
	| "saas"
	| "healthcare"
	| "fintech"
	| "gaming"
	| "education"
	| "media"
	| "productivity";

/**
 * Translation formality level.
 * Can be set project-wide in vocoder.config.ts or overridden per-string
 * via <T formality="formal"> (requires allowAiTranslations plan).
 */
export type Formality = "formal" | "informal" | "neutral";

export interface VocoderConfig {
	/**
	 * Unique identifier for this app. Written by `vocoder init` — do not edit manually.
	 * Used by the CLI to identify which app to update when syncing locales.
	 */
	appId?: string;
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
	 * If set, `vocoder sync` writes {locale}.json files to this path.
	 */
	localesPath?: string;
	/**
	 * The industry or domain of this application.
	 * Used to improve translation quality for domain-specific terminology
	 * and to isolate cache entries by industry in the global translation cache.
	 * Synced to App at extraction time.
	 */
	appIndustry?: AppIndustry;
	/**
	 * Project-wide default formality level for translations.
	 * Can be overridden per-string via <T formality="..."> on the AI plan.
	 * Synced to App at extraction time.
	 */
	formality?: Formality;
}

/** Type helper for vocoder.config.ts — provides autocomplete and type checking. */
export function defineConfig(config: VocoderConfig): VocoderConfig {
	return config;
}

/**
 * Canonical translation bundle format shared by the build plugin and CLI.
 * Both read and write this shape — keeps cache files identical regardless of
 * which tool produced them.
 *
 * translations: locale → sourceKey (hash) → translated text
 * config.locales: locale metadata snapshot for the runtime
 */
export interface VocoderTranslationData {
	config: {
		sourceLocale: string;
		targetLocales: string[];
		locales: Record<string, {
			nativeName: string;
			dir?: "rtl";
			currencyCode?: string;
			ordinalForms?: { type: "suffix"; suffixes: { zero?: string; one?: string; two?: string; few?: string; many?: string; other: string } } | { type: "word"; words: Record<string, Record<number, string>> };
		}>;
	};
	translations: Record<string, Record<string, string>>;
	updatedAt: string | null;
}
