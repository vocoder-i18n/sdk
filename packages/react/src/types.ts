import type React from "react";
import type { FormatMode, LocalesMap, TOptions } from "@vocoder/core";

// Re-export shared framework-agnostic types from @vocoder/core so consumers
// can import them from either @vocoder/react or @vocoder/core.
export type {
	FormatMode,
	LocaleInfo,
	LocalesMap,
	OrdinalForms,
	OrdinalSuffixes,
	TOptions,
	TranslationsMap,
	VocoderTranslationData,
} from "@vocoder/core";

/**
 * A slot in a rich-text message. Either a React element (children injected via cloneElement)
 * or a render function that receives the translated inner content as ReactNode.
 *
 * @example React element slot:
 *   <0>the docs</0> + <a href="/docs" /> → <a href="/docs">the docs</a>
 *
 * @example Function slot:
 *   <0>click here</0> + (children) => <strong>{children}</strong> → <strong>click here</strong>
 */
export type ComponentSlot =
	| React.ReactElement
	| ((children: React.ReactNode) => React.ReactNode);

export interface VocoderContextValue {
	availableLocales: string[];
	getDisplayName: (targetLocale: string, viewingLocale?: string) => string;
	/** True when initial translations are ready for render */
	isReady: boolean;
	locale: string;
	/** Text direction for the current locale. 'rtl' for Arabic, Hebrew, etc. 'ltr' for all others. */
	dir: "ltr" | "rtl";
	locales?: LocalesMap;
	setLocale: (locale: string) => Promise<void>;
	/**
	 * Reactive translate function. Reads from React context — safe to call in render,
	 * re-runs on locale change. Use inside components. Use global `t()` in callbacks/utilities.
	 */
	t: (text: string, values?: Record<string, unknown>, options?: TOptions) => string;
	hasTranslation: (text: string) => boolean;
	/** Format a number as a locale-aware ordinal (e.g. "1st" in en, "1.º" in es, "الأول" in ar). */
	ordinal: (value: number, gender?: string) => string;
}

export interface VocoderProviderServerProps {
	children: React.ReactNode;
}

export interface VocoderProviderProps {
	/** React children */
	children: React.ReactNode;
	/**
	 * Cookie string for server-side rendering (optional).
	 * Pass cookies from request headers to enable SSR locale detection.
	 * @example Next.js App Router: cookies().toString()
	 * @example Next.js Pages: context.req.headers.cookie
	 */
	cookies?: string;
	/**
	 * Automatically apply `dir` and `lang` attributes to `document.documentElement`
	 * when the locale changes. Enables RTL layout for Arabic, Hebrew, etc. via CSS
	 * frameworks that respond to `[dir="rtl"]` (Tailwind `rtl:` variants, etc.).
	 *
	 * On by default — set to false only if you manage document direction yourself.
	 * @default true
	 */
	applyDir?: boolean;
}

