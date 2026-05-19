/**
 * Runtime translation loading.
 *
 * @vocoder/plugin injects __VOCODER_MANIFEST__ at build time — a LocaleManifest
 * JSON object containing locale configuration and metadata. The manifest is read
 * synchronously at module init so config is available before any React component renders.
 *
 * Locale files are loaded lazily via the @vocoder/locales alias, which the plugin
 * resolves to the project's committed locales/ directory. Each locale is a separate
 * async chunk — only the active locale is loaded.
 *
 * SSR: loadLocaleSync reads locale files directly from disk via fs.readFileSync,
 * anchored to process.cwd()/locales/. This runs server-side only.
 *
 * If the plugin is not installed, all translations are empty and source text is rendered.
 * Non-plugin users can pass manifest + loadLocale props to VocoderProvider directly.
 */

import type { LocaleManifest, LocalesMap } from "./types";

import { manifestToLocalesMap } from "@vocoder/core";

// Injected by @vocoder/plugin at build time via DefinePlugin / Vite define
declare const __VOCODER_MANIFEST__: LocaleManifest | null | undefined;

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

let _manifest: LocaleManifest | null = null;

try {
	const injected =
		typeof __VOCODER_MANIFEST__ !== "undefined" ? __VOCODER_MANIFEST__ : null;
	if (injected?.sourceLocale) {
		_manifest = injected;
	}
} catch {
	// Plugin not installed or manifest unavailable
}

// Re-export so VocoderProvider can call it; resolves immediately (no async work needed)
export async function initializeVocoder(): Promise<void> {
	// Manifest loaded synchronously at module init — nothing to do
}

export function getConfig(): VocoderConfig {
	if (!_manifest) return emptyConfig;
	return {
		sourceLocale: _manifest.sourceLocale,
		targetLocales: _manifest.targetLocales,
		locales: manifestToLocalesMap(_manifest),
	};
}

export function getTranslations(): Record<string, Record<string, string>> {
	return {};
}

export function getLocales(): LocalesMap {
	return _manifest ? manifestToLocalesMap(_manifest) : {};
}

/** Load a locale's translations. Delegates to @vocoder/react/locale-loader, which
 * @vocoder/plugin replaces at build time with a static switch over the project's locale files. */
export async function loadLocale(locale: string): Promise<Record<string, string>> {
	try {
		debugger;
		// @ts-ignore — resolved by @vocoder/plugin at build time; stub returns {} without plugin
		const { loadLocale: load } = await import("@vocoder/react/locale-loader");
		return await load(locale);
	} catch {
		return {};
	}
}

/** Synchronous locale lookup for SSR. Reads from process.cwd()/locales/ via fs. */
export function loadLocaleSync(locale: string): Record<string, string> | null {
	debugger;
	if (typeof window !== "undefined") return null;
	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { readFileSync } = require("node:fs") as typeof import("node:fs");
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { resolve } = require("node:path") as typeof import("node:path");
		const filePath = resolve(process.cwd(), "locales", `${locale}.json`);
		return JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, string>;
	} catch {
		return null;
	}
}
