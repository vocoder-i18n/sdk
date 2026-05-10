import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranslationStringEntry } from "../types.js";
import { VocoderAPI } from "../utils/api.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
	vi.restoreAllMocks();
	globalThis.fetch = originalFetch;
});

describe("VocoderAPI submitTranslation", () => {
	it("sends only stringEntries when given string[] input", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () =>
				JSON.stringify({
					batchId: "batch-1",
					newStrings: 2,
					totalStrings: 2,
					status: "PENDING",
				}),
		});
		globalThis.fetch = mockFetch as typeof globalThis.fetch;

		const api = new VocoderAPI({
			apiKey: "test-key",
			apiUrl: "https://vocoder.app",
		});

		await api.submitTranslation("main", ["Second", "First"], ["es"]);

		expect(mockFetch).toHaveBeenCalledTimes(1);
		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(String(init.body)) as Record<string, unknown>;

		expect(url).toBe("https://vocoder.app/api/cli/sync");
		expect(body.branch).toBe("main");
		expect(body.targetLocales).toEqual(["es"]);
		expect(body.stringEntries).toEqual([
			{ key: "SK_TEXT_F486B7FD", text: "Second" },
			{ key: "SK_TEXT_EE3D49E1", text: "First" },
		]);
		expect(body).not.toHaveProperty("strings");

		// stringsHash is computed from sorted source keys (not texts).
		// Format: SHA-256 of JSON.stringify({ strings: sortedKeys, industry: null }).
		const crypto = await import("node:crypto");
		const expectedHash = crypto
			.createHash("sha256")
			.update(
				JSON.stringify({
					strings: ["SK_TEXT_EE3D49E1", "SK_TEXT_F486B7FD"],
					industry: null,
				}),
			)
			.digest("hex");
		expect(body.stringsHash).toBe(expectedHash);
	});

	it("preserves context/formality metadata in stringEntries payload", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () =>
				JSON.stringify({
					batchId: "batch-2",
					newStrings: 1,
					totalStrings: 1,
					status: "PENDING",
				}),
		});
		globalThis.fetch = mockFetch as typeof globalThis.fetch;

		const api = new VocoderAPI({
			apiKey: "test-key",
			apiUrl: "https://vocoder.app",
		});

		const entries: TranslationStringEntry[] = [
			{
				key: "SK_EXAMPLE_123",
				text: "Save",
				context: "button label",
				formality: "formal",
			},
		];

		await api.submitTranslation(
			"feature",
			entries,
			["de"],
			{
				requestedMode: "best-effort",
				requestedMaxWaitMs: 15000,
				clientRunId: "run_123",
			},
			{
				repoCanonical: "github:owner/repo",
				repoAppDir: "src",
			},
		);

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(String(init.body)) as Record<string, unknown>;

		expect(body.stringEntries).toEqual(entries);
		expect(body.repoCanonical).toBe("github:owner/repo");
		expect(body.repoAppDir).toBe("src");
		expect(body.requestedMode).toBe("best-effort");
		expect(body.requestedMaxWaitMs).toBe(15000);
		expect(body.clientRunId).toBe("run_123");
		expect(body).not.toHaveProperty("strings");
	});
});
