import { VocoderAPI, VocoderAPIError } from "../utils/api.js";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

import type { PullOptions } from "../types.js";
import { detectBranch } from "../utils/branch.js";
import { CommandSession, displayAppDir } from "../utils/command-session.js";
import { highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { resolveGitRoot } from "../utils/git-identity.js";

loadEnvFiles();

export async function pull(options: PullOptions = {}): Promise<number> {
	const session = new CommandSession("Vocoder Pull");

	const apiKey = process.env.VOCODER_API_KEY;
	if (!apiKey) {
		return session.fail("VOCODER_API_KEY is not set.", [
			"Run vocoder init to set up your project.",
		]);
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiKey, apiUrl });

	let branch: string;
	try {
		branch = detectBranch(options.branch);
	} catch (error) {
		return session.fail(
			error instanceof Error ? error.message : "Failed to detect the branch.",
			["Use --branch to specify it explicitly."],
		);
	}

	const gitRoot = resolveGitRoot() ?? process.cwd();
	const rootDir = options.output ?? gitRoot;

	// --app-dirs flag acts as a client-side filter on the apps returned by the server
	const appDirFilter =
		options.appDirs !== undefined
			? new Set(
					options.appDirs
						.split(",")
						.map((d) => d.trim().replace(/^\/|\/$/g, ""))
						.filter(Boolean),
				)
			: null;

	const step = session.startStep(`Fetching locale files for ${highlight(branch)}`);

	try {
		const response = await api.getLocaleFiles({ branch });

		const apps = appDirFilter
			? response.apps.filter((a) => appDirFilter.has(a.appDir))
			: response.apps;

		const found = apps.filter((a) => a.localeFileTree !== undefined);

		if (found.length === 0) {
			step.fail("No locale files found", [
				"Run vocoder translate to generate translations first.",
			]);
			return session.endFailure();
		}

		step.done(`Found locale files for ${highlight(branch)}`);

		for (const { appDir, localeFileTree } of apps) {
			if (!localeFileTree) {
				session.warn(
					`No translations found for ${highlight(displayAppDir(appDir, { showRootLabel: true }))} on ${highlight(branch)}.`,
				);
				continue;
			}
			for (const result of writeLocaleFileTree(localeFileTree, rootDir)) {
				session.success(
					`Wrote ${highlight(String(result.count))} file${result.count === 1 ? "" : "s"} to ${highlight(result.displayDir)}`,
				);
			}
		}

		return session.end("Up to date.");
	} catch (error) {
		if (error instanceof VocoderAPIError) {
			step.fail(error.message, error.status === 401 ? [
				"Run vocoder init to re-authenticate.",
			] : []);
			return session.endFailure();
		}
		step.fail(
			error instanceof Error ? error.message : "Could not fetch locale files",
		);
		return session.endFailure();
	}
}

export interface LocaleWriteResult {
	displayDir: string;
	count: number;
}

export function writeLocaleFileTree(
	localeFileTree: Record<string, string>,
	rootDir: string,
): LocaleWriteResult[] {
	const dirCounts = new Map<string, number>();
	for (const [relativePath, content] of Object.entries(localeFileTree)) {
		const filePath = join(rootDir, relativePath);
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, content, "utf-8");
		const dir = dirname(relativePath);
		dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
	}
	return Array.from(dirCounts.entries()).map(([dir, count]) => ({
		displayDir: dir === "." ? "./" : `${dir}/`,
		count,
	}));
}
