import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Set env vars before module is evaluated — vi.hoisted() runs before static imports.
vi.hoisted(() => {
	process.env.VOCODER_PROJECT_SHORT_ID = "testproj";
	process.env.VOCODER_CDN_URL = "https://cdn.test";
	process.env.VOCODER_API_URL = "https://api.test";
});

import {
	_resetCachesForTesting,
	checkForUpdates,
	isRefreshAvailable,
} from "../cdn-refresh";

const FP = "abc123fingerprint";
const TRANSLATIONS: Record<string, string> = { key1: "Hello", key2: "World" };

function stubFetchSequence(
	responses: Array<{ status: number; body?: unknown }>,
): ReturnType<typeof vi.fn> {
	const mock = vi.fn();
	for (const r of responses) {
		mock.mockResolvedValueOnce({
			status: r.status,
			ok: r.status >= 200 && r.status < 300,
			json: () => Promise.resolve(r.body ?? {}),
		});
	}
	vi.stubGlobal("fetch", mock);
	return mock;
}

beforeEach(() => {
	vi.stubGlobal("window", {}); // simulate browser environment
	_resetCachesForTesting();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

// ── isRefreshAvailable ────────────────────────────────────────────────────────

describe("isRefreshAvailable", () => {
	it("returns true when fingerprint and projectShortId are present", () => {
		expect(isRefreshAvailable(FP)).toBe(true);
	});

	it("returns false for empty fingerprint", () => {
		expect(isRefreshAvailable("")).toBe(false);
	});

	it("returns false for undefined fingerprint", () => {
		expect(isRefreshAvailable(undefined)).toBe(false);
	});
});

// ── checkForUpdates — early exits ─────────────────────────────────────────────

describe("checkForUpdates — early exits", () => {
	it("returns null in SSR (no window)", async () => {
		vi.unstubAllGlobals(); // removes window stub
		const result = await checkForUpdates("en", FP);
		expect(result).toBeNull();
	});

	it("returns null when fingerprint is empty", async () => {
		const result = await checkForUpdates("en", "");
		expect(result).toBeNull();
	});
});

// ── CDN 200 — fresh translations ──────────────────────────────────────────────

describe("checkForUpdates — CDN 200", () => {
	it("returns translations", async () => {
		stubFetchSequence([{ status: 200, body: TRANSLATIONS }]);
		const result = await checkForUpdates("en", FP);
		expect(result).toEqual(TRANSLATIONS);
	});

	it("caches result — second call returns cached value without fetching", async () => {
		const mock = stubFetchSequence([{ status: 200, body: TRANSLATIONS }]);
		await checkForUpdates("en", FP);
		const result = await checkForUpdates("en", FP);
		expect(result).toEqual(TRANSLATIONS);
		expect(mock).toHaveBeenCalledTimes(1);
	});
});

// ── CDN 304 — not modified ────────────────────────────────────────────────────

describe("checkForUpdates — CDN 304", () => {
	it("returns null", async () => {
		stubFetchSequence([{ status: 304 }]);
		const result = await checkForUpdates("en", FP);
		expect(result).toBeNull();
	});

	it("marks locale as checked — subsequent calls skip fetch", async () => {
		const mock = stubFetchSequence([{ status: 304 }]);
		await checkForUpdates("en", FP);
		await checkForUpdates("en", FP);
		expect(mock).toHaveBeenCalledTimes(1);
	});
});

// ── CDN fallback to API ───────────────────────────────────────────────────────

describe("checkForUpdates — CDN fallback to API", () => {
	it("CDN 404 → falls back to API, returns translations", async () => {
		const mock = stubFetchSequence([
			{ status: 404 },
			{ status: 200, body: TRANSLATIONS },
		]);
		const result = await checkForUpdates("en", FP);
		expect(result).toEqual(TRANSLATIONS);
		expect(mock).toHaveBeenCalledTimes(2);
	});

	it("CDN network error → falls back to API", async () => {
		const mock = vi.fn()
			.mockRejectedValueOnce(new Error("network"))
			.mockResolvedValueOnce({
				status: 200,
				ok: true,
				json: () => Promise.resolve(TRANSLATIONS),
			});
		vi.stubGlobal("fetch", mock);
		const result = await checkForUpdates("en", FP);
		expect(result).toEqual(TRANSLATIONS);
		expect(mock).toHaveBeenCalledTimes(2);
	});

	it("CDN 500 → falls back to API", async () => {
		const mock = stubFetchSequence([
			{ status: 500 },
			{ status: 200, body: TRANSLATIONS },
		]);
		const result = await checkForUpdates("en", FP);
		expect(result).toEqual(TRANSLATIONS);
		expect(mock).toHaveBeenCalledTimes(2);
	});

	it("CDN 404 → API 304 → returns null", async () => {
		stubFetchSequence([{ status: 404 }, { status: 304 }]);
		const result = await checkForUpdates("en", FP);
		expect(result).toBeNull();
	});

	it("CDN 404 → API error → returns null", async () => {
		const mock = vi.fn()
			.mockResolvedValueOnce({ status: 404, ok: false, json: vi.fn() })
			.mockRejectedValueOnce(new Error("api down"));
		vi.stubGlobal("fetch", mock);
		const result = await checkForUpdates("en", FP);
		expect(result).toBeNull();
	});
});

// ── Deduplication ─────────────────────────────────────────────────────────────

describe("checkForUpdates — deduplication", () => {
	it("concurrent calls share one in-flight request", async () => {
		const mock = stubFetchSequence([{ status: 200, body: TRANSLATIONS }]);
		const [r1, r2, r3] = await Promise.all([
			checkForUpdates("en", FP),
			checkForUpdates("en", FP),
			checkForUpdates("en", FP),
		]);
		expect(r1).toEqual(TRANSLATIONS);
		expect(r2).toEqual(TRANSLATIONS);
		expect(r3).toEqual(TRANSLATIONS);
		expect(mock).toHaveBeenCalledTimes(1);
	});
});

// ── Cache key isolation ───────────────────────────────────────────────────────

describe("checkForUpdates — cache key isolation", () => {
	it("different locales are fetched independently", async () => {
		const mock = stubFetchSequence([
			{ status: 200, body: { a: "en" } },
			{ status: 200, body: { a: "es" } },
		]);
		const en = await checkForUpdates("en", FP);
		const es = await checkForUpdates("es", FP);
		expect(en).toEqual({ a: "en" });
		expect(es).toEqual({ a: "es" });
		expect(mock).toHaveBeenCalledTimes(2);
	});

	it("different fingerprints are fetched independently", async () => {
		const mock = stubFetchSequence([
			{ status: 200, body: { v: "1" } },
			{ status: 200, body: { v: "2" } },
		]);
		await checkForUpdates("en", "fp1");
		await checkForUpdates("en", "fp2");
		expect(mock).toHaveBeenCalledTimes(2);
	});
});

// ── URL construction ──────────────────────────────────────────────────────────

describe("checkForUpdates — URL construction", () => {
	it("CDN URL includes projectShortId, fingerprint, and locale", async () => {
		const mock = stubFetchSequence([{ status: 304 }]);
		await checkForUpdates("es", FP);
		const [url] = mock.mock.calls[0] as [string, unknown];
		expect(url).toBe(`https://cdn.test/testproj/${FP}/es.json`);
	});

	it("API fallback URL includes fingerprint and locale", async () => {
		const mock = stubFetchSequence([{ status: 404 }, { status: 304 }]);
		await checkForUpdates("es", FP);
		const [apiUrl] = mock.mock.calls[1] as [string, unknown];
		expect(apiUrl).toMatch(`https://api.test/api/t/${FP}/es`);
	});

	it("CDN request sends Accept: application/json header", async () => {
		const mock = stubFetchSequence([{ status: 304 }]);
		await checkForUpdates("en", FP);
		const [, init] = mock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>)["Accept"]).toBe(
			"application/json",
		);
	});
});