export interface TProps {
	/** Optional stable translation key. When provided, used as lookup key instead of message text. */
	id?: string;
	/** Source text / fallback content */
	children?: React.ReactNode;
	/**
	 * Message template for translation. Used as the translation lookup key.
	 * Supports ICU MessageFormat syntax and named component placeholders.
	 * @example Simple interpolation
	 * ```tsx
	 * <T message="Hello {name}!" values={{ name }} />
	 * ```
	 * @example Rich text
	 * ```tsx
	 * <T message="Click <link>here</link>" components={{ link: <a href="/help" /> }} />
	 * ```
	 */
	message?: string;
	/** Values for variable interpolation. The only supported way to pass interpolation variables. */
	values?: Record<string, unknown>;
	/**
	 * The value that drives plural/select/ordinal selection or locale formatting.
	 * - Plural mode (number): matched against Intl.PluralRules for the active locale
	 * - Select mode (string): matched against _case props
	 * - Format mode: the value to format (number for number/currency/percent, Date/number/string for date/time)
	 */
	value?: string | number | Date;
	/** Switch plural shorthand to ordinal mode ({count, selectordinal, ...}). Use with one/two/few/other props. */
	ordinal?: boolean;
	/**
	 * Grammatical gender for word-based ordinal locales (Arabic, Hebrew).
	 * Used with `ordinal` to select the correct gendered form from ordinalForms.words.
	 * Typical values: "masculine" | "feminine". Falls back to "masculine" when absent.
	 */
	gender?: string;
	/**
	 * Pure locale formatting — bypasses translation lookup, formats `value` directly with Intl.
	 * - number/integer/percent/compact/currency: formats value as Intl.NumberFormat
	 * - date/time/datetime: formats value as Intl.DateTimeFormat
	 */
	format?: FormatMode;
	/** ISO 4217 currency code (e.g. "USD", "EUR"). Required when format="currency". */
	currency?: string;
	/** Date display style. Used with format="date" or format="datetime". @default "medium" */
	dateStyle?: "full" | "long" | "medium" | "short";
	/** Time display style. Used with format="time" or format="datetime". @default "short" */
	timeStyle?: "full" | "long" | "medium" | "short";
	/** Optional context string for disambiguation (same text, different meaning) */
	context?: string;
	/** Optional formality level */
	formality?: "formal" | "informal" | "auto";
	/**
	 * Component slots for rich-text messages. Each slot maps to a numeric `<N>` placeholder
	 * by index. Accepts an array or a sparse object.
	 *
	 * A slot can be a React element (children injected via cloneElement) or a render
	 * function that receives the translated inner content as ReactNode.
	 *
	 * Injected automatically by @vocoder/plugin for natural JSX syntax.
	 * @example
	 * // Natural syntax (plugin injects components automatically):
	 * <T>Read <a href="/docs">the docs</a> for help.</T>
	 *
	 * // Explicit array form:
	 * <T message="Read <0>the docs</0> for help." components={[<a href="/docs" />]} />
	 *
	 * // Function slot (render prop):
	 * <T message="<0>Click here</0>" components={[(children) => <strong>{children}</strong>]} />
	 *
	 * // Sparse object form:
	 * <T message="<0>A</0> and <2>B</2>" components={{ 0: <em />, 2: <strong /> }} />
	 */
	components?: ComponentSlot[] | Record<number, ComponentSlot>;
	/**
	 * CLDR plural categories — triggers plural mode when present alongside `value`.
	 * Use # as placeholder for the formatted number.
	 */
	one?: string;
	two?: string;
	few?: string;
	many?: string;
	other?: string;
	/**
	 * Underscore-prefixed props for plural/select mode only:
	 * - _0, _1, _2 — exact numeric matches in plural mode (ICU =0, =1, =2)
	 * - _male, _female, _nonbinary, etc. — select cases (requires string value prop)
	 *
	 * All interpolation variables must go in the `values` prop.
	 */
	[key: `_${string}`]: string | undefined;
}

export interface LocaleSelectorProps {
	/** Position of the locale selector on the screen */
	position?:
		| "top-left"
		| "top-right"
		| "bottom-left"
		| "bottom-right"
		| "tl"
		| "tr"
		| "bl"
		| "br";
	/**
	 * Button and dropdown background color.
	 * Defaults to light-dark(#1a1a1a, #EFEAE3) — Vocoder brand, adapts automatically
	 * to the page color-scheme with no JS or flash.
	 */
	background?: string;
	/**
	 * Button and dropdown text/icon color.
	 * Defaults to light-dark(#EFEAE3, #1a1a1a) — Vocoder brand, adapts automatically.
	 */
	color?: string;
	/** Additional CSS class name */
	className?: string;
	/** Size of the logo icon in pixels */
	iconSize?: number;
	/**
	 * Locale metadata map (auto-generated by CLI).
	 * Structure: { [localeCode]: { nativeName, dir? } }
	 */
	locales?: LocalesMap;
	/**
	 * How to sort the locale dropdown items.
	 * - 'native': Sort by native names (e.g., "Deutsch", "Español") — consistent across all locales (default)
	 * - 'source': Sort by English names — consistent across all locales
	 * - 'translated': Sort by translated names in the current viewing locale — order changes per locale
	 * @default 'native'
	 */
	sortBy?: "source" | "native" | "translated";
}
