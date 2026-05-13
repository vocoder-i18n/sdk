import { afterEach, describe, expect, it, vi } from "vitest";
import { filterByLocale, isBundleEmpty, pullAppBundle } from "../commands/pull.js";
import type { VocoderTranslationData } from "@vocoder/core";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeBundle(overrides: Partial<VocoderTranslationData> = {}): VocoderTranslationData {
	return {
		config: {
			sourceLocale: "en",
			targetLocales: ["es", "fr"],
			locales: {
				en: { nativeName: "English" },
				es: { nativeName: "Español" },
				fr: { nativeName: "Français" },
			},
		},
		translations: {
			es: { abc123: "Hola mundo", def456: "Guardar" },
			fr: { abc123: "Bonjour monde", def456: "Enregistrer" },
		},
		updatedAt: "2026-05-13T00:00:00.000Z",
		...overrides,
	};
}

function emptyBundle(): VocoderTranslationData {
	return {
		config: { sourceLocale: "", targetLocales: [], locales: {} },
		translations: {},
		updatedAt: null,
	};
}

// ── isBundleEmpty ─────────────────────────────────────────────────────────────

describe("isBundleEmpty", () => {
	it("returns true when sourceLocale is empty string", () => {
		expect(isBundleEmpty(emptyBundle())).toBe(true);
	});

	it("returns false when sourceLocale is set", () => {
		expect(isBundleEmpty(makeBundle())).toBe(false);
	});
});

// ── filterByLocale ────────────────────────────────────────────────────────────

describe("filterByLocale", () => {
	it("keeps only the requested locale", () => {
		const result = filterByLocale(makeBundle(), "es");
		expect(result.translations).toEqual({ es: { abc123: "Hola mundo", def456: "Guardar" } });
		expect(result.config).toEqual(makeBundle().config);
		expect(result.updatedAt).toBe(makeBundle().updatedAt);
	});

	it("returns empty translations when locale not in bundle", () => {
		// Missing locale → no key in output (not a { de: {} } placeholder)
		const result = filterByLocale(makeBundle(), "de");
		expect(result.translations).toEqual({});
	});

	it("preserves config and updatedAt unchanged", () => {
		const bundle = makeBundle();
		const result = filterByLocale(bundle, "fr");
		expect(result.config).toBe(bundle.config);
		expect(result.updatedAt).toBe(bundle.updatedAt);
	});
});

// ── pullAppBundle ─────────────────────────────────────────────────────────────

