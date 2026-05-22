import {
	applyOrdinalForms,
	formatICU,
} from "./icu";
import { generateMessageHash } from "./hash";
import { getBestMatchingLocale } from "./cookies";
import { manifestToLocalesMap } from "./manifest";
import type {
	LocaleManifest,
	LocalesMap,
	TOptions,
	TranslationsMap,
} from "./types";

export type LocaleLoader = (locale: string) => Promise<Record<string, string>>;

/**
 * Plain state snapshot passed to Svelte store subscribers.
 * New object on every change so reference-equality detection works.
 */
export interface VocoderState {
	locale: string;
	defaultLocale: string;
	locales: LocalesMap;
	availableLocales: string[];
}

/**
 * Framework-agnostic locale state container.
 *
 * Usage (any framework):
 *   1. `vocoder.load(manifest, loadLocale)` — register manifest + loader (sync, no I/O)
 *   2. `await vocoder.activate('en')` — fetch translations + set active locale
 *   3. Subscribe to changes via `onChange()` (React/Vue/Angular) or `subscribe()` (Svelte)
 *
 * For React, `VocoderProvider` wraps this automatically. For other frameworks,
 * subscribe manually and re-render on each `onChange` notification.
 */
export class VocoderCore {
	private _locale = "";
	private _defaultLocale = "";
	private _locales: LocalesMap = {};
	private _translations: TranslationsMap = {};
	private _loader: LocaleLoader | null = null;
	private _listeners = new Set<() => void>();

	get locale(): string {
		return this._locale;
	}

	get defaultLocale(): string {
		return this._defaultLocale;
	}

	get locales(): LocalesMap {
		return this._locales;
	}

	get translations(): TranslationsMap {
		return this._translations;
	}

	get availableLocales(): string[] {
		return Object.keys(this._locales);
	}

	/**
	 * Register a manifest and async locale loader. Synchronous — no I/O.
	 * Call once at app bootstrap before `activate()`.
	 */
	load(manifest: LocaleManifest, loader: LocaleLoader): void {
		this._loader = loader;
		this._locales = manifestToLocalesMap(manifest);
		this._defaultLocale = manifest.sourceLocale;
	}

	/**
	 * Set the active locale. Fetches translations via the registered loader if not
	 * already cached. Resolves the best matching locale from available locales before
	 * loading (e.g. "en-US" → "en" when only "en" is available).
	 */
	async activate(locale: string): Promise<void> {
		const available = Object.keys(this._locales);
		const best =
			available.length > 0
				? getBestMatchingLocale(locale, available, this._defaultLocale)
				: locale;

		if (!this._translations[best] && this._loader) {
			const loaded = await this._loader(best);
			// Merge into existing map without triggering a notify mid-load.
			this._translations = { ...this._translations, [best]: loaded };
		}

		this._locale = best;
		this._notify();
	}

	/**
	 * Pre-seed translations for a locale without activating it.
	 * Use for SSR: seed request-time translations before the first render,
	 * then call `activate()` to set the locale.
	 */
	seed(locale: string, translations: Record<string, string>): void {
		this._translations = { ...this._translations, [locale]: translations };
	}

	/**
	 * Translate `text` using the active locale. Reads current state at call time —
	 * this function is NOT reactive. For reactive translations in components, use
	 * the framework-specific binding (e.g. `useVocoder().t` in React).
	 */
	t(
		text: string,
		values?: Record<string, unknown>,
		options?: TOptions,
	): string {
		const hash = options?.id
			? options.id
			: generateMessageHash(text, options?.context, options?.formality);

		const translated = this._translations[this._locale]?.[hash] ?? text;

		if (values && Object.keys(values).length > 0) {
			return formatICU(translated, values, this._locale);
		}

		return translated;
	}

	/**
	 * Format `value` as a locale-aware ordinal (e.g. "1st", "2nd", "1er").
	 * Falls back to `String(value)` when ordinal data is unavailable.
	 */
	ordinal(value: number, gender?: string): string {
		const forms = this._locales[this._locale]?.ordinalForms;
		if (!forms) return String(value);
		return applyOrdinalForms(value, this._locale, forms, gender) ?? String(value);
	}

	/** True when a pre-computed translation hash exists for the active locale. */
	hasTranslation(key: string): boolean {
		const map = this._translations[this._locale];
		return !!map && Object.hasOwn(map, key);
	}

	/** Locale display name via `Intl.DisplayNames`. Falls back to the locale code. */
	getDisplayName(targetLocale: string, viewingLocale?: string): string {
		try {
			const dn = new Intl.DisplayNames([viewingLocale ?? this._locale], {
				type: "language",
			});
			return dn.of(targetLocale) ?? targetLocale;
		} catch {
			return targetLocale;
		}
	}

	/**
	 * Subscribe to locale changes. The callback fires after every `activate()` call.
	 * Returns an unsubscribe function — call it to stop receiving notifications.
	 *
	 * Suitable for React (`useReducer` force-render), Vue (`ref` updates), Angular
	 * (`BehaviorSubject.next`), or any imperative subscriber.
	 */
	onChange(fn: () => void): () => void {
		this._listeners.add(fn);
		return () => this._listeners.delete(fn);
	}

	/**
	 * Svelte readable store contract.
	 * Calls `fn` immediately with the current state snapshot, then on every change.
	 * Passes a new plain-object snapshot each time so Svelte's reference-equality
	 * change detection triggers a re-render.
	 *
	 * @example
	 * ```svelte
	 * <script>
	 * import { vocoder } from '@vocoder/core'
	 * // $vocoder.locale is reactive
	 * </script>
	 * <p>{$vocoder.locale}</p>
	 * <button onclick={() => vocoder.activate('es')}>Switch</button>
	 * ```
	 */
	subscribe(fn: (state: VocoderState) => void): () => void {
		fn(this._snapshot());
		return this.onChange(() => fn(this._snapshot()));
	}

	private _snapshot(): VocoderState {
		return {
			locale: this._locale,
			defaultLocale: this._defaultLocale,
			locales: this._locales,
			availableLocales: Object.keys(this._locales),
		};
	}

	// Spread into array before iterating — safe if a listener calls onChange() during notify.
	private _notify(): void {
		for (const fn of [...this._listeners]) fn();
	}

	/**
	 * @internal For testing only.
	 * Resets all state — locale, translations, manifest, listeners.
	 * Allows tests to start with a clean singleton without module re-import.
	 */
	_reset(): void {
		this._locale = "";
		this._defaultLocale = "";
		this._locales = {};
		this._translations = {};
		this._loader = null;
		this._listeners.clear();
	}
}

/** Create an isolated VocoderCore instance. Useful for tests and multi-instance scenarios. */
export function createVocoder(): VocoderCore {
	return new VocoderCore();
}

/**
 * Default module-level singleton.
 * Initialize once at app bootstrap:
 * ```ts
 * import { vocoder } from '@vocoder/core'
 * import manifest from './locales/manifest.json'
 * import { loadLocale } from './locales/loader.js'
 *
 * vocoder.load(manifest, loadLocale)
 * await vocoder.activate(manifest.sourceLocale)
 * ```
 */
export const vocoder = createVocoder();

/**
 * Translate text using the default singleton. Not reactive — reads current state
 * at call time. For reactive translations in components, use the framework binding.
 */
export const t = (
	text: string,
	values?: Record<string, unknown>,
	options?: TOptions,
): string => vocoder.t(text, values, options);

/**
 * Apply ordinal forms for the default singleton's active locale.
 * Not reactive — reads current state at call time.
 */
export const ordinal = (value: number, gender?: string): string =>
	vocoder.ordinal(value, gender);
