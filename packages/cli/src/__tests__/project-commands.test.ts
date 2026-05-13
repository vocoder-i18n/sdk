import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLocales, listProjectLocales, removeLocales } from "../commands/locales.js";
import { pull } from "../commands/pull.js";
import type { APIAppConfig, TranslationSnapshotResponse } from "../types.js";
import { VocoderAPI } from "../utils/api.js";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
	vi.restoreAllMocks();
	globalThis.fetch = originalFetch;
	process.env = { ...originalEnv };
});

// ── VocoderAPI.addLocale ──────────────────────────────────────────────────────

describe("VocoderAPI.addLocale", () => {
	it("sends POST with locale and returns updated targetLocales", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => JSON.stringify({ targetLocales: ["fr", "de"] }),
		});
		globalThis.fetch = mockFetch as typeof globalThis.fetch;

		const api = new VocoderAPI({ apiKey: "vca_test", apiUrl: "https://vocoder.app" });
		const result = await api.addLocale("de");

		expect(result.targetLocales).toEqual(["fr", "de"]);
		expect(mockFetch).toHaveBeenCalledWith(
			"https://vocoder.app/api/project/locales",
			expect.objectContaining({
				method: "POST",
				body: expect.stringContaining('"locale":"de"'),
			}),
		);
	});

	it("throws VocoderAPIError with limitError when plan limit is exceeded", async () => {
		const payload = {
			errorCode: "LIMIT_EXCEEDED",
			limitType: "target_locales",
			planId: "free",
			current: 2,
			required: 3,
			upgradeUrl: "https://vocoder.app/settings/billing",
			message: "Your Free plan allows up to 2 target locales.",
		};

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 403,
			text: async () => JSON.stringify(payload),
		}) as typeof globalThis.fetch;

		const api = new VocoderAPI({ apiKey: "vca_test", apiUrl: "https://vocoder.app" });

		await expect(api.addLocale("pt-BR")).rejects.toMatchObject({
			limitError: expect.objectContaining({ limitType: "target_locales" }),
		});
	});
});

// ── VocoderAPI.removeLocale ───────────────────────────────────────────────────

describe("VocoderAPI.removeLocale", () => {
	it("sends DELETE with locale and returns updated targetLocales", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => JSON.stringify({ targetLocales: ["fr"] }),
		});
		globalThis.fetch = mockFetch as typeof globalThis.fetch;

		const api = new VocoderAPI({ apiKey: "vca_test", apiUrl: "https://vocoder.app" });
		const result = await api.removeLocale("de");

		expect(result.targetLocales).toEqual(["fr"]);
		expect(mockFetch).toHaveBeenCalledWith(
			"https://vocoder.app/api/project/locales",
			expect.objectContaining({
				method: "DELETE",
				body: expect.stringContaining('"locale":"de"'),
			}),
		);
	});

	it("is idempotent — succeeds when locale is not configured", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => JSON.stringify({ targetLocales: ["fr"] }),
		}) as typeof globalThis.fetch;

		const api = new VocoderAPI({ apiKey: "vca_test", apiUrl: "https://vocoder.app" });
		// "de" was never in the list — backend returns current list unchanged
		const result = await api.removeLocale("de");
		expect(result.targetLocales).toEqual(["fr"]);
	});
});

// ── addLocales command ────────────────────────────────────────────────────────

describe("addLocales command", () => {
	beforeEach(() => {
		process.env.VOCODER_API_KEY = "vca_test";
	});

	it("returns 0 and calls addLocale once per locale", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => JSON.stringify({ targetLocales: ["fr", "de"] }),
		});
		globalThis.fetch = mockFetch as typeof globalThis.fetch;

		const code = await addLocales(["fr", "de"]);

		expect(code).toBe(0);
		// Two locales = two POST requests
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it("returns 1 and prints upgrade message on plan limit error", async () => {
		const payload = {
			errorCode: "LIMIT_EXCEEDED",
			limitType: "target_locales",
			planId: "free",
			current: 2,
			required: 3,
			upgradeUrl: "https://vocoder.app/settings/billing",
			message: "Your Free plan allows up to 2 target locales.",
		};

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 403,
			text: async () => JSON.stringify(payload),
		}) as typeof globalThis.fetch;

		const code = await addLocales(["pt-BR"]);
		expect(code).toBe(1);
	});

	it("returns 1 when VOCODER_API_KEY is missing", async () => {
		delete process.env.VOCODER_API_KEY;
		const code = await addLocales(["fr"]);
		expect(code).toBe(1);
	});
});

// ── removeLocales command ─────────────────────────────────────────────────────

describe("removeLocales command", () => {
	beforeEach(() => {
		process.env.VOCODER_API_KEY = "vca_test";
	});

	it("returns 0 and calls removeLocale once per locale", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => JSON.stringify({ targetLocales: ["fr"] }),
		});
		globalThis.fetch = mockFetch as typeof globalThis.fetch;

		const code = await removeLocales(["de"]);
		expect(code).toBe(0);
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it("handles locale not present gracefully (idempotent)", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => JSON.stringify({ targetLocales: ["fr"] }),
		}) as typeof globalThis.fetch;

		// "pt-BR" was never there — should still succeed
		const code = await removeLocales(["pt-BR"]);
		expect(code).toBe(0);
	});
});

// ── listProjectLocales command ────────────────────────────────────────────────

