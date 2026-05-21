import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ConfigWriteResult {
	/** Absolute path the file lives at (whether written now or already present). */
	path: string;
	/** Path relative to `repoRoot` — used in user-facing output. */
	relativePath: string;
	/** True when this call created the file. False when it was already present. */
	written: boolean;
}

/**
 * Write `vocoder.config.ts` under `repoRoot`. Skips silently if the file
 * already exists — the user may have a custom config they don't want overwritten.
 *
 * Branch triggers are intentionally omitted — the CLI reads them from the
 * GitHub Actions YAML (`on.push.branches`), so no duplication is needed.
 * Per-app `targetBranches` overrides can be added manually for advanced monorepo setups.
 */
export function writeVocoderConfig(
	repoRoot: string,
	opts: { targetBranches?: string[]; appDirs?: string[] },
): ConfigWriteResult {
	const relativePath = "vocoder.config.ts";
	const absolutePath = join(repoRoot, relativePath);

	if (existsSync(absolutePath)) {
		return { path: absolutePath, relativePath, written: false };
	}

	const namedDirs = (opts.appDirs ?? []).filter(Boolean);

	let content: string;
	if (namedDirs.length > 0) {
		const appLines = namedDirs.map((dir) => `    { appDir: '${dir}' },`).join("\n");
		content = [
			"import { defineConfig } from '@vocoder/config';",
			"",
			"export default defineConfig({",
			"  apps: [",
			appLines,
			"  ],",
			"});",
			"",
		].join("\n");
	} else {
		content = [
			"import { defineConfig } from '@vocoder/config';",
			"",
			"export default defineConfig({});",
			"",
		].join("\n");
	}

	writeFileSync(absolutePath, content, "utf-8");
	return { path: absolutePath, relativePath, written: true };
}
