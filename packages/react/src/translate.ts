import { applyOrdinalForms, formatICU, generateMessageHash } from "@vocoder/core";
import type { LocalesMap, TOptions } from "./types";

/**
 * Global translation state
 * This is synced by VocoderProvider and can be used anywhere
 */
let globalTranslations: Record<string, Record<string, string>> = {};
let globalLocale: string = "en";
let globalSourceLocale: string = "";
let globalLocales: LocalesMap = {};

/**
 * Set global translations (called by VocoderProvider)
 * @internal
 */
export function _setGlobalTranslations(
	translations: Record<string, Record<string, string>>,
): void {
	globalTranslations = translations;
}

/**
 * Set global locale (called by VocoderProvider)
 * @internal
 */
export function _setGlobalLocale(locale: string): void {
	globalLocale = locale;
}

/**
 * Set source locale (called by VocoderProvider on mount)
 * @internal
 */
export function _setSourceLocale(locale: string): void {
	globalSourceLocale = locale;
}

/**
 * Set global locales map (called by VocoderProvider)
 * @internal
 */
export function _setGlobalLocales(locales: LocalesMap): void {
	globalLocales = locales;
}

/**
 * Format a number as a locale-aware ordinal outside React components.
 * Uses ordinalForms from the manifest config. Falls back to String(value) when data is unavailable.
 *
 * @example
 * ```tsx
 * import { ordinal } from '@vocoder/react';
 * const label = ordinal(1); // "1st" in en, "1.º" in es, "第1" in ja
 * ```
 */
export function ordinal(value: number, gender?: string): string {
	const forms = globalLocales[globalLocale]?.ordinalForms;
	if (!forms) return String(value);
	return applyOrdinalForms(value, globalLocale, forms, gender) ?? String(value);
}

/**
 * Translate text using global translations
 * Can be used outside React components (utilities, services, etc.)
 *
 * Supports:
 * - Simple variable interpolation: `t('Hello {name}', { name: 'John' })`
 * - ICU MessageFormat: `t('{count, plural, one {# item} other {# items}}', { count: 5 })`
 *
 * @param text - Source text to translate
 * @param values - Optional values for variable interpolation
 * @returns Translated text with interpolated variables
 *
 * @example Simple variables
 * ```tsx
 * import { t } from '@vocoder/react';
 *
 * const message = t('Hello, world!');
 * const greeting = t('Hello, {name}!', { name: 'John' });
 * ```
 *
 * @example ICU MessageFormat (pluralization)
 * ```tsx
 * const items = t('{count, plural, =0 {No items} one {# item} other {# items}}', { count: 5 });
 * // "5 items"
 *
 * const items = t('{count, plural, =0 {No items} one {# item} other {# items}}', { count: 1 });
 * // "1 item"
 * ```
 *
 * @remarks
 * - This function uses global state synced by VocoderProvider
 * - Make sure VocoderProvider is mounted before using this function
 * - For reactive translations in components, use the `<T>` component or `useVocoder()` hook
 * - Rich text with components is only supported in `<T>` component, not in `t()` function
 */
export function t(text: string, values?: Record<string, any>, options?: TOptions): string {
	const { context, id, formality } = options ?? {};
	const hash = id
		? id
		: generateMessageHash(text, context, formality);
	const localeTranslations = globalTranslations[globalLocale];
	const hasTranslation =
		!!localeTranslations && Object.prototype.hasOwnProperty.call(localeTranslations, hash);

	if (!hasTranslation) {
		if (
			process.env.NODE_ENV === "development" &&
			globalSourceLocale &&
			globalLocale !== globalSourceLocale
		) {
			console.warn(
				`[vocoder] Missing translation for locale "${globalLocale}": "${text.length > 60 ? `${text.slice(0, 60)}…` : text}"`,
			);
		}
		return text;
	}

	const translated = localeTranslations![hash];

	if (values && Object.keys(values).length > 0) {
		// Use IntlMessageFormat for all cases (simple interpolation, ICU, etc.)
		return formatICU(translated, values, globalLocale);
	}

	return translated;
}
