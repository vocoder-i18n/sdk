import type {
	LocaleManifest,
	LocalesMap,
	TranslationsMap,
	VocoderContextValue,
	VocoderProviderProps,
} from "./types";
import {
	PREVIEW_MODE,
	isVocoderEnabled,
	syncPreviewQueryParam,
} from "./preview";
import {
	_setGlobalLocale,
	_setGlobalLocales,
	_setGlobalTranslations,
	_setSourceLocale,
} from "./translate";
import { applyOrdinalForms, getBestMatchingLocale, getCookie, manifestToLocalesMap, setCookie } from "@vocoder/core";
import { checkForUpdates, isRefreshAvailable } from "./api-runtime";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { formatICU, generateMessageHash } from "@vocoder/core";
import {
	getConfig,
	getLocales,
	getTranslations,
	initializeVocoder,
	loadLocale as loadLocaleFromRuntime,
	loadLocaleSync,
} from "./runtime";

import type React from "react";
import type { TOptions } from "./types";

export const VocoderContext = createContext<VocoderContextValue | null>(null);

const STORAGE_KEY = "vocoder_locale";
const HYDRATION_ID = "__vocoder_hydration__";

type HydrationSnapshot = {
	locale: string;
	translations: Record<string, string>;
	locales: LocalesMap;
	defaultLocale: string;
};

function escapeJsonForHtml(value: string): string {
	return value.replace(/</g, "\\u003c");
}

function readHydrationFromDom(): {
	raw: string;
	data: HydrationSnapshot;
} | null {
	if (typeof document === "undefined") return null;
	const el = document.getElementById(HYDRATION_ID);
	const raw = el?.textContent || "";
	if (!raw) return null;
	try {
		const data = JSON.parse(raw) as HydrationSnapshot;
		if (!data || !data.locale || !data.translations) return null;
		return { raw, data };
	} catch {
		return null;
	}
}


function buildHydrationOnServer(
	initialLocale: string | undefined,
): { raw: string; data: HydrationSnapshot } | null {
	if (typeof window !== "undefined") return null;

	const config = getConfig();
	const locales = getLocales() ?? {};
	const availableLocales = Object.keys(locales);
	const fallback = config.sourceLocale || availableLocales[0] || "en";

	const preferred = initialLocale ?? fallback;
	const bestLocale = availableLocales.length > 0
		? getBestMatchingLocale(preferred, availableLocales, fallback)
		: preferred;

	const generated = getTranslations();
	let translations = generated[bestLocale];
	if (!translations) {
		const loaded = loadLocaleSync(bestLocale);
		if (loaded) translations = loaded;
	}

	const data: HydrationSnapshot = {
		locale: bestLocale,
		translations: translations || {},
		locales,
		defaultLocale: fallback,
	};

	const raw = escapeJsonForHtml(JSON.stringify(data));
	return { raw, data };
}