describe("listProjectLocales command", () => {
	beforeEach(() => {
		process.env.VOCODER_API_KEY = "vca_test";
	});

	it("returns 0 when project config loads successfully", async () => {
		const config: APIAppConfig = {
			projectName: "Test",
			organizationName: "Acme",
			shortCode: "test123",
			sourceLocale: "en",
			targetLocales: ["fr", "de"],
			targetBranches: ["main"],
			syncPolicy: {
				blockingBranches: ["main"],
				blockingMode: "required",
				nonBlockingMode: "best-effort",
				defaultMaxWaitMs: 60000,
			},
		};

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => JSON.stringify(config),
		}) as typeof globalThis.fetch;

		const code = await listProjectLocales();
		expect(code).toBe(0);
	});

	it("returns 1 when VOCODER_API_KEY is missing", async () => {
		delete process.env.VOCODER_API_KEY;
		const code = await listProjectLocales();
		expect(code).toBe(1);
	});
});

// ── pull command ───────────────────────────────────────────────────

describe("pull command", () => {
	beforeEach(() => {
		process.env.VOCODER_API_KEY = "vca_test";
	});

	it("writes one file per locale when --output is set", async () => {
		const config: APIAppConfig = {
			projectName: "Test",
			organizationName: "Acme",
			shortCode: "test123",
			sourceLocale: "en",
			targetLocales: ["fr", "de"],
			targetBranches: ["main"],
			syncPolicy: {
				blockingBranches: ["main"],
				blockingMode: "required",
				nonBlockingMode: "best-effort",
				defaultMaxWaitMs: 60000,
			},
		};

		const snapshot: TranslationSnapshotResponse = {
			status: "FOUND",
			branch: "main",
			translations: {
				fr: { Hello: "Bonjour", Goodbye: "Au revoir" },
				de: { Hello: "Hallo", Goodbye: "Auf Wiedersehen" },
			},
		};

		globalThis.fetch = vi
			.fn()
			// First call: getProjectConfig
			.mockResolvedValueOnce({
				ok: true,
				text: async () => JSON.stringify(config),
			})
			// Second call: getTranslationSnapshot
			.mockResolvedValueOnce({
				ok: true,
				text: async () => JSON.stringify(snapshot),
			}) as typeof globalThis.fetch;

		const outputDir = join(tmpdir(), `vocoder-test-${Date.now()}`);
		mkdirSync(outputDir, { recursive: true });

		const code = await pull({ branch: "main", output: outputDir });
		expect(code).toBe(0);

		const frContents = JSON.parse(readFileSync(join(outputDir, "fr.json"), "utf-8"));
		expect(frContents).toEqual({ Hello: "Bonjour", Goodbye: "Au revoir" });

		const deContents = JSON.parse(readFileSync(join(outputDir, "de.json"), "utf-8"));
		expect(deContents).toEqual({ Hello: "Hallo", Goodbye: "Auf Wiedersehen" });
	});

	it("returns 1 when snapshot is NOT_FOUND", async () => {
		const config: APIAppConfig = {
			projectName: "Test",
			organizationName: "Acme",
			shortCode: "test123",
			sourceLocale: "en",
			targetLocales: ["fr"],
			targetBranches: ["main"],
			syncPolicy: {
				blockingBranches: ["main"],
				blockingMode: "required",
				nonBlockingMode: "best-effort",
				defaultMaxWaitMs: 60000,
			},
		};

		const snapshot: TranslationSnapshotResponse = {
			status: "NOT_FOUND",
			branch: "main",
		};

		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify(config) })
			.mockResolvedValueOnce({
				ok: true,
				text: async () => JSON.stringify(snapshot),
			}) as typeof globalThis.fetch;

		const code = await pull({ branch: "main" });
		expect(code).toBe(1);
	});

	it("returns 1 when VOCODER_API_KEY is missing", async () => {
		delete process.env.VOCODER_API_KEY;
		const code = await pull({ branch: "main" });
		expect(code).toBe(1);
	});
});

// ── VocoderAPI.createProject new response shape ───────────────────────────────

describe("VocoderAPI.createProject", () => {
	it("parses apps array from response", async () => {
		const payload = {
			projectId: "proj123",
			projectName: "my-app",
			apiKey: "vcp_test",
			sourceLocale: "en",
			targetLocales: ["fr"],
			targetBranches: ["main"],
			repositoryBound: true,
			apps: [
				{ appDir: "apps/web", appId: "app1" },
				{ appDir: "apps/api", appId: "app2" },
			],
		};
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => JSON.stringify(payload),
		}) as typeof globalThis.fetch;

		const api = new VocoderAPI({ apiKey: "", apiUrl: "https://vocoder.app" });
		const result = await api.createProject("user_token", {
			organizationId: "org1",
			name: "my-app",
			sourceLocale: "en",
			targetLocales: ["fr"],
			targetBranches: ["main"],
			appDirs: ["apps/web", "apps/api"],
		});

		expect(result.apps).toHaveLength(2);
		expect(result.apps[0]).toEqual({ appDir: "apps/web", appId: "app1" });
		expect(result.apps[1]).toEqual({ appDir: "apps/api", appId: "app2" });
		expect(result.apiKey).toBe("vcp_test");
	});

	it("returns single app in apps array for non-monorepo project", async () => {
		const payload = {
			projectId: "proj123",
			projectName: "my-app",
			apiKey: "vcp_test",
			sourceLocale: "en",
			targetLocales: ["fr"],
			targetBranches: ["main"],
			repositoryBound: false,
			apps: [{ appDir: "", appId: "app1" }],
		};
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => JSON.stringify(payload),
		}) as typeof globalThis.fetch;

		const api = new VocoderAPI({ apiKey: "", apiUrl: "https://vocoder.app" });
		const result = await api.createProject("user_token", {
			organizationId: "org1",
			name: "my-app",
			sourceLocale: "en",
			targetLocales: ["fr"],
			targetBranches: ["main"],
			appDirs: [],
		});

		expect(result.apps).toHaveLength(1);
		expect(result.apps[0]).toEqual({ appDir: "", appId: "app1" });
	});
});
