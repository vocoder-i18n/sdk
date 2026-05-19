import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Load .env files into process.env following the standard cascade used by Vite and Next.js.
 * Build plugins run before the bundler's own .env loading, so we replicate it ourselves.
 *
 * Priority (lowest → highest): .env < .env.[mode] < .env.local < .env.[mode].local
 * Actual process.env values (CI, shell exports) always win — never overwritten.
 *
 * For monorepos: after exhausting the starting directory, walks up the tree until a
 * git repository root is found (where .git lives) or the filesystem root is reached.
 */
export function loadEnvFile(): void {
	const mode = process.env.NODE_ENV === "production" ? "production" : "development";
	const candidates = [
		".env",
		`.env.${mode}`,
		".env.local",
		`.env.${mode}.local`,
	];

	const merged: Record<string, string> = {};

	const dirs = collectSearchDirs(process.cwd());
	// Reverse so child dir values overwrite parent values in the merged map.
	for (const dir of [...dirs].reverse()) {
		for (const candidate of candidates) {
			const envPath = resolve(dir, candidate);
			if (!existsSync(envPath)) continue;
			try {
				const content = readFileSync(envPath, "utf-8");
				for (const line of content.split("\n")) {
					const trimmed = line.trim();
					if (!trimmed || trimmed.startsWith("#")) continue;
					const eqIndex = trimmed.indexOf("=");
					if (eqIndex === -1) continue;
					const key = trimmed.slice(0, eqIndex).trim();
					const value = trimmed
						.slice(eqIndex + 1)
						.trim()
						.replace(/^["']|["']$/g, "");
					merged[key] = value;
				}
			} catch {
				// Non-fatal
			}
		}
	}

	for (const [key, value] of Object.entries(merged)) {
		if (!(key in process.env)) {
			process.env[key] = value;
		}
	}
}

function collectSearchDirs(startDir: string): string[] {
	const dirs: string[] = [];
	let current = startDir;

	while (true) {
		dirs.push(current);

		// .git marks the repo root — include this dir but go no further.
		if (existsSync(resolve(current, ".git"))) break;

		const parent = dirname(current);
		if (parent === current) break; // filesystem root
		current = parent;
	}

	return dirs;
}
