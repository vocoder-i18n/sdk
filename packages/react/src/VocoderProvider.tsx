import type { LocalesMap, TranslationsMap, VocoderContextValue, VocoderProviderProps } from "./types";
import {
	PREVIEW_MODE,
	isVocoderEnabled,
	syncPreviewQueryParam,
} from "./preview";
import {
	applyOrdinalForms,
	formatICU,
	generateMessageHash,
	getBestMatchingLocale,
	getCookie,
	setCookie,
	vocoder as defaultVocoder,
} from "@vocoder/core";
import { type VocoderCore, createVocoder } from "@vocoder/core";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

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
		if (!data?.locale || !data?.translations) return null;
		return { raw, data };
	} catch {
		return null;
	}
}

/** Provides locale state and translations from a VocoderCore instance. */
export const VocoderProvider: React.FC<VocoderProviderProps> = ({
	children,
	instance: instanceProp,
	manifest,
	loadLocale: loadLocaleProp,
	initialLocale,
	initialTranslations,
	preview,
	applyDir = true,
}) => {
	const enabled = isVocoderEnabled(preview);

	// Resolve which core instance to use — stable for component lifetime.
	// Priority: explicit instance > manifest convenience props > default singleton.
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentionally empty — core is created once on mount; re-creating on prop changes would reset all locale state
	const core: VocoderCore = useMemo(() => {
		if (instanceProp) {
			if (initialTranslations && initialLocale) {
				instanceProp.seed(initialLocale, initialTranslations);
			}
			return instanceProp;
		}
		if (manifest) {
			// When manifest is provided, always create a dedicated core so locale data
			// comes from this manifest, not whatever the default singleton has loaded.
			const c = createVocoder();
			// Fall back to a no-op loader if loadLocale is omitted — locale switching
			// will silently return empty translations rather than throw.
			c.load(manifest, loadLocaleProp ?? (() => Promise.resolve({})));
			if (initialTranslations && initialLocale) {
				c.seed(initialLocale, initialTranslations);
			}
			return c;
		}
		if (initialTranslations && initialLocale) {
			defaultVocoder.seed(initialLocale, initialTranslations);
		}
		return defaultVocoder;
	}, []);

	// ── SSR hydration snapshot (computed once on mount) ──────────────────
	// Server: build from manifest/instance state and embed in <script> tag.
	// Client: read back from that <script> tag to match server render.
	const [hydration] = useState((): { raw: string; data: HydrationSnapshot } | null => {
		if (!enabled) return null;

		if (typeof window !== "undefined") {
			// Client-side: read server-injected snapshot from DOM
			return readHydrationFromDom();
		}

		// Server-side — manifest convenience mode
		if (manifest && loadLocaleProp) {
			const available = Object.keys(core.locales);
			const fallback = manifest.sourceLocale;
			const preferred = initialLocale ?? fallback;
			const resolvedLocale =
				available.length > 0
					? getBestMatchingLocale(preferred, available, fallback)
					: preferred;
			const data: HydrationSnapshot = {
				locale: resolvedLocale,
				translations: initialTranslations ?? {},
				locales: core.locales,
				defaultLocale: fallback,
			};
			return { raw: escapeJsonForHtml(JSON.stringify(data)), data };
		}

		// Server-side — instance/singleton mode: read from core if already activated
		if (core.locale) {
			const data: HydrationSnapshot = {
				locale: core.locale,
				translations: core.translations[core.locale] ?? {},
				locales: core.locales,
				defaultLocale: core.defaultLocale,
			};
			return { raw: escapeJsonForHtml(JSON.stringify(data)), data };
		}

		return null;
	});

	// ── Local React state (mirrors core, initialized from hydration for SSR) ─
	// These drive context rendering. Subscribe to core.onChange to stay in sync.
	const [locale, setLocaleState] = useState<string>(() => {
		const loc = hydration?.data?.locale ?? core.locale;
		if (loc) return loc;
		const storedPreference = getCookie(STORAGE_KEY);
		return storedPreference ?? core.defaultLocale ?? "en";
	});

	const [translations, setTranslations] = useState<TranslationsMap>(() => {
		if (hydration?.data) {
			// Seed core synchronously so t() sees translations immediately
			core.seed(hydration.data.locale, hydration.data.translations);
			return { [hydration.data.locale]: hydration.data.translations };
		}
		return { ...core.translations };
	});

	const [locales, setLocales] = useState<LocalesMap>(
		() => hydration?.data?.locales ?? { ...core.locales },
	);

	const [defaultLocale] = useState<string>(
		() => hydration?.data?.defaultLocale ?? core.defaultLocale ?? "en",
	);

	const [isInitialized, setIsInitialized] = useState(() => {
		// Already settled if hydration data exists (SSR) or if core was pre-activated
		// before this provider mounted (SPA singleton/instance pattern).
		if (hydration?.data) return true;
		const loc = core.locale;
		return Boolean(loc && core.translations[loc] && Object.keys(core.translations[loc] ?? {}).length > 0);
	});

	// ── Sync ?vocoder=true|false query param → cookie → redirect ──────────
	useEffect(() => {
		if (PREVIEW_MODE) syncPreviewQueryParam();
	}, []);

	// ── Subscribe to core changes → update local React state ──────────────
	useEffect(() => {
		return core.onChange(() => {
			setLocaleState(core.locale);
			setTranslations({ ...core.translations });
			setLocales({ ...core.locales });
		});
	}, [core]);

	// ── Activate initial locale (client-side async) ────────────────────────
	// biome-ignore lint/correctness/useExhaustiveDependencies: hydration?.data?.locale, initialLocale, and isInitialized intentionally excluded — this effect runs once on mount to set initial locale; isInitialized is an early-exit guard, not a trigger
	useEffect(() => {
		if (!enabled || isInitialized) return;

		const preferred =
			hydration?.data?.locale ??
			initialLocale ??
			getCookie(STORAGE_KEY) ??
			core.defaultLocale ??
			"en";

		core.activate(preferred).then(() => setIsInitialized(true));
	}, [core, enabled]);

	// ── Apply dir/lang to document.documentElement (opt-in) ───────────────
	useEffect(() => {
		if (!enabled || !applyDir || typeof document === "undefined") return;
		const dir = locales?.[locale]?.dir ?? "ltr";
		document.documentElement.dir = dir;
		document.documentElement.lang = locale;
	}, [enabled, applyDir, locale, locales]);

	// ── Derived values ─────────────────────────────────────────────────────
	const hasSettled = !enabled || isInitialized || Boolean(hydration?.data);
	const isReady = hasSettled;

	const availableLocales = useMemo(
		() =>
			Object.keys(locales).length > 0
				? Object.keys(locales)
				: Object.entries(translations)
						.filter(([, map]) => Object.keys(map).length > 0)
						.map(([key]) => key),
		[locales, translations],
	);

	// ── Context methods ────────────────────────────────────────────────────

	// options.id skips hash computation (used by <T> which has a pre-computed hash).
	const t = useCallback(
		(text: string, values?: Record<string, unknown>, options?: TOptions): string => {
			const hash = options?.id
				? options.id
				: generateMessageHash(text, options?.context, options?.formality);
			const translated = translations[locale]?.[hash] ?? text;
			if (values && Object.keys(values).length > 0) {
				return formatICU(translated, values, locale);
			}
			return translated;
		},
		[locale, translations],
	);

	const ordinal = useCallback(
		(n: number, gender?: string): string => {
			const forms = locales?.[locale]?.ordinalForms;
			if (!forms) return String(n);
			return applyOrdinalForms(n, locale, forms, gender) ?? String(n);
		},
		[locale, locales],
	);

	// key must be a pre-computed hash — use generateMessageHash(text) if you have source text.
	const hasTranslation = useCallback(
		(key: string): boolean => {
			const map = translations[locale];
			return !!map && Object.hasOwn(map, key);
		},
		[translations, locale],
	);

	const getDisplayName = useCallback(
		(targetLocale: string, viewingLocale?: string): string => {
			try {
				const dn = new Intl.DisplayNames([viewingLocale ?? locale], {
					type: "language",
				});
				return dn.of(targetLocale) ?? targetLocale;
			} catch {
				return targetLocale;
			}
		},
		[locale],
	);

	const setLocale = useCallback(
		async (newLocale: string): Promise<void> => {
			const best = getBestMatchingLocale(newLocale, availableLocales, defaultLocale);
			await core.activate(best);
			setCookie(STORAGE_KEY, best, {
				maxAge: 365 * 24 * 60 * 60,
				path: "/",
				sameSite: "Lax",
			});
		},
		[core, availableLocales, defaultLocale],
	);

	// ── Render ─────────────────────────────────────────────────────────────
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
			{hydration?.raw ? (
				<script
					id={HYDRATION_ID}
					type="application/json"
					suppressHydrationWarning
					dangerouslySetInnerHTML={{ __html: hydration.raw }}
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
