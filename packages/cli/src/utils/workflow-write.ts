import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface WorkflowWriteResult {
	/** Absolute path the file lives at (whether written now or already present). */
	path: string;
	/** Path relative to `repoRoot` — used in user-facing output. */
	relativePath: string;
	/** True when this call created the file. False when it was already present. */
	written: boolean;
}

/**
 * Render the GitHub Actions workflow YAML that triggers `vocoder translate`
 * on push to one of `targetBranches`. The branches array must already be the
 * set the user selected at project-create time — no defaulting here.
 */
export function renderWorkflowYaml(targetBranches: string[]): string {
	const branches = targetBranches.map((b) => `'${b}'`).join(", ");
	return `name: Vocoder Translate
on:
  push:
    branches: [${branches}]
jobs:
  translate:
    runs-on: ubuntu-latest
    if: github.actor != 'vocoder-bot[bot]'
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: vocoder-i18n/translate-action@v1
        with:
          api-key: \${{ secrets.VOCODER_API_KEY }}
          # proceed: build continues even if translations fail (default)
          # fail: block the build if translations fail
          on-failure: proceed
`;
}

/**
 * Render a per-app workflow YAML for advanced monorepos where different apps
 * target different branches. The generated file uses `app-dir` to target one
 * specific app. Most teams use a single workflow — this is an advanced escape hatch.
 */
export function renderPerAppWorkflowYaml(appDir: string, branches: string[]): string {
	const branchList = branches.map((b) => `'${b}'`).join(", ");
	return `name: Vocoder Translate — ${appDir}
on:
  push:
    branches: [${branchList}]
jobs:
  translate:
    runs-on: ubuntu-latest
    if: github.actor != 'vocoder-bot[bot]'
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - uses: vocoder-i18n/translate-action@v1
        with:
          api-key: \${{ secrets.VOCODER_API_KEY }}
          app-dir: ${appDir}
          # proceed: build continues even if translations fail (default)
          # fail: block the build if translations fail
          on-failure: proceed
`;
}

/**
 * Write `.github/workflows/vocoder-translate.yml` under `repoRoot`. Skips silently if
 * the file already exists — the user may have a custom workflow they don't
 * want overwritten.
 */
export function writeGitHubActionsWorkflow(
	repoRoot: string,
	targetBranches: string[],
): WorkflowWriteResult {
	const relativePath = ".github/workflows/vocoder-translate.yml";
	const absolutePath = join(repoRoot, relativePath);

	if (existsSync(absolutePath)) {
		return { path: absolutePath, relativePath, written: false };
	}

	mkdirSync(dirname(absolutePath), { recursive: true });
	writeFileSync(absolutePath, renderWorkflowYaml(targetBranches), "utf-8");
	return { path: absolutePath, relativePath, written: true };
}
