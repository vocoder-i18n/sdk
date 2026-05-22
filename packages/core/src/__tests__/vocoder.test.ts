import { describe, expect, it, vi } from "vitest";
import { type LocaleLoader, VocoderCore, createVocoder } from "../vocoder";
import type { LocaleManifest } from "../types";

const enTranslations: Record<string, string> = {};
const esTranslations: Record<string, string> = { "1w2u0qz": "Hola" }; // hash of "Hello"

const manifest: LocaleManifest = {
	version: 1,
	sourceLocale: "en",
	targetLocales: ["es", "ar"],
	locales: {
		en: { nativeName: "English", isRTL: false },
		es: { nativeName: "Español", isRTL: false },
		ar: {
			nativeName: "العربية",
			isRTL: true,
			ordinalForms: {
				type: "word",
				words: { "": { 1: "الأول" } },
			},
		},
	},
	updatedAt: "2026-01-01T00:00:00.000Z",
	fingerprint: "test",
};

const enManifest: LocaleManifest = {
	version: 1,
	sourceLocale: "en",
	targetLocales: [],
	locales: {
		en: {
			nativeName: "English",
			isRTL: false,
			ordinalForms: {
				type: "suffix",
				suffixes: { one: "#st", two: "#nd", few: "#rd", other: "#th" },
			},
		},
	},
	updatedAt: "2026-01-01T00:00:00.000Z",
	fingerprint: "test",
};

function makeLoader(
	map: Record<string, Record<string, string>> = {},
): LocaleLoader {
	return vi.fn(async (locale: string) => map[locale] ?? {});
}

