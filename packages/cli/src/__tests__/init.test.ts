import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockIntro,
	mockOutro,
	mockLog,
	mockLookupAppByRepo,
	mockGetAppConfig,
	mockRegenerateProjectApiKey,
	mockEnsureAccountAuth,
	mockSelectOrganizationForInit,
	mockCheckPlanLimits,
	mockRunProjectCreate,
	mockPromptConfirm,
	mockInstallForProject,
	mockWriteApiKeyToEnv,
	mockWriteGitHubActionsWorkflow,
	mockResolveGitContext,
	mockResolveCurrentAppDir,
} = vi.hoisted(() => ({
	mockIntro: vi.fn(),
	mockOutro: vi.fn(),
	mockLog: {
		success: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		message: vi.fn(),
	},
	mockLookupAppByRepo: vi.fn(),
	mockGetAppConfig: vi.fn(),
	mockRegenerateProjectApiKey: vi.fn(),
	mockEnsureAccountAuth: vi.fn(),
	mockSelectOrganizationForInit: vi.fn(),
	mockCheckPlanLimits: vi.fn(),
	mockRunProjectCreate: vi.fn(),
	mockPromptConfirm: vi.fn(),
	mockInstallForProject: vi.fn(),
	mockWriteApiKeyToEnv: vi.fn(),
	mockWriteGitHubActionsWorkflow: vi.fn(),
	mockResolveGitContext: vi.fn(),
	mockResolveCurrentAppDir: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	intro: mockIntro,
	outro: mockOutro,
	log: mockLog,
	spinner: () => ({
		start: vi.fn(),
		stop: vi.fn(),
		message: vi.fn(),
	}),
}));

vi.mock("../utils/api.js", () => ({
	VocoderAPI: class {
		lookupAppByRepo = mockLookupAppByRepo;
		getAppConfig = mockGetAppConfig;
		regenerateProjectApiKey = mockRegenerateProjectApiKey;
	},
	VocoderAPIError: class extends Error {
		status: number;
		payload: unknown;
		limitError: null = null;
		syncPolicyError: null = null;
		constructor(params: { message: string; status: number; payload: unknown }) {
			super(params.message);
			this.status = params.status;
			this.payload = params.payload;
		}
	},
}));

vi.mock("../utils/account-auth.js", () => ({
	ensureAccountAuth: mockEnsureAccountAuth,
}));

vi.mock("../utils/organization-select.js", () => ({
	selectOrganizationForInit: mockSelectOrganizationForInit,
}));

vi.mock("../utils/plan-check.js", () => ({
	checkPlanLimits: mockCheckPlanLimits,
	isPlanLimitFailure: vi.fn(() => false),
	printPlanLimitMessage: vi.fn(),
}));

vi.mock("../utils/project-create.js", () => ({
	runProjectCreate: mockRunProjectCreate,
}));

vi.mock("../utils/prompt-select.js", () => ({
	promptConfirm: mockPromptConfirm,
}));

vi.mock("../utils/install-packages.js", () => ({
	installForProject: mockInstallForProject,
}));

vi.mock("../utils/output.js", () => ({
	writeApiKeyToEnv: mockWriteApiKeyToEnv,
}));

vi.mock("../utils/workflow-write.js", () => ({
	writeGitHubActionsWorkflow: mockWriteGitHubActionsWorkflow,
}));

vi.mock("../utils/git-identity.js", () => ({
	resolveGitContext: mockResolveGitContext,
	resolveCurrentAppDir: mockResolveCurrentAppDir,
}));

import { init } from "../commands/init.js";

const repoRoot = "/repo";
const repoCanonical = "github:acme/example";
const baseAuth = {
	status: "authenticated" as const,
	source: "stored" as const,
	auth: {
		token: "user-token",
		userId: "user-1",
		email: "user@example.com",
		name: "User",
		createdAt: new Date().toISOString(),
	},
};

