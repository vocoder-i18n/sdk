import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { WHAT_HAPPENS, INIT_INSTRUCTIONS } from "../tools/init-status.js";
import { runSetup } from "../tools/setup.js";
import { runInitStart, runInitComplete, runProjectCreate } from "../tools/create-project.js";

vi.mock("@vocoder/plugin", () => ({
	detectRepoIdentity: vi.fn().mockReturnValue({ repoCanonical: "github:owner/repo", appDir: "" }),
	detectBranch: vi.fn().mockReturnValue("main"),
	detectCommitSha: vi.fn().mockReturnValue(null),
	computeFingerprint: vi.fn().mockReturnValue("fp_abc"),
}));

vi.mock("@vocoder/cli/lib", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@vocoder/cli/lib")>();
	return {
		...actual,
		VocoderAPI: vi.fn().mockImplementation(() => ({
			lookupAppByRepo: vi.fn().mockResolvedValue({ existingApps: [] }),
			startCliAuthSession: vi.fn().mockResolvedValue({
				sessionId: "sess-test-123",
				verificationUrl: "https://vocoder.app/verify?code=abc",
				expiresAt: new Date(Date.now() + 300000).toISOString(),
			}),
			pollCliAuthSession: vi.fn().mockResolvedValue({ status: "complete", token: "tok_test_abc" }),
			getCliUserInfo: vi.fn().mockResolvedValue({ userId: "user-1", email: "test@example.com", name: "Test" }),
			listOrganizations: vi.fn().mockResolvedValue({
				organizations: [{ id: "org-1", coversRepo: false }],
			}),
			createProject: vi.fn().mockResolvedValue({
				projectName: "my-app",
				apiKey: "vca_test123",
				sourceLocale: "en",
				targetLocales: ["es", "fr"],
				targetBranches: ["main", "develop"],
				repositoryBound: false,
				apps: [{ appDir: "", appId: "app_abc456" }],
			}),
		})),
		writeAuthData: vi.fn(),
		verifyStoredAuth: vi.fn().mockResolvedValue({ status: "missing" }),
		readAuthData: vi.fn().mockReturnValue(null),
		clearAuthData: vi.fn(),
	};
});

// ── WHAT_HAPPENS and INIT_INSTRUCTIONS: no GitHub App ─────────────────────────

describe("WHAT_HAPPENS", () => {
	it("does not mention GitHub App", () => {
		expect(WHAT_HAPPENS).not.toContain("GitHub App");
	});

	it("describes Vocoder sign-in and GitHub Actions workflow", () => {
		expect(WHAT_HAPPENS).toContain("Vocoder sign-in");
		expect(WHAT_HAPPENS).toContain(".github/workflows/vocoder.yml");
		expect(WHAT_HAPPENS).toContain("GitHub repository secret");
	});
});

describe("INIT_INSTRUCTIONS", () => {
	it("does not mention GitHub App", () => {
		expect(INIT_INSTRUCTIONS).not.toContain("GitHub App");
	});

	it("describes signing in to Vocoder account (not installing GitHub App)", () => {
		expect(INIT_INSTRUCTIONS).toContain("sign in to your Vocoder account");
	});

	it("includes GitHub repository secret setup step", () => {
		expect(INIT_INSTRUCTIONS).toContain("GitHub repository secret");
		expect(INIT_INSTRUCTIONS).toContain("Secrets and variables");
	});
});

// ── setup.ts authInstructions: no GitHub App ──────────────────────────────────

describe("runSetup authInstructions", () => {
	it("does not mention GitHub App when API key is missing", () => {
		const result = runSetup({}, false);
		expect(result.authInstructions).not.toBeNull();
		expect(result.authInstructions).not.toContain("GitHub App");
	});

	it("describes signing in to Vocoder account", () => {
		const result = runSetup({}, false);
		expect(result.authInstructions).toContain("sign in to your Vocoder account");
	});

	it("returns null authInstructions when API key is present", () => {
		const result = runSetup({}, true);
		expect(result.authInstructions).toBeNull();
	});
});

// ── runProjectCreate: instructions include workflow YAML and secret setup ──────

describe("runProjectCreate", () => {
	let sessionId: string;

	beforeEach(async () => {
		const startResult = await runInitStart({});
		sessionId = startResult.sessionId;
		await runInitComplete({ sessionId });
	});

	it("instructions include workflow YAML", async () => {
		const result = await runProjectCreate({
			sessionId,
			sourceLocale: "en",
			targetLocales: ["es", "fr"],
			targetBranches: ["main", "develop"],
		});
		expect(result.instructions).toContain("vocoder-i18n/translate-action@v1");
		expect(result.instructions).toContain(".github/workflows/vocoder.yml");
		expect(result.instructions).toContain("branches: ['main', 'develop']");
	});

	it("instructions include VOCODER_API_KEY secret setup", async () => {
		const result = await runProjectCreate({
			sessionId,
			sourceLocale: "en",
			targetLocales: ["es"],
			targetBranches: ["main"],
		});
		expect(result.instructions).toContain("GitHub repository secret");
		expect(result.instructions).toContain("Secrets and variables → Actions");
		expect(result.instructions).toContain("VOCODER_API_KEY");
	});

	it("instructions include git commit reminder for workflow file", async () => {
		const result = await runProjectCreate({
			sessionId,
			sourceLocale: "en",
			targetLocales: ["es"],
			targetBranches: ["main"],
		});
		expect(result.instructions).toContain("git add .github/workflows/vocoder.yml");
		expect(result.instructions).toContain("Add Vocoder translate workflow");
	});

	it("repoWarning does not mention GitHub App when repositoryBound=false", async () => {
		const result = await runProjectCreate({
			sessionId,
			sourceLocale: "en",
			targetLocales: ["es"],
			targetBranches: ["main"],
		});
		// repositoryBound=false is returned by the mock, and repoCanonical is set via detectRepoIdentity
		expect(result.instructions).not.toContain("GitHub App");
	});
});
