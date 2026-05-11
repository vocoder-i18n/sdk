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
    steps:
      - uses: actions/checkout@v4
      - uses: vocoder-i18n/translate-action@v1
        with:
          api-key: \${{ secrets.VOCODER_API_KEY }}
`;
}

/**
 * Write `.github/workflows/vocoder.yml` under `repoRoot`. Skips silently if
 * the file already exists — the user may have a custom workflow they don't
 * want overwritten.
 */
export function writeGitHubActionsWorkflow(
	repoRoot: string,
	targetBranches: string[],
): WorkflowWriteResult {
	const relativePath = ".github/workflows/vocoder.yml";
	const absolutePath = join(repoRoot, relativePath);

	if (existsSync(absolutePath)) {
		return { path: absolutePath, relativePath, written: false };
	}

	mkdirSync(dirname(absolutePath), { recursive: true });
	writeFileSync(absolutePath, renderWorkflowYaml(targetBranches), "utf-8");
	return { path: absolutePath, relativePath, written: true };
}
