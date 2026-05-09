export interface TranslationsMap {
	[locale: string]: {
		[key: string]: string;
	};
}

export interface OrdinalSuffixes {
	zero?: string;
	one?: string;
	two?: string;
	few?: string;
	many?: string;
	other: string;
}

/**
 * Discriminated union for locale ordinal data in the translation bundle.
 *
 * - `suffix`: Ordinals formed by number + suffix (e.g. "1st", "1er", "1.").
 *   The `#` placeholder is replaced with the rank at runtime.
 * - `word`: Ordinals are full words (Arabic, Hebrew). Gender-keyed maps from rank → word.
 *   Ranks not present in the map fall back to String(value).
 */
export type OrdinalForms =
	| { type: "suffix"; suffixes: OrdinalSuffixes }
	| { type: "word"; words: Record<string, Record<number, string>> };

export interface LocaleInfo {
	nativeName: string;
	dir?: "rtl";
	currencyCode?: string;
	ordinalForms?: OrdinalForms;
}

export interface LocalesMap {
	[localeCode: string]: LocaleInfo;
}

export type FormatMode =
	| "number"
	| "integer"
	| "percent"
	| "compact"
	| "currency"
	| "date"
	| "time"
	| "datetime";

export interface TOptions {
	/** Context string for disambiguation (same text, different meaning). */
	context?: string;
	/** Formality level for translation. */
	formality?: "formal" | "informal" | "auto";
	/** Stable translation key. When provided, used as lookup key instead of hashing the message text. */
	id?: string;
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
		locales: Record<string, LocaleInfo>;
	};
	translations: Record<string, Record<string, string>>;
	updatedAt: string | null;
}
