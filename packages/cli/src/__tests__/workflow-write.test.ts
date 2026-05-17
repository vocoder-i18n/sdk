import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	renderWorkflowYaml,
	writeGitHubActionsWorkflow,
} from "../utils/workflow-write.js";
import { readWorkflowCommitMode } from "../utils/workflow-read.js";

describe("renderWorkflowYaml", () => {
	it("renders a single branch with quotes", () => {
		const yaml = renderWorkflowYaml(["main"]);
		expect(yaml).toContain("branches: ['main']");
	});

	it("renders multiple branches comma-separated", () => {
		const yaml = renderWorkflowYaml(["main", "release/v2", "staging"]);
		expect(yaml).toContain("branches: ['main', 'release/v2', 'staging']");
	});

	it("references the published action by its versioned tag", () => {
		const yaml = renderWorkflowYaml(["main"]);
		expect(yaml).toContain("uses: vocoder-i18n/translate-action@v1");
	});

	it("passes the VOCODER_API_KEY secret as the api-key input", () => {
		const yaml = renderWorkflowYaml(["main"]);
		expect(yaml).toContain("api-key: ${{ secrets.VOCODER_API_KEY }}");
	});

	it("sets on-failure to proceed so translation errors do not block the build", () => {
		const yaml = renderWorkflowYaml(["main"]);
		expect(yaml).toContain("on-failure: proceed");
	});

	it("omits app-dirs line when no appDirs provided", () => {
		const yaml = renderWorkflowYaml(["main"]);
		expect(yaml).not.toContain("app-dirs:");
	});

	it("omits app-dirs line when appDirs is empty array", () => {
		const yaml = renderWorkflowYaml(["main"], []);
		expect(yaml).not.toContain("app-dirs:");
	});

	it("includes app-dirs line when appDirs are provided", () => {
		const yaml = renderWorkflowYaml(["main"], ["apps/web", "apps/admin"]);
		expect(yaml).toContain("app-dirs: apps/web,apps/admin");
	});

	it("skips empty string entries in appDirs", () => {
		const yaml = renderWorkflowYaml(["main"], ["apps/web", ""]);
		expect(yaml).toContain("app-dirs: apps/web");
		expect(yaml).not.toContain(",");
	});

	it("checks out the repo before running the action", () => {
		const yaml = renderWorkflowYaml(["main"]);
		const checkoutIdx = yaml.indexOf("actions/checkout@v4");
		const actionIdx = yaml.indexOf("vocoder-i18n/translate-action");
		expect(checkoutIdx).toBeGreaterThan(-1);
		expect(actionIdx).toBeGreaterThan(checkoutIdx);
	});
});

describe("commit-mode and permissions", () => {
	it("PR mode (default): includes pull-requests: write permission", () => {
		const yaml = renderWorkflowYaml(["main"]);
		expect(yaml).toContain("pull-requests: write");
	});

	it("PR mode: includes commit-mode: pr input", () => {
		const yaml = renderWorkflowYaml(["main"], undefined, "PR");
		expect(yaml).toContain("commit-mode: pr");
	});

	it("COMMIT mode: omits pull-requests: write permission", () => {
		const yaml = renderWorkflowYaml(["main"], undefined, "COMMIT");
		expect(yaml).not.toContain("pull-requests: write");
	});

	it("COMMIT mode: includes commit-mode: commit input", () => {
		const yaml = renderWorkflowYaml(["main"], undefined, "COMMIT");
		expect(yaml).toContain("commit-mode: commit");
	});

	it("both modes: include if guard for vocoder-bot[bot]", () => {
		expect(renderWorkflowYaml(["main"], undefined, "PR")).toContain(
			"if: github.actor != 'vocoder-bot[bot]'",
		);
		expect(renderWorkflowYaml(["main"], undefined, "COMMIT")).toContain(
			"if: github.actor != 'vocoder-bot[bot]'",
		);
	});

	it("both modes: include contents: write permission", () => {
		expect(renderWorkflowYaml(["main"], undefined, "PR")).toContain(
			"contents: write",
		);
		expect(renderWorkflowYaml(["main"], undefined, "COMMIT")).toContain(
			"contents: write",
		);
	});

	it("app-dirs appears before commit-mode in with block when both present", () => {
		const yaml = renderWorkflowYaml(["main"], ["apps/web", "apps/admin"], "PR");
		const appDirsIdx = yaml.indexOf("app-dirs:");
		const commitModeIdx = yaml.indexOf("commit-mode:");
		expect(appDirsIdx).toBeGreaterThan(-1);
		expect(commitModeIdx).toBeGreaterThan(appDirsIdx);
	});
});