describe("VocoderCore", () => {
	describe("load()", () => {
		it("populates locales from manifest", () => {
			const core = createVocoder();
			core.load(manifest, makeLoader());
			expect(core.availableLocales).toEqual(["en", "es", "ar"]);
			expect(core.defaultLocale).toBe("en");
		});

		it("sets dir for RTL locales", () => {
			const core = createVocoder();
			core.load(manifest, makeLoader());
			expect(core.locales["ar"]?.dir).toBe("rtl");
			expect(core.locales["en"]?.dir).toBeUndefined();
		});

		it("does not notify subscribers — no I/O side effects", () => {
			const core = createVocoder();
			const listener = vi.fn();
			core.onChange(listener);
			core.load(manifest, makeLoader());
			expect(listener).not.toHaveBeenCalled();
		});
	});

	describe("activate()", () => {
		it("calls loader and sets locale", async () => {
			const loader = makeLoader({ es: esTranslations });
			const core = createVocoder();
			core.load(manifest, loader);
			await core.activate("es");
			expect(core.locale).toBe("es");
			expect(loader).toHaveBeenCalledWith("es");
		});

		it("notifies onChange subscribers after activation", async () => {
			const core = createVocoder();
			core.load(manifest, makeLoader());
			const listener = vi.fn();
			core.onChange(listener);
			await core.activate("en");
			expect(listener).toHaveBeenCalledOnce();
		});

		it("does not double-load a cached locale", async () => {
			const loader = makeLoader({ es: esTranslations });
			const core = createVocoder();
			core.load(manifest, loader);
			await core.activate("es");
			await core.activate("es");
			expect(loader).toHaveBeenCalledOnce();
		});

		it("resolves best matching locale (en-US → en)", async () => {
			const loader = makeLoader({ en: enTranslations });
			const core = createVocoder();
			core.load(manifest, loader);
			await core.activate("en-US");
			expect(core.locale).toBe("en");
		});

		it("falls back to defaultLocale when no match exists", async () => {
			const loader = makeLoader({ en: enTranslations });
			const core = createVocoder();
			core.load(manifest, loader);
			await core.activate("ja");
			expect(core.locale).toBe("en");
		});
	});

	describe("seed()", () => {
		it("pre-populates translations without notifying", () => {
			const core = createVocoder();
			core.load(manifest, makeLoader());
			const listener = vi.fn();
			core.onChange(listener);
			core.seed("es", esTranslations);
			expect(listener).not.toHaveBeenCalled();
			expect(core.translations["es"]).toEqual(esTranslations);
		});

		it("seeded translations are used after activate", async () => {
			const loader = makeLoader();
			const core = createVocoder();
			core.load(manifest, loader);
			core.seed("es", esTranslations);
			await core.activate("es");
			// Loader should NOT be called — translations already cached via seed
			expect(loader).not.toHaveBeenCalled();
			expect(core.locale).toBe("es");
		});
	});

	describe("t()", () => {
		it("returns source text when no translation is loaded", async () => {
			const core = createVocoder();
			core.load(manifest, makeLoader({ en: {} }));
			await core.activate("en");
			expect(core.t("Hello")).toBe("Hello");
		});

		it("returns translation when hash matches", async () => {
			const core = createVocoder();
			core.load(manifest, makeLoader({ es: esTranslations }));
			core.seed("es", esTranslations);
			await core.activate("es");
			expect(core.t("Hello")).toBe("Hola");
		});

		it("applies ICU interpolation", async () => {
			const hash = "icutest"; // use options.id to skip hashing
			const core = createVocoder();
			core.load(enManifest, makeLoader({ en: { icutest: "Hello {name}" } }));
			core.seed("en", { icutest: "Hello {name}" });
			await core.activate("en");
			expect(core.t("Hello {name}", { name: "World" }, { id: "icutest" })).toBe(
				"Hello World",
			);
		});

		it("uses options.id to skip hash computation", async () => {
			const core = createVocoder();
			core.load(enManifest, makeLoader({ en: { mykey: "Translated" } }));
			core.seed("en", { mykey: "Translated" });
			await core.activate("en");
			expect(core.t("anything", undefined, { id: "mykey" })).toBe("Translated");
		});
	});

	describe("ordinal()", () => {
		it("applies English suffix ordinal forms", async () => {
			const core = createVocoder();
			core.load(enManifest, makeLoader({ en: {} }));
			await core.activate("en");
			expect(core.ordinal(1)).toBe("1st");
			expect(core.ordinal(2)).toBe("2nd");
			expect(core.ordinal(3)).toBe("3rd");
			expect(core.ordinal(4)).toBe("4th");
		});

		it("falls back to String(value) when no ordinal data", async () => {
			// es in the test manifest has no ordinalForms
			const noOrdinalManifest: LocaleManifest = {
				...manifest,
				locales: {
					...manifest.locales,
					es: { nativeName: "Español", isRTL: false },
				},
			};
			const core = createVocoder();
			core.load(noOrdinalManifest, makeLoader({ es: {} }));
			await core.activate("es");
			expect(core.ordinal(1)).toBe("1");
		});
	});

	describe("hasTranslation()", () => {
		it("returns true for a key that exists", async () => {
			const core = createVocoder();
			core.load(manifest, makeLoader({ es: esTranslations }));
			core.seed("es", esTranslations);
			await core.activate("es");
			expect(core.hasTranslation("1w2u0qz")).toBe(true);
		});

		it("returns false for a key that does not exist", async () => {
			const core = createVocoder();
			core.load(manifest, makeLoader({ en: {} }));
			await core.activate("en");
			expect(core.hasTranslation("nonexistent")).toBe(false);
		});
	});

	describe("onChange()", () => {
		it("fires listener on activate", async () => {
			const core = createVocoder();
			core.load(manifest, makeLoader());
			const listener = vi.fn();
			core.onChange(listener);
			await core.activate("en");
			expect(listener).toHaveBeenCalledOnce();
		});

		it("unsubscribe stops future notifications", async () => {
			const core = createVocoder();
			core.load(manifest, makeLoader());
			const listener = vi.fn();
			const unsubscribe = core.onChange(listener);
			unsubscribe();
			await core.activate("en");
			expect(listener).not.toHaveBeenCalled();
		});

		it("multiple listeners all fire", async () => {
			const core = createVocoder();
			core.load(manifest, makeLoader());
			const a = vi.fn();
			const b = vi.fn();
			core.onChange(a);
			core.onChange(b);
			await core.activate("en");
			expect(a).toHaveBeenCalledOnce();
			expect(b).toHaveBeenCalledOnce();
		});
	});

	describe("subscribe()", () => {
		it("calls fn immediately with current state snapshot", () => {
			const core = createVocoder();
			core.load(manifest, makeLoader());
			const fn = vi.fn();
			core.subscribe(fn);
			expect(fn).toHaveBeenCalledOnce();
			const snapshot = fn.mock.calls[0][0];
			expect(snapshot).toHaveProperty("locale");
			expect(snapshot).toHaveProperty("defaultLocale", "en");
			expect(snapshot).toHaveProperty("availableLocales");
		});

		it("calls fn again on activate with new snapshot object", async () => {
			const core = createVocoder();
			core.load(manifest, makeLoader());
			const snapshots: object[] = [];
			core.subscribe((s) => snapshots.push(s));
			await core.activate("es");
			expect(snapshots).toHaveLength(2);
			// Each call produces a new object reference
			expect(snapshots[0]).not.toBe(snapshots[1]);
			expect((snapshots[1] as { locale: string }).locale).toBe("es");
		});

		it("returns unsubscribe that stops further calls", async () => {
			const core = createVocoder();
			core.load(manifest, makeLoader());
			const fn = vi.fn();
			const unsub = core.subscribe(fn);
			unsub();
			await core.activate("es");
			// fn was called once immediately on subscribe; should NOT be called again
			expect(fn).toHaveBeenCalledOnce();
		});
	});

	describe("createVocoder()", () => {
		it("creates isolated instances with independent state", async () => {
			const a = createVocoder();
			const b = createVocoder();
			a.load(manifest, makeLoader({ es: esTranslations }));
			b.load(manifest, makeLoader({ en: enTranslations }));
			await a.activate("es");
			await b.activate("en");
			expect(a.locale).toBe("es");
			expect(b.locale).toBe("en");
		});
	});
});
