import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	NO_API_KEY_MESSAGE,
	VocoderClient,
	createClient,
} from "../client.js";

const TEST_API_URL = "https://api.example.com";
const TEST_API_KEY = "vca_test_key_123";

describe("NO_API_KEY_MESSAGE", () => {
	it("contains instructions to run init", () => {
		expect(NO_API_KEY_MESSAGE).toContain("VOCODER_API_KEY");
		expect(NO_API_KEY_MESSAGE).toContain("npx @vocoder/cli init");
	});
});

describe("createClient", () => {
	beforeEach(() => {
		delete process.env.VOCODER_API_KEY;
		delete process.env.VOCODER_API_URL;
	});

	it("returns null when VOCODER_API_KEY is not set", () => {
		expect(createClient()).toBeNull();
	});

	it("returns a VocoderClient instance when VOCODER_API_KEY is set", () => {
		process.env.VOCODER_API_KEY = TEST_API_KEY;
		const client = createClient();
		expect(client).toBeInstanceOf(VocoderClient);
	});

	afterEach(() => {
		delete process.env.VOCODER_API_KEY;
		delete process.env.VOCODER_API_URL;
	});
});

describe("VocoderClient", () => {
	let client: VocoderClient;

	beforeEach(() => {
		client = new VocoderClient(TEST_API_KEY, TEST_API_URL);
		global.fetch = vi.fn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function mockFetch(status: number, body: unknown): void {
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
			ok: status >= 200 && status < 300,
			status,
			statusText: status === 200 ? "OK" : "Error",
			json: () => Promise.resolve(body),
			text: () => Promise.resolve(JSON.stringify(body)),
		});
	}

	describe("getConfig", () => {
		it("makes GET request to /api/cli/config", async () => {
			const config = { sourceLocale: "en", targetLocales: ["fr"], locales: {} };
			mockFetch(200, config);
			const result = await client.getConfig();
			expect(result).toEqual(config);
			expect(global.fetch).toHaveBeenCalledWith(
				`${TEST_API_URL}/api/cli/config`,
				expect.objectContaining({ method: "GET" }),
			);
		});

		it("appends repoCanonical query param when provided", async () => {
			mockFetch(200, {});
			await client.getConfig("github:owner/repo");
			const url = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0];
			expect(url).toContain("repoCanonical=github%3Aowner%2Frepo");
		});
	});

	describe("translate", () => {
		it("makes POST request to /api/cli/translate", async () => {
			const translateResponse = { jobId: "job-123" };
			mockFetch(202, translateResponse);

			const result = await client.translate({
				branch: "main",
				stringEntries: [{ key: "abc123", text: "Hello" }],
				targetLocales: ["fr"],
			});

			expect(result).toEqual(translateResponse);
			expect(global.fetch).toHaveBeenCalledWith(
				`${TEST_API_URL}/api/cli/translate`,
				expect.objectContaining({ method: "POST" }),
			);
		});

		it("returns status=complete and fingerprint on cache hit", async () => {
			const cachedResponse = { jobId: "job-456", status: "complete", fingerprint: "fp_abc" };
			mockFetch(200, cachedResponse);

			const result = await client.translate({
				branch: "main",
				stringEntries: [],
				targetLocales: ["fr"],
				stringsHash: "abc123",
			});

			expect(result.status).toBe("complete");
			expect(result.fingerprint).toBe("fp_abc");
		});
	});

	describe("getTranslateStatus", () => {
		it("makes GET request for job status", async () => {
			mockFetch(200, { status: "complete", progress: { completed: 5, total: 5 } });
			const result = await client.getTranslateStatus("job-abc");
			expect(result.status).toBe("complete");
			expect(global.fetch).toHaveBeenCalledWith(
				`${TEST_API_URL}/api/cli/translate/job-abc/status`,
				expect.objectContaining({ method: "GET" }),
			);
		});

		it("surfaces failure status and error message", async () => {
			mockFetch(200, { status: "failed", progress: { completed: 0, total: 5 }, error: "DeepL quota exceeded" });
			const result = await client.getTranslateStatus("job-xyz");
			expect(result.status).toBe("failed");
			expect(result.error).toBe("DeepL quota exceeded");
		});
	});

	describe("addLocale / removeLocale", () => {
		it("addLocale posts to /api/cli/app/locales", async () => {
			mockFetch(200, { targetLocales: ["fr", "de"] });
			const result = await client.addLocale("de");
			expect(result.targetLocales).toContain("de");
		});

		it("removeLocale deletes from /api/cli/app/locales", async () => {
			mockFetch(200, { targetLocales: ["fr"] });
			const result = await client.removeLocale("de");
			expect(result.targetLocales).not.toContain("de");
			expect(global.fetch).toHaveBeenCalledWith(
				`${TEST_API_URL}/api/cli/app/locales`,
				expect.objectContaining({ method: "DELETE" }),
			);
		});
	});

	describe("error handling", () => {
		it("throws on non-ok HTTP response", async () => {
			mockFetch(500, { message: "Internal Server Error" });
			await expect(client.getConfig()).rejects.toThrow("Vocoder API error 500");
		});

		it("throws plan limit error with upgrade URL on 403 LIMIT_EXCEEDED", async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
				ok: false,
				status: 403,
				statusText: "Forbidden",
				json: () => Promise.resolve({
					errorCode: "LIMIT_EXCEEDED",
					message: "You've reached your plan limit.",
					upgradeUrl: "https://vocoder.app/settings/billing",
				}),
				text: () =>
					Promise.resolve(
						JSON.stringify({
							errorCode: "LIMIT_EXCEEDED",
							message: "You've reached your plan limit.",
							upgradeUrl: "https://vocoder.app/settings/billing",
						}),
					),
			});

			await expect(client.getConfig()).rejects.toThrow(
				"You've reached your plan limit.",
			);
		});

		it("includes Authorization header with Bearer token", async () => {
			mockFetch(200, {});
			await client.getConfig().catch(() => {});
			const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
			expect(options.headers.Authorization).toBe(`Bearer ${TEST_API_KEY}`);
		});
	});
});
