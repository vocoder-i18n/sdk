/**
 * Runtime translation loading.
 *
 * @vocoder/plugin injects __VOCODER_BUNDLE__ at build time — a complete
 * VocoderTranslationData JSON object containing config and all locale
 * translations. The bundle is read synchronously at module init so translations
 * are available before any React component renders.
 *
 * SSR fallback: when __VOCODER_BUNDLE__ is not defined (e.g. Next.js server
 * components before hydration), the runtime reads the disk cache written by the
 * plugin to node_modules/.vocoder/cache/{fingerprint}.json.
 *
 * If the plugin is not installed, all translations are empty and source text
 * is rendered.
 */

import type { LocalesMap, TranslationsMap } from "./types";
import type { VocoderTranslationData } from "@vocoder/core";

// Injected by @vocoder/plugin at build time via DefinePlugin / Vite define
declare const __VOCODER_BUNDLE__: VocoderTranslationData | null | undefined;
declare const __VOCODER_FINGERPRINT__: string | undefined;

interface VocoderConfig {
	sourceLocale: string;
	targetLocales: string[];
	locales: LocalesMap;
}

const emptyConfig: VocoderConfig = {
	sourceLocale: "",
	targetLocales: [],
	locales: {},
};

let _config: VocoderConfig = emptyConfig;
const _loadedTranslations: TranslationsMap = {};

function loadFromDiskCache(): VocoderTranslationData | null {
	if (typeof window !== "undefined") return null;
	try {
		const fp =
			typeof __VOCODER_FINGERPRINT__ !== "undefined" ? __VOCODER_FINGERPRINT__ : "";
		if (!fp) return null;
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { readFileSync } = require("node:fs") as typeof import("node:fs");
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { resolve } = require("node:path") as typeof import("node:path");
		const cachePath = resolve(
			process.cwd(),
			"node_modules/.vocoder/cache",
			`${fp}.json`,
		);
		return JSON.parse(readFileSync(cachePath, "utf-8")) as VocoderTranslationData;
	} catch {
		return null;
	}
}

function applyBundle(bundle: VocoderTranslationData): void {
	_config = bundle.config as VocoderConfig;
	for (const [locale, translations] of Object.entries(bundle.translations)) {
		_loadedTranslations[locale] = translations;
	}
}

// Apply bundle synchronously at module init — translations available before first render
try {
	const bundle: VocoderTranslationData | null | undefined =
		typeof __VOCODER_BUNDLE__ !== "undefined" ? __VOCODER_BUNDLE__ : null;

	if (bundle?.config?.sourceLocale) {
		applyBundle(bundle);
	} else if (typeof window === "undefined") {
		// SSR: plugin bundle not available — try disk cache written by the plugin
		const cached = loadFromDiskCache();
		if (cached?.config?.sourceLocale) {
			applyBundle(cached);
		}
	}
} catch {
	// Plugin not installed or bundle unavailable — empty translations
}

// Re-export so VocoderProvider can call it; resolves immediately (no async work needed)
export async function initializeVocoder(): Promise<void> {
	// Bundle loaded synchronously at module init — nothing to do
}

export function getConfig(): VocoderConfig {
	return _config;
}

export function getTranslations(): TranslationsMap {
	return _loadedTranslations;
}

export function getLocales(): LocalesMap {
	return _config.locales;
}

/** Return translations for a locale. All locales are loaded inline from the bundle. */
export async function loadLocale(locale: string): Promise<Record<string, string>> {
	return _loadedTranslations[locale] ?? {};
}

/** Synchronous locale lookup for SSR. */
export function loadLocaleSync(locale: string): Record<string, string> | null {
	return _loadedTranslations[locale] ?? null;
}