/** Provides locale state and translations from generated runtime data. */
export const VocoderProvider: React.FC<VocoderProviderProps> = ({
	children,
	initialLocale,
	preview,
	applyDir = true,
	manifest,
	initialTranslations,
	loadLocale: loadLocaleProp,
}) => {
	const enabled = isVocoderEnabled(preview);

	// Computed outside useState so closures below capture a stable reference
	const manifestLocales = manifest ? manifestToLocalesMap(manifest) : null;

	// ── Hydration (computed once, never changes) ─────────────────────
	const [hydration] = useState(() => {
		if (!enabled) return null;
		if (typeof window !== "undefined") {
			return readHydrationFromDom();
		}

		if (manifest && manifestLocales) {
			const availableLocales = Object.keys(manifestLocales);
			const fallback = manifest.sourceLocale;
			const preferred = initialLocale ?? fallback;
			const resolvedLocale =
				availableLocales.length > 0
					? getBestMatchingLocale(preferred, availableLocales, fallback)
					: preferred;

			const data: HydrationSnapshot = {
				locale: resolvedLocale,
				translations: initialTranslations ?? {},
				locales: manifestLocales,
				defaultLocale: manifest.sourceLocale,
			};
			return { raw: escapeJsonForHtml(JSON.stringify(data)), data };
		}

		return buildHydrationOnServer(initialLocale);
	});
	const hydrationData = hydration?.data;
	const hydrationRaw = hydration?.raw;

	// ── Core state ───────────────────────────────────────────────────
	const [translations, setTranslations] = useState<TranslationsMap>(() => {
		let initial: TranslationsMap;

		debugger;
		if (hydrationData?.translations && hydrationData?.locale) {
			initial = { [hydrationData.locale]: hydrationData.translations };
		} else if (manifest && manifestLocales) {
			const fallback = manifest.sourceLocale;
			const availableLocales = Object.keys(manifestLocales);
			const preferred = initialLocale ?? getCookie(STORAGE_KEY) ?? fallback;
			const resolvedLocale =
				availableLocales.length > 0
					? getBestMatchingLocale(preferred, availableLocales, fallback)
					: preferred;
			initial = initialTranslations ? { [resolvedLocale]: initialTranslations } : {};
		} else {
			initial = { ...getTranslations() };
			const storedPreference = getCookie(STORAGE_KEY);
			if (storedPreference && !initial[storedPreference]) {
				const loaded = loadLocaleSync(storedPreference);
				if (loaded) {
					initial[storedPreference] = loaded;
				}
			}
		}

		_setGlobalTranslations(initial);
		return initial;
	});

	const [locales, setLocales] = useState<LocalesMap>(
		() => hydrationData?.locales ?? manifestLocales ?? getLocales(),
	);

	const [defaultLocale, setDefaultLocale] = useState(() => {
		const src =
			hydrationData?.defaultLocale || manifest?.sourceLocale || getConfig().sourceLocale || "en";
		_setSourceLocale(src);
		return src;
	});

	const [locale, setLocaleState] = useState<string>(() => {
		if (hydrationData?.locale) {
			_setGlobalLocale(hydrationData.locale);
			return hydrationData.locale;
		}

		const available =
			Object.keys(locales).length > 0
				? Object.keys(locales)
				: Object.keys(translations);

		const storedPreference = getCookie(STORAGE_KEY);
		const preferred = initialLocale || storedPreference || defaultLocale;
		const best =
			available.length > 0
				? getBestMatchingLocale(preferred, available, defaultLocale)
				: defaultLocale;

		_setGlobalLocale(best);
		return best;
	});

	const [isInitialized, setIsInitialized] = useState(false);

	// ── Sync ?vocoder=true|false query param to cookie then redirect ──
	useEffect(() => {
		if (PREVIEW_MODE) syncPreviewQueryParam();
	}, []);

	// ── Async initialization (client-side) ───────────────────────────
	useEffect(() => {
		if (!enabled || isInitialized) return;

		// Manifest mode has no plugin runtime to initialize — ready immediately
		if (manifest) {
			setIsInitialized(true);
			return;
		}

		let cancelled = false;

		(async () => {
			await initializeVocoder();
			if (cancelled) return;

			const cfg = getConfig();
			const genTranslations = getTranslations();
			const genLocales = getLocales();

			if (Object.keys(genTranslations).length > 0) {
				setTranslations((prev) => ({ ...genTranslations, ...prev }));
			}
			if (Object.keys(genLocales).length > 0) {
				setLocales(genLocales);
			}
			if (cfg.sourceLocale) {
				setDefaultLocale(cfg.sourceLocale);
			}

			const available =
				Object.keys(genLocales).length > 0
					? Object.keys(genLocales)
					: Object.keys(genTranslations);

			if (available.length > 0) {
				const fallback = cfg.sourceLocale || available[0] || "en";
				const storedPreference = getCookie(STORAGE_KEY);
				const bestLocale = getBestMatchingLocale(
					storedPreference || fallback,
					available,
					fallback,
				);

				if (!genTranslations[bestLocale]) {
					const loaded = await loadLocaleFromRuntime(bestLocale);
					if (cancelled) return;
					setTranslations((prev) => ({ ...prev, [bestLocale]: loaded }));
				}

				if (cancelled) return;
				setLocaleState(bestLocale);
				_setGlobalLocale(bestLocale);
			}

			setIsInitialized(true);
		})();

		return () => {
			cancelled = true;
		};
	}, [enabled, hydrationData, isInitialized, manifest]);

	// ── Sync global state for t() and ordinal() functions ───────────
	useEffect(() => {
		_setGlobalLocale(locale);
		_setGlobalTranslations(translations);
		_setGlobalLocales(locales);
	}, [locale, translations, locales]);

	// ── Apply dir/lang to document.documentElement (opt-in) ──────────
	useEffect(() => {
		if (!enabled || !applyDir || typeof document === "undefined") return;
		const dir = locales?.[locale]?.dir ?? "ltr";
		document.documentElement.dir = dir;
		document.documentElement.lang = locale;
	}, [enabled, applyDir, locale, locales]);

	// ── Background refresh ───────────────────────────────────────────
	// Only fetch from CDN/API when the current locale has no translations
	// from the build. If virtual modules loaded successfully there is
	// nothing to refresh — CDN is a fallback for build-time misses only.
	useEffect(() => {
		if (!enabled || !isRefreshAvailable || !isInitialized || !locale) return;

		const built = translations[locale];
		if (built && Object.keys(built).length > 0) return;

		let cancelled = false;
		checkForUpdates(locale).then((updated) => {
			if (cancelled || !updated) return;
			setTranslations((prev) => ({ ...prev, [locale]: updated }));
		});

		return () => {
			cancelled = true;
		};
	}, [enabled, locale, isInitialized]);

	// ── Derived values ───────────────────────────────────────────────
	const isReady =
		Boolean(translations[locale]) && (isInitialized || Boolean(hydrationData));

	const availableLocales = useMemo(
		() =>
			Object.keys(locales).length > 0
				? Object.keys(locales)
				: Object.keys(translations),
		[locales, translations],
	);

	// ── Context methods ──────────────────────────────────────────────
	// t — reactive translate. Takes source text + optional values/options.
	// options.id skips hash computation (used by <T> which has a pre-computed hash).
	const t = useCallback(
		(text: string, values?: Record<string, unknown>, options?: TOptions): string => {
			const hash = options?.id
				? options.id + (options.formality === "formal" || options.formality === "informal" ? `\x05${options.formality}` : "")
				: generateMessageHash(text, options?.context, options?.formality);
			const translated = translations[locale]?.[hash] ?? text;
			if (values && Object.keys(values).length > 0) {
				return formatICU(translated, values as Record<string, unknown>, locale);
			}
			return translated;
		},
		[locale, translations],
	);

	const ordinal = useCallback(
		(value: number, gender?: string): string => {
			const forms = locales?.[locale]?.ordinalForms;
			if (!forms) return String(value);
			return applyOrdinalForms(value, locale, forms, gender) ?? String(value);
		},
		[locale, locales],
	);

	// hasTranslation(key) — always a pre-computed hash. Use generateMessageHash(text) first
	// if you have source text. Magic dual-mode (hash-or-text) was removed — too surprising.
	const hasTranslation = useCallback(
		(key: string): boolean => {
			const map = translations[locale];
			if (!map) return false;
			return Object.prototype.hasOwnProperty.call(map, key);
		},
		[translations, locale],
	);

	const getDisplayName = useCallback(
		(targetLocale: string, viewingLocale?: string): string => {
			const vl = viewingLocale ?? locale;
			try {
				const dn = new Intl.DisplayNames([vl], { type: "language" });
				return dn.of(targetLocale) ?? targetLocale;
			} catch {
				return targetLocale;
			}
		},
		[locale],
	);

	const setLocale = useCallback(
		async (newLocale: string) => {
			debugger;
			const best = getBestMatchingLocale(
				newLocale,
				availableLocales,
				defaultLocale,
			);

			if (!translations[best]) {
				try {
					const loader = manifest && loadLocaleProp
						? loadLocaleProp
						: loadLocaleFromRuntime;
					const loaded = await loader(best);
					const merged = { ...translations, [best]: loaded };
					// Sync global state immediately so t() sees the new locale's
					// translations on the same render cycle — not deferred to useEffect.
					_setGlobalTranslations(merged);
					setTranslations(merged);
				} catch (error) {
					console.error(`Failed to load locale ${best}:`, error);
				}
			} else {
				// Locale already loaded — sync global immediately before state update.
				_setGlobalTranslations(translations);
			}

			setLocaleState(best);
			setCookie(STORAGE_KEY, best, {
				maxAge: 365 * 24 * 60 * 60,
				path: "/",
				sameSite: "Lax",
			});
			_setGlobalLocale(best);
		},
		[availableLocales, defaultLocale, manifest, loadLocaleProp, translations],
	);

	// ── Render ───────────────────────────────────────────────────────
	const value: VocoderContextValue = {
		availableLocales,
		getDisplayName,
		isReady,
		locale,
		dir: (locales?.[locale]?.dir ?? "ltr") as "ltr" | "rtl",
		locales,
		ordinal,
		setLocale,
		t,
		hasTranslation,
	};

	return (
		<VocoderContext.Provider value={value}>
			{hydrationRaw ? (
				<script
					id={HYDRATION_ID}
					type="application/json"
					suppressHydrationWarning
					dangerouslySetInnerHTML={{ __html: hydrationRaw }}
				/>
			) : null}
			{children}
		</VocoderContext.Provider>
	);
};

export const useVocoder = () => {
	const context = useContext(VocoderContext);
	if (!context) {
		throw new Error("useVocoder must be used inside VocoderProvider");
	}
	return context;
};
