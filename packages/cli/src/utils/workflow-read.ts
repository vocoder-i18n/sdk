import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOW_PATH = ".github/workflows/vocoder-translate.yml";

/**
 * Reads the Vocoder GitHub Actions workflow file and extracts the target branches
 * from the `on.push.branches` list.
 *
 * Returns null when the file doesn't exist or branches can't be parsed — callers
 * should fall back to the server-provided targetBranches in that case.
 */
export function readWorkflowBranches(repoRoot: string): string[] | null {
	const filePath = join(repoRoot, WORKFLOW_PATH);
	if (!existsSync(filePath)) {
		return null;
	}

	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}

	// Matches: branches: ['main', 'develop'] or branches: ["main"]
	const match = content.match(/branches:\s*\[([^\]]+)\]/);
	if (!match?.[1]) {
		return null;
	}

	const branches = match[1]
		.split(",")
		.map((b) => b.trim().replace(/^['"]|['"]$/g, ""))
		.filter(Boolean);

	return branches.length > 0 ? branches : null;
}

/**
 * Reads the Vocoder GitHub Actions workflow file and extracts the app directories
 * from the `with.app-dirs` field of the translate action step.
 *
 * Returns null when the file doesn't exist, the field is absent, or the value is empty —
 * callers should fall back to single-app (root "") mode in that case.
 */
export function readWorkflowAppDirs(repoRoot: string): string[] | null {
	const filePath = join(repoRoot, WORKFLOW_PATH);
	if (!existsSync(filePath)) {
		return null;
	}

	let content: string;
	try {
		content = readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}

	// Matches: app-dirs: apps/vite  or  app-dirs: apps/vite, apps/nextjs
	const match = content.match(/app-dirs:\s*(.+)/);
	if (!match?.[1]) {
		return null;
	}

	const dirs = match[1]
		.trim()
		.split(",")
		.map((d) => d.trim().replace(/^\/|\/$/g, ""))
		.filter(Boolean);

	return dirs.length > 0 ? dirs : null;
}
