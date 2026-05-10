import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	renderWorkflowYaml,
	writeGitHubActionsWorkflow,
} from "../utils/workflow-write.js";

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

	it("checks out the repo before running the action", () => {
		const yaml = renderWorkflowYaml(["main"]);
		const checkoutIdx = yaml.indexOf("actions/checkout@v4");
		const actionIdx = yaml.indexOf("vocoder-i18n/translate-action");
		expect(checkoutIdx).toBeGreaterThan(-1);
		expect(actionIdx).toBeGreaterThan(checkoutIdx);
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

	it("creates .github/workflows/vocoder.yml when absent", () => {
		const result = writeGitHubActionsWorkflow(repoRoot, ["main"]);

		expect(result.written).toBe(true);
		expect(result.relativePath).toBe(".github/workflows/vocoder.yml");
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
		const workflowPath = join(workflowDir, "vocoder.yml");
		writeFileSync(workflowPath, "# user-customized workflow", "utf-8");

		const result = writeGitHubActionsWorkflow(repoRoot, ["main"]);

		expect(result.written).toBe(false);
		expect(readFileSync(workflowPath, "utf-8")).toBe(
			"# user-customized workflow",
		);
	});
});