const baseProjectConfig = {
	projectName: "Example",
	organizationName: "Acme",
	sourceLocale: "en",
	targetLocales: ["fr"],
	targetBranches: ["main"],
	syncPolicy: {
		blockingBranches: ["main"],
		blockingMode: "required" as const,
		nonBlockingMode: "best-effort" as const,
		defaultMaxWaitMs: 60000,
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	process.env.NO_COLOR = "1";
	process.env.VOCODER_API_URL = "https://vocoder.app";
	delete process.env.VOCODER_API_KEY;
	Object.defineProperty(process.stdin, "isTTY", {
		value: true,
		configurable: true,
	});
	Object.defineProperty(process.stdout, "isTTY", {
		value: true,
		configurable: true,
	});
	mockResolveGitContext.mockReturnValue({
		identity: { repoCanonical, repoRoot },
		warnings: [],
	});
	mockResolveCurrentAppDir.mockReturnValue("apps/vite");
	mockEnsureAccountAuth.mockResolvedValue(baseAuth);
	mockPromptConfirm.mockResolvedValue(false);
	mockInstallForProject.mockResolvedValue(undefined);
	mockWriteApiKeyToEnv.mockReturnValue(".env.local");
	mockWriteGitHubActionsWorkflow.mockReturnValue({
		path: `${repoRoot}/.github/workflows/vocoder-translate.yml`,
		relativePath: ".github/workflows/vocoder-translate.yml",
		written: true,
	});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("init", () => {
	it("runs the fresh setup flow when the repo is not configured yet", async () => {
		mockLookupAppByRepo.mockResolvedValue({
			exactMatch: null,
			existingApps: [],
			hasWholeRepoApp: false,
			organizationContext: null,
		});
		mockSelectOrganizationForInit.mockResolvedValue({ organizationId: "org-1" });
		mockCheckPlanLimits.mockResolvedValue({ atLimit: false, remaining: 3 });
		mockRunProjectCreate.mockResolvedValue({
			projectId: "proj-1",
			projectName: "Example",
			apiKey: "vcp_new",
			sourceLocale: "en",
			targetLocales: ["fr"],
			targetBranches: ["main"],
			repositoryBound: true,
			appDirs: ["apps/vite"],
		});

		const code = await init();

		expect(code).toBe(0);
		expect(mockRunProjectCreate).toHaveBeenCalled();
		expect(mockWriteApiKeyToEnv).toHaveBeenCalledWith("vcp_new", repoRoot);
	});

	it("repairs local setup for an exact app match", async () => {
		process.env.VOCODER_API_KEY = "vcp_existing";
		mockLookupAppByRepo.mockResolvedValue({
			exactMatch: {
				appId: "app-1",
				projectId: "proj-1",
				projectName: "Example",
				organizationName: "Acme",
				targetBranches: ["main"],
			},
			existingApps: [{ appDir: "apps/vite", appId: "app-1", projectId: "proj-1", projectName: "Example", organizationName: "Acme" }],
			hasWholeRepoApp: false,
			organizationContext: null,
		});
		mockGetAppConfig.mockResolvedValue(baseProjectConfig);

		const code = await init();

		expect(code).toBe(0);
		expect(mockRunProjectCreate).not.toHaveBeenCalled();
		expect(mockInstallForProject).toHaveBeenCalledWith(
			expect.objectContaining({ rootDir: repoRoot, appDirs: ["apps/vite"] }),
		);
	});

	it("repairs local setup against the whole-repo app when present", async () => {
		process.env.VOCODER_API_KEY = "vcp_existing";
		mockLookupAppByRepo.mockResolvedValue({
			exactMatch: null,
			existingApps: [{ appDir: "", appId: "app-root", projectId: "proj-1", projectName: "Example", organizationName: "Acme" }],
			hasWholeRepoApp: true,
			organizationContext: null,
		});
		mockGetAppConfig.mockResolvedValue(baseProjectConfig);

		const code = await init();

		expect(code).toBe(0);
		expect(mockInstallForProject).toHaveBeenCalledWith(
			expect.objectContaining({ rootDir: repoRoot, appDirs: [] }),
		);
	});

	it("regenerates a missing project key when the user confirms repair", async () => {
		mockLookupAppByRepo.mockResolvedValue({
			exactMatch: {
				appId: "app-1",
				projectId: "proj-1",
				projectName: "Example",
				organizationName: "Acme",
				targetBranches: ["main"],
			},
			existingApps: [{ appDir: "apps/vite", appId: "app-1", projectId: "proj-1", projectName: "Example", organizationName: "Acme" }],
			hasWholeRepoApp: false,
			organizationContext: null,
		});
		mockPromptConfirm
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		mockRegenerateProjectApiKey.mockResolvedValue({ apiKey: "vcp_new" });
		mockGetAppConfig.mockResolvedValue(baseProjectConfig);

		const code = await init();

		expect(code).toBe(0);
		expect(mockRegenerateProjectApiKey).toHaveBeenCalledWith("user-token", "proj-1");
		expect(mockWriteApiKeyToEnv).toHaveBeenCalledWith("vcp_new", repoRoot);
	});

	it("stops with a clear error when the repo is known but the current app dir is not configured", async () => {
		mockLookupAppByRepo.mockResolvedValue({
			exactMatch: null,
			existingApps: [
				{
					appDir: "apps/web",
					appId: "app-1",
					projectId: "proj-1",
					projectName: "Example",
					organizationName: "Acme",
				},
			],
			hasWholeRepoApp: false,
			organizationContext: null,
		});

		const code = await init();

		expect(code).toBe(1);
		expect(mockRunProjectCreate).not.toHaveBeenCalled();
		expect(mockLog.error).toHaveBeenCalledWith(
			"This directory is not configured as a Vocoder app.",
		);
	});
});