describe("pullAppBundle (mocked fetch)", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = originalFetch;
	});

	function makeApi(bundleOrNull: VocoderTranslationData | null) {
		return {
			fetchBundle: vi.fn().mockResolvedValue(bundleOrNull),
		} as any;
	}

	it("calls fetchBundle with the correct fingerprint for root-level app", async () => {
		const api = makeApi(makeBundle());

		// We can't fully run extraction without a real project, so mock the extractor
		// by running against an empty temp dir (zero strings extracted).
		// The fingerprint for zero keys should be deterministic and stable.
		const result = await pullAppBundle({
			projectShortId: "abc123",
			appDir: "",
			projectRoot: "/tmp/nonexistent-project-test",
			api,
			fileConfig: null,
		});

		// fetchBundle must have been called exactly once
		expect(api.fetchBundle).toHaveBeenCalledTimes(1);

		// Fingerprint must be a 12-char hex string
		const [calledFingerprint] = api.fetchBundle.mock.calls[0] as [string];
		expect(calledFingerprint).toMatch(/^[0-9a-f]{12}$/);

		// Returned fingerprint matches what was passed to fetchBundle
		expect(result.fingerprint).toBe(calledFingerprint);
		expect(result.appDir).toBe("");
	});

	it("uses appDir in scope — different appDirs produce different fingerprints", async () => {
		const api1 = makeApi(null);
		const api2 = makeApi(null);

		const [r1, r2] = await Promise.all([
			pullAppBundle({
				projectShortId: "abc123",
				appDir: "",
				projectRoot: "/tmp/nonexistent-project-test",
				api: api1,
				fileConfig: null,
			}),
			pullAppBundle({
				projectShortId: "abc123",
				appDir: "apps/web",
				projectRoot: "/tmp/nonexistent-project-test",
				api: api2,
				fileConfig: null,
			}),
		]);

		// Same project, same strings (both empty), but different appDir → different fingerprint
		expect(r1.fingerprint).not.toBe(r2.fingerprint);
	});

	it("returns empty bundle when fetchBundle returns null", async () => {
		const api = makeApi(null);

		const result = await pullAppBundle({
			projectShortId: "abc123",
			appDir: "",
			projectRoot: "/tmp/nonexistent-project-test",
			api,
			fileConfig: null,
		});

		expect(isBundleEmpty(result.data)).toBe(true);
		expect(result.data.translations).toEqual({});
	});

	it("returns bundle data when fetchBundle succeeds", async () => {
		const bundle = makeBundle();
		const api = makeApi(bundle);

		const result = await pullAppBundle({
			projectShortId: "abc123",
			appDir: "",
			projectRoot: "/tmp/nonexistent-project-test",
			api,
			fileConfig: null,
		});

		expect(result.data).toBe(bundle);
		expect(isBundleEmpty(result.data)).toBe(false);
	});

	it("fingerprint is stable across multiple calls with same inputs", async () => {
		const api1 = makeApi(null);
		const api2 = makeApi(null);

		const [r1, r2] = await Promise.all([
			pullAppBundle({
				projectShortId: "prj1",
				appDir: "apps/web",
				projectRoot: "/tmp/nonexistent-project-test",
				api: api1,
				fileConfig: null,
			}),
			pullAppBundle({
				projectShortId: "prj1",
				appDir: "apps/web",
				projectRoot: "/tmp/nonexistent-project-test",
				api: api2,
				fileConfig: null,
			}),
		]);

		expect(r1.fingerprint).toBe(r2.fingerprint);
	});
});

// ── fetchBundle API integration (mocked) ─────────────────────────────────────

describe("VocoderAPI.fetchBundle (mocked fetch)", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = originalFetch;
	});

	it("returns bundle data on 200", async () => {
		const bundle = makeBundle();
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => JSON.stringify(bundle),
		} as Response);

		const { VocoderAPI } = await import("../utils/api.js");
		const api = new VocoderAPI({ apiKey: "vcp_aB3xY9Zk_testrandombytes123456", apiUrl: "https://vocoder.app" });
		const result = await api.fetchBundle("abc123def456");

		expect(result).toEqual(bundle);
	});

	it("returns null on 404", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
			text: async () => "",
		} as Response);

		const { VocoderAPI } = await import("../utils/api.js");
		const api = new VocoderAPI({ apiKey: "vcp_aB3xY9Zk_testrandombytes123456", apiUrl: "https://vocoder.app" });
		const result = await api.fetchBundle("notfound0000");

		expect(result).toBeNull();
	});

	it("returns null on network error", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));

		const { VocoderAPI } = await import("../utils/api.js");
		const api = new VocoderAPI({ apiKey: "vcp_aB3xY9Zk_testrandombytes123456", apiUrl: "https://vocoder.app" });
		const result = await api.fetchBundle("networkfail0");

		expect(result).toBeNull();
	});

	it("hits /api/t/{fingerprint} without Authorization header", async () => {
		const bundle = makeBundle();
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => JSON.stringify(bundle),
		} as Response);
		globalThis.fetch = mockFetch;

		const { VocoderAPI } = await import("../utils/api.js");
		const api = new VocoderAPI({ apiKey: "vcp_aB3xY9Zk_testrandombytes123456", apiUrl: "https://vocoder.app" });
		await api.fetchBundle("myfp12345678");

		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://vocoder.app/api/t/myfp12345678");
		// Public endpoint — no Authorization header
		const headers = init?.headers as Record<string, string> | undefined;
		expect(headers?.Authorization).toBeUndefined();
	});
});
