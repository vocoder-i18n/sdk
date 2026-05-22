/**
 * TUI convention enforcement tests.
 *
 * Invariants verified:
 *   1. Fatal exits (return 1) use p.log.error or spinner.stop(msg, 1) — never p.log.warn alone
 *   2. Non-fatal conditions (return 0 after warning) use p.log.warn — never p.log.error
 *   3. p.outro() is called on every exit path
 *   4. Spinner failures call spinner.stop with exit code 1
 *   5. Guidance / recovery lines use plain text — not p.log.error or p.log.warn
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ── Hoist mock refs so vi.mock factory can close over them ─────────────────────

const { mockIntro, mockOutro, mockLog, mockSpinner, mockNote } = vi.hoisted(() => {
	// biome-ignore lint/nursery/noShadow: vi.hoisted factory closes over names that match the outer destructuring — intentional vitest pattern
	const mockSpinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
	// biome-ignore lint/nursery/noShadow: same as above
	const mockLog = {
		success: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		message: vi.fn(),
	};
	return {
		mockIntro: vi.fn(),
		mockOutro: vi.fn(),
		mockLog,
		mockSpinner,
		mockNote: vi.fn(),
	};
});

vi.mock("@clack/prompts", () => ({
	intro: mockIntro,
	outro: mockOutro,
	log: mockLog,
	spinner: () => mockSpinner,
	note: mockNote,
	cancel: vi.fn(),
}));

// Prevent git calls from failing in non-git CI environments
vi.mock("../utils/git-identity.js", () => ({
	resolveGitRoot: vi.fn(() => process.cwd()),
	detectCommitSha: vi.fn(() => null),
	resolveGitRepositoryIdentity: vi.fn(() => null),
}));

const mockDetectBranch = vi.hoisted(() => vi.fn(() => "main"));

vi.mock("../utils/branch.js", () => ({
	detectBranch: mockDetectBranch,
	isTargetBranch: (branch: string, targets: string[]) => targets.includes(branch),
}));

vi.mock("../utils/workflow-read.js", () => ({
	readWorkflowBranches: vi.fn(() => null),
	readWorkflowCommitMode: vi.fn(() => null),
}));

vi.mock("@vocoder/extractor", () => ({
	loadVocoderConfig: vi.fn(() => null),
	computeFingerprint: vi.fn(() => "fp-test-123"),
}));

const {
	mockReadAuthData,
	mockVerifyStoredAuth,
	mockWriteAuthData,
} = vi.hoisted(() => ({
	mockReadAuthData: vi.fn(() => null as null | { token: string; email: string; apiUrl?: string }),
	mockVerifyStoredAuth: vi.fn(async () => ({ status: "none" as const })),
	mockWriteAuthData: vi.fn(),
}));

vi.mock("../utils/auth-store.js", () => ({
	readAuthData: mockReadAuthData,
	verifyStoredAuth: mockVerifyStoredAuth,
	writeAuthData: mockWriteAuthData,
	clearAuthData: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { addLocales, listProjectLocales } from "../commands/locales.js";
import { createProject } from "../commands/create-project.js";
import { translate } from "../commands/translate.js";

// ── Shared fixtures ────────────────────────────────────────────────────────────

const validApiKey = "vcp_aB3xY9Zk_testrandombytes123456";

const baseAppConfig = {
	projectName: "test-project",
	organizationName: "acme",
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

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeAll(() => {
	// Strip chalk ANSI codes so assertions match plain text
	process.env.NO_COLOR = "1";
});

beforeEach(() => {
	vi.clearAllMocks();
	process.env = { ...originalEnv, NO_COLOR: "1" };
	globalThis.fetch = originalFetch;
});

afterEach(() => {
	process.env = { ...originalEnv };
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

// ── 1. Fatal exits use p.log.error — never p.log.warn alone ───────────────────

describe("fatal-exit log level: p.log.error not p.log.warn", () => {
	it("translate: missing VOCODER_API_KEY", async () => {
		delete process.env.VOCODER_API_KEY;
		const code = await translate({});
		expect(code).toBe(1);
		expect(mockLog.error).toHaveBeenCalled();
		expect(mockLog.warn).not.toHaveBeenCalled();
	});

	it("addLocales: missing VOCODER_API_KEY", async () => {
		delete process.env.VOCODER_API_KEY;
		const code = await addLocales(["fr"]);
		expect(code).toBe(1);
		expect(mockLog.error).toHaveBeenCalled();
		expect(mockLog.warn).not.toHaveBeenCalled();
	});

	it("addLocales: empty locale array", async () => {
		process.env.VOCODER_API_KEY = validApiKey;
		const code = await addLocales([]);
		expect(code).toBe(1);
		expect(mockLog.error).toHaveBeenCalled();
		expect(mockLog.warn).not.toHaveBeenCalled();
	});

	it("listProjectLocales: missing VOCODER_API_KEY", async () => {
		delete process.env.VOCODER_API_KEY;
		const code = await listProjectLocales();
		expect(code).toBe(1);
		expect(mockLog.error).toHaveBeenCalled();
		expect(mockLog.warn).not.toHaveBeenCalled();
	});

	it("createProject: not logged in", async () => {
		mockReadAuthData.mockReturnValue(null);
		const code = await createProject({
			name: "my-app",
			sourceLocale: "en",
			organization: "org-1",
		});
		expect(code).toBe(1);
		expect(mockLog.error).toHaveBeenCalled();
		expect(mockLog.warn).not.toHaveBeenCalled();
	});
});

// ── 2. Non-fatal conditions use p.log.warn — not p.log.error ──────────────────

describe("non-fatal warning: p.log.warn not p.log.error", () => {
	it("translate: non-target branch skips and warns", async () => {
		process.env.VOCODER_API_KEY = validApiKey;
		mockDetectBranch.mockReturnValue("feat/skip-me");

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () =>
				JSON.stringify({ ...baseAppConfig, targetBranches: ["main"] }),
		}) as typeof globalThis.fetch;

		const code = await translate({});
		expect(code).toBe(0);
		expect(mockLog.warn).toHaveBeenCalled();
		expect(mockLog.error).not.toHaveBeenCalled();
	});
});

// ── 3. p.outro always called before return ────────────────────────────────────

describe("p.outro called on every exit path", () => {
	it("translate: missing API key", async () => {
		delete process.env.VOCODER_API_KEY;
		await translate({});
		expect(mockOutro).toHaveBeenCalled();
		expect(mockOutro.mock.calls.at(-1)?.[0]).not.toBe("");
	});

	it("translate: non-target branch (early exit, returns 0)", async () => {
		process.env.VOCODER_API_KEY = validApiKey;
		mockDetectBranch.mockReturnValue("feat/skip-me");

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () =>
				JSON.stringify({ ...baseAppConfig, targetBranches: ["main"] }),
		}) as typeof globalThis.fetch;

		await translate({});
		expect(mockOutro).toHaveBeenCalled();
		expect(mockOutro.mock.calls.at(-1)?.[0]).not.toBe("");
	});

	it("addLocales: missing API key", async () => {
		delete process.env.VOCODER_API_KEY;
		await addLocales(["fr"]);
		expect(mockOutro).toHaveBeenCalled();
		expect(mockOutro.mock.calls.at(-1)?.[0]).not.toBe("");
	});

	it("createProject: not logged in", async () => {
		mockReadAuthData.mockReturnValue(null);
		await createProject({ name: "my-app", sourceLocale: "en", organization: "org-1" });
		expect(mockOutro).toHaveBeenCalled();
		expect(mockOutro.mock.calls.at(-1)?.[0]).not.toBe("");
	});

	it("listProjectLocales: missing API key", async () => {
		delete process.env.VOCODER_API_KEY;
		await listProjectLocales();
		expect(mockOutro).toHaveBeenCalled();
		expect(mockOutro.mock.calls.at(-1)?.[0]).not.toBe("");
	});

	it("listProjectLocales: API call succeeds", async () => {
		process.env.VOCODER_API_KEY = validApiKey;
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () => JSON.stringify(baseAppConfig),
		}) as typeof globalThis.fetch;

		await listProjectLocales();
		expect(mockOutro).toHaveBeenCalled();
		expect(mockOutro.mock.calls.at(-1)?.[0]).not.toBe("");
	});
});

// ── 4. Spinner failures call spinner.stop with exit code 1 ────────────────────

describe("spinner.stop exit code 1 on failure", () => {
	it("addLocales: API error → spinner.stop(msg, 1)", async () => {
		process.env.VOCODER_API_KEY = validApiKey;
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 500,
			text: async () => JSON.stringify({ message: "Internal server error" }),
		}) as typeof globalThis.fetch;

		const code = await addLocales(["fr"]);
		expect(code).toBe(1);
		const stopCalls = mockSpinner.stop.mock.calls;
		expect(stopCalls.some(([, exitCode]) => exitCode === 1)).toBe(true);
	});

	it("addLocales: plan limit error → spinner.stop(msg, 1)", async () => {
		process.env.VOCODER_API_KEY = validApiKey;
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 403,
			text: async () =>
				JSON.stringify({
					errorCode: "LIMIT_EXCEEDED",
					limitType: "target_locales",
					planId: "free",
					current: 2,
					required: 3,
					upgradeUrl: "https://vocoder.app/upgrade",
					message: "Your Free plan allows up to 2 target locales.",
				}),
		}) as typeof globalThis.fetch;

		const code = await addLocales(["pt-BR"]);
		expect(code).toBe(1);
		const stopCalls = mockSpinner.stop.mock.calls;
		expect(stopCalls.some(([, exitCode]) => exitCode === 1)).toBe(true);
	});
});

// ── 5. Guidance lines use plain text — not p.log.error or p.log.warn ──────────

describe("guidance lines use plain text after errors", () => {
	it("addLocales: limit error guidance appears as plain text", async () => {
		process.env.VOCODER_API_KEY = validApiKey;
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 403,
			text: async () =>
				JSON.stringify({
					errorCode: "LIMIT_EXCEEDED",
					limitType: "target_locales",
					planId: "free",
					current: 2,
					required: 3,
					upgradeUrl: "https://vocoder.app/upgrade",
					message: "Your Free plan allows up to 2 target locales.",
				}),
		}) as typeof globalThis.fetch;

		await addLocales(["pt-BR"]);

		// Primary error: spinner.stop with the limit message and exit code 1
		expect(mockSpinner.stop).toHaveBeenCalledWith(
			expect.stringContaining("Free plan"),
			1,
		);
		// Guidance: plain text is used for upgrade URL and context lines
		expect(mockLog.message).toHaveBeenCalled();
		// No p.log.error — message is in spinner.stop
		expect(mockLog.error).not.toHaveBeenCalled();
		// No secondary warn after the error
		expect(mockLog.warn).not.toHaveBeenCalled();
	});

	it("translate: non-target branch details do not use blue info dots", async () => {
		process.env.VOCODER_API_KEY = validApiKey;
		mockDetectBranch.mockReturnValue("feat/skip-me");

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			text: async () =>
				JSON.stringify({ ...baseAppConfig, targetBranches: ["main"] }),
		}) as typeof globalThis.fetch;

		await translate({});

		// Branch metadata is a primary green row, not a blue info dot
		const successCalls = mockLog.success.mock.calls.map(([msg]) => String(msg));
		expect(successCalls.some((m) => m.includes("Target branches"))).toBe(true);
		expect(mockLog.info).not.toHaveBeenCalled();
	});
});

describe("style bans", () => {
	it("does not use p.note anywhere in CLI source", () => {
		function walk(dir: string): string[] {
			const entries = readdirSync(dir, { withFileTypes: true });
			const files: string[] = [];
			for (const entry of entries) {
				const fullPath = join(dir, entry.name);
				if (entry.isDirectory()) {
					if (entry.name === "__tests__") continue;
					files.push(...walk(fullPath));
				} else if (entry.isFile() && fullPath.endsWith(".ts")) {
					files.push(fullPath);
				}
			}
			return files;
		}

		const sourceRoot = join(process.cwd(), "src");
		for (const file of walk(sourceRoot)) {
			const contents = readFileSync(file, "utf-8");
			expect(contents).not.toMatch(/\bp\.note\(/);
			expect(contents).not.toMatch(/\bp\.log\.info\(/);
		}
	});
});
