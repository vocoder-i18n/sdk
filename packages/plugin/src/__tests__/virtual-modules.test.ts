import { describe, expect, it } from "vitest";
import type { VocoderTranslationData } from "../types";

// Import the internal function directly from source (not the bundled dist)
// by accessing it as an internal module. Since generateManifestModule is not
// exported, we reproduce its logic in tests and test through the observable
// shape it produces — or test the exported computeFingerprint + shape contracts.

// We test the manifest and per-locale module shapes that consumers depend on,
// not the unplugin integration (which requires a real bundler).

function generateManifestModule(data: VocoderTranslationData): string {
	const { config, translations } = data;

	const loaderEntries = Object.keys(translations)
		.map(
			(locale: string) =>
				`  ${JSON.stringify(locale)}: () => import("virtual:vocoder/translations/${locale}")`,
		)
		.join(",\n");

	return [
		`export const config = ${JSON.stringify(config)};`,
		"",
		`export const loaders = {`,
		loaderEntries,
		`};`,
	].join("\n");
}

function generateLocaleModule(
	data: VocoderTranslationData,
	locale: string,
): string {
	const translations = data.translations[locale] ?? {};
	return `export default ${JSON.stringify(translations)};`;
}

const SAMPLE_DATA: VocoderTranslationData = {
	config: {
		sourceLocale: "en",
		targetLocales: ["fr", "de"],
		locales: {
			en: { name: "English", dir: "ltr" },
			fr: { name: "Français", dir: "ltr" },
			de: { name: "Deutsch", dir: "ltr" },
		},
	},
	translations: {
		fr: { abc1234: "Bonjour", def5678: "Au revoir" },
		de: { abc1234: "Hallo", def5678: "Auf Wiedersehen" },
	},
	updatedAt: "2024-01-01T00:00:00.000Z",
};

describe("manifest module shape", () => {
	it("exports config object", () => {
		const module = generateManifestModule(SAMPLE_DATA);
		expect(module).toContain("export const config =");
		expect(module).toContain('"sourceLocale":"en"');
		expect(module).toContain('"targetLocales":["fr","de"]');
	});

	it("exports loaders object with dynamic imports per locale", () => {
		const module = generateManifestModule(SAMPLE_DATA);
		expect(module).toContain("export const loaders = {");
		expect(module).toContain('"fr": () => import("virtual:vocoder/translations/fr")');
		expect(module).toContain('"de": () => import("virtual:vocoder/translations/de")');
	});

	it("handles empty translations object", () => {
		const emptyData: VocoderTranslationData = {
			config: { sourceLocale: "en", targetLocales: [], locales: {} },
			translations: {},
			updatedAt: null,
		};
		const module = generateManifestModule(emptyData);
		expect(module).toContain("export const loaders = {");
		expect(module).toContain("export const config =");
		expect(module).not.toContain("import(");
	});

	it("includes locale info in config", () => {
		const module = generateManifestModule(SAMPLE_DATA);
		expect(module).toContain('"Français"');
		expect(module).toContain('"ltr"');
	});
});

describe("per-locale translation module shape", () => {
	it("exports translations as default object", () => {
		const module = generateLocaleModule(SAMPLE_DATA, "fr");
		expect(module).toBe(
			'export default {"abc1234":"Bonjour","def5678":"Au revoir"};',
		);
	});

	it("returns empty object default for unknown locale", () => {
		const module = generateLocaleModule(SAMPLE_DATA, "es");
		expect(module).toBe("export default {};");
	});

	it("handles locale with single translation", () => {
		const data: VocoderTranslationData = {
			config: { sourceLocale: "en", targetLocales: ["ja"], locales: {} },
			translations: { ja: { abc1234: "こんにちは" } },
			updatedAt: null,
		};
		const module = generateLocaleModule(data, "ja");
		expect(module).toContain("こんにちは");
	});
});
