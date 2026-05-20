/**
 * Runtime translation loading.
 *
 * @vocoder/plugin intercepts two virtual module imports at build time:
 *
 * - @vocoder/react/manifest-loader — returns locales/manifest.json as a module
 *   default export. Read once synchronously at module init so locale config is
 *   available before any React component renders.
 *
 * - @vocoder/react/locale-loader — returns a generated switch statement that
 *   lazy-loads per-locale JSON files as separate code-split chunks. Only the
 *   active locale is fetched, on demand when the user switches locale.
 *
 * SSR: loadLocaleSync reads locale files directly from disk via fs.readFileSync,
 * anchored to process.cwd()/locales/. This runs server-side only.
 *
 * Without the plugin, both stubs return empty values and source text is rendered.
 */

import type { LocaleManifest, LocalesMap } from "./types";

import { manifestToLocalesMap } from "@vocoder/core";
// @ts-ignore — resolved by @vocoder/plugin at build time; stub returns null without plugin
import _injectedManifest from "@vocoder/react/manifest-loader";

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

const _manifest: LocaleManifest | null =
	(_injectedManifest as LocaleManifest | null)?.sourceLocale
		? (_injectedManifest as LocaleManifest)
		: null;

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
		// @ts-ignore — resolved by @vocoder/plugin at build time; stub returns {} without plugin
		const { loadLocale: load } = await import("@vocoder/react/locale-loader");
		return await load(locale);
	} catch {
		return {};
	}
}

/** Synchronous locale lookup for SSR. Reads from process.cwd()/locales/ via fs. */
export function loadLocaleSync(locale: string): Record<string, string> | null {
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
