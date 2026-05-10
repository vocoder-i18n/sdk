import { parse } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

function findGitRoot(cwd: string): string | null {
	try {
		return execSync("git rev-parse --show-toplevel", {
			cwd,
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
	} catch {
		return null;
	}
}

/**
 * Loads .env and .env.local files into process.env.
 *
 * Priority (highest wins):
 *   shell environment > CWD .env.local > CWD .env > git-root .env.local > git-root .env
 *
 * Shell variables are never overwritten. This matches the convention used by
 * Next.js, Vite, and other tools, so developers can use .env.local for local
 * overrides without touching committed .env files.
 */
export function loadEnvFiles(cwd = process.cwd()): void {
	const gitRoot = findGitRoot(cwd);

	// Build list of files in ascending priority order (last = highest priority)
	const candidates: string[] = [];

	if (gitRoot && gitRoot !== cwd) {
		candidates.push(join(gitRoot, ".env"));
		candidates.push(join(gitRoot, ".env.local"));
	}

	candidates.push(join(cwd, ".env"));
	candidates.push(join(cwd, ".env.local"));

	// Merge parsed values — later files override earlier ones
	const merged: Record<string, string> = {};
	for (const file of candidates) {
		if (existsSync(file)) {
			const parsed = parse(readFileSync(file, "utf8"));
			Object.assign(merged, parsed);
		}
	}

	// Apply only vars not already set in the environment (shell wins)
	for (const [key, value] of Object.entries(merged)) {
		if (!(key in process.env)) {
			process.env[key] = value;
		}
	}
}
