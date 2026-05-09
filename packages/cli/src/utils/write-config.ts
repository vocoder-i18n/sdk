import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Returns the path of an existing vocoder.config file in cwd, trying
 * .ts → .js → .json in order. Returns null when none is found.
 */
export function findExistingConfig(cwd: string = process.cwd()): string | null {
	for (const name of [
		"vocoder.config.ts",
		"vocoder.config.js",
		"vocoder.config.json",
	]) {
		const candidate = join(cwd, name);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/**
 * Write a vocoder.config file to cwd if one doesn't already exist.
 * Pass `useTypeScript: false` for plain-JS projects — writes vocoder.config.js
 * instead of vocoder.config.ts. The config content is identical; only the
 * file extension (and therefore the import style in the user's editor) differs.
 *
 * Returns the filename that was written, or null if the file already existed
 * or the write failed.
 */
/**
 * Write a vocoder.config file to cwd if one doesn't already exist.
 * Pass `useTypeScript: false` for plain-JS projects — writes vocoder.config.js
 * instead of vocoder.config.ts. The config content is identical; only the
 * file extension (and therefore the import style in the user's editor) differs.
 *
 * Returns the filename that was written, or null if the file already existed
 * or the write failed.
 */
export function writeVocoderConfig(options: {
	targetBranches?: string[];
	useTypeScript?: boolean;
	cwd?: string;
	/** App ID to embed in the config — written by init, used by CLI to identify the app. */
	appId?: string;
}): string | null {
	const {
		targetBranches = ["main"],
		useTypeScript = true,
		cwd = process.cwd(),
		appId,
	} = options;

	// Don't write if any config variant already exists
	if (findExistingConfig(cwd)) return null;

	const ext = useTypeScript ? "ts" : "js";
	const configPath = join(cwd, `vocoder.config.${ext}`);
	const branchesStr = targetBranches.map((b) => `'${b}'`).join(", ");

	// Patterns are always relative to the config file's own directory.
	// In a monorepo, the config lives in the app subdirectory, so `**` naturally
	// scopes to that app — no `appDir/` prefix needed (and adding it would break
	// extraction when the CLI or build plugin runs with the app dir as cwd).
	const includes = ["**/*.{tsx,jsx,ts,js}"];
	const includesStr = includes.map((p) => `'${p}'`).join(", ");
	const appIdLine = appId ? `  appId: '${appId}',\n` : "";

	// Both TS and JS use ESM import syntax — the content is identical.
	// TypeScript users get type-checking from defineConfig; JS users get
	// the same runtime behaviour with no TS toolchain required.
	const content = `import { defineConfig } from '@vocoder/config'

export default defineConfig({
${appIdLine}  targetBranches: [${branchesStr}],
  include: [${includesStr}],
})
`;

	try {
		writeFileSync(configPath, content, "utf-8");
		return `vocoder.config.${ext}`;
	} catch {
		return null;
	}
}