describe("writeGitHubActionsWorkflow", () => {
	let repoRoot: string;

	beforeEach(() => {
		repoRoot = mkdtempSync(join(tmpdir(), "vocoder-workflow-test-"));
	});

	afterEach(() => {
		rmSync(repoRoot, { recursive: true, force: true });
	});

	it("creates .github/workflows/vocoder-translate.yml when absent", () => {
		const result = writeGitHubActionsWorkflow(repoRoot, ["main"]);

		expect(result.written).toBe(true);
		expect(result.relativePath).toBe(".github/workflows/vocoder-translate.yml");
		expect(existsSync(result.path)).toBe(true);

		const contents = readFileSync(result.path, "utf-8");
		expect(contents).toContain("name: Vocoder Translate");
		expect(contents).toContain("branches: ['main']");
	});

	it("creates the .github/workflows directory tree if missing", () => {
		expect(existsSync(join(repoRoot, ".github"))).toBe(false);

		writeGitHubActionsWorkflow(repoRoot, ["main"]);

		expect(existsSync(join(repoRoot, ".github", "workflows"))).toBe(true);
	});

	it("does not overwrite an existing workflow file", () => {
		const workflowDir = join(repoRoot, ".github", "workflows");
		mkdirSync(workflowDir, { recursive: true });
		const workflowPath = join(workflowDir, "vocoder-translate.yml");
		writeFileSync(workflowPath, "# user-customized workflow", "utf-8");

		const result = writeGitHubActionsWorkflow(repoRoot, ["main"]);

		expect(result.written).toBe(false);
		expect(readFileSync(workflowPath, "utf-8")).toBe(
			"# user-customized workflow",
		);
	});
});

describe("readWorkflowCommitMode", () => {
	let repoRoot: string;

	beforeEach(() => {
		repoRoot = mkdtempSync(join(tmpdir(), "vocoder-test-"));
	});

	afterEach(() => {
		rmSync(repoRoot, { recursive: true, force: true });
	});

	function writeWorkflow(content: string) {
		const dir = join(repoRoot, ".github", "workflows");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "vocoder-translate.yml"), content, "utf-8");
	}

	it("returns 'PR' when commit-mode is 'pr'", () => {
		writeWorkflow("      commit-mode: pr\n");
		expect(readWorkflowCommitMode(repoRoot)).toBe("PR");
	});

	it("returns 'COMMIT' when commit-mode is 'commit'", () => {
		writeWorkflow("      commit-mode: commit\n");
		expect(readWorkflowCommitMode(repoRoot)).toBe("COMMIT");
	});

	it("is case-insensitive", () => {
		writeWorkflow("      commit-mode: PR\n");
		expect(readWorkflowCommitMode(repoRoot)).toBe("PR");
	});

	it("returns null when commit-mode field is absent", () => {
		writeWorkflow("name: Vocoder Translate\non:\n  push:\n    branches: ['main']\n");
		expect(readWorkflowCommitMode(repoRoot)).toBeNull();
	});

	it("returns null when workflow file does not exist", () => {
		expect(readWorkflowCommitMode(repoRoot)).toBeNull();
	});
});
