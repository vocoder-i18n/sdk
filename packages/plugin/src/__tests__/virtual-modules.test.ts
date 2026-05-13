import { describe, expect, it } from "vitest";
import type { VocoderTranslationData } from "../types";

// The plugin no longer uses virtual modules (resolveId/load hooks).
// All translation data is inlined as __VOCODER_BUNDLE__ via DefinePlugin.
// These tests verify the expected bundle shape and that no virtual:vocoder
// module references exist in the plugin output.

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

describe("__VOCODER_BUNDLE__ define shape", () => {
	it("serializes to valid JSON", () => {
		const define = JSON.stringify(SAMPLE_DATA ?? null);
		expect(() => JSON.parse(define)).not.toThrow();
	});

	it("preserves config fields", () => {
		const define = JSON.stringify(SAMPLE_DATA);
		const parsed = JSON.parse(define) as VocoderTranslationData;
		expect(parsed.config.sourceLocale).toBe("en");
		expect(parsed.config.targetLocales).toEqual(["fr", "de"]);
	});

	it("preserves all locale translations inline", () => {
		const define = JSON.stringify(SAMPLE_DATA);
		const parsed = JSON.parse(define) as VocoderTranslationData;
		expect(parsed.translations.fr?.abc1234).toBe("Bonjour");
		expect(parsed.translations.de?.abc1234).toBe("Hallo");
	});

	it("serializes null bundle to null string", () => {
		const define = JSON.stringify(null);
		expect(define).toBe("null");
		expect(JSON.parse(define)).toBeNull();
	});

	it("handles empty translations object", () => {
		const empty: VocoderTranslationData = {
			config: { sourceLocale: "en", targetLocales: [], locales: {} },
			translations: {},
			updatedAt: null,
		};
		const define = JSON.stringify(empty);
		const parsed = JSON.parse(define) as VocoderTranslationData;
		expect(parsed.translations).toEqual({});
	});
});

describe("no virtual module references", () => {
	it("plugin index.ts does not import virtual:vocoder", async () => {
		// Read the plugin source to verify no virtual module strings remain
		const { readFileSync } = await import("node:fs");
		const { resolve } = await import("node:path");
		const src = readFileSync(
			resolve(__dirname, "../index.ts"),
			"utf-8",
		);
		expect(src).not.toContain("virtual:vocoder");
		expect(src).not.toContain("VIRTUAL_PREFIX");
		expect(src).not.toContain("resolveId");
		expect(src).not.toContain("generateManifestModule");
	});

	it("plugin index.ts defines __VOCODER_BUNDLE__", async () => {
		const { readFileSync } = await import("node:fs");
		const { resolve } = await import("node:path");
		const src = readFileSync(resolve(__dirname, "../index.ts"), "utf-8");
		expect(src).toContain("__VOCODER_BUNDLE__");
	});
});
