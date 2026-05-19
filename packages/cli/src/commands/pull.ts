import * as p from "@clack/prompts";

import { VocoderAPI, VocoderAPIError } from "../utils/api.js";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

import type { PullOptions } from "../types.js";
import chalk from "chalk";
import { detectBranch } from "../utils/branch.js";
import { highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { resolveGitRoot } from "../utils/git-identity.js";

loadEnvFiles();

export async function pull(options: PullOptions = {}): Promise<number> {
	p.intro(chalk.bold("Vocoder Pull"));

	const apiKey = process.env.VOCODER_API_KEY;
	if (!apiKey) {
		p.log.error("VOCODER_API_KEY not set.");
		p.log.info(`  Run ${highlight("vocoder init")} to set up your project.`);
		p.outro("");
		return 1;
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiKey, apiUrl });

	let branch: string;
	try {
		branch = detectBranch(options.branch);
	} catch (error) {
		p.log.error(error instanceof Error ? error.message : "Failed to detect branch.");
		p.log.info("  Use --branch to specify explicitly.");
		p.outro("");
		return 1;
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

	const spinner = p.spinner();
	spinner.start(`Fetching locale files for ${highlight(branch)}…`);

	try {
		const response = await api.getLocaleFiles({ branch });

		const apps = appDirFilter
			? response.apps.filter((a) => appDirFilter.has(a.appDir))
			: response.apps;

		const found = apps.filter((a) => a.localeFileTree !== undefined);

		if (found.length === 0) {
			spinner.stop("No locale files found", 1);
			p.log.info(`  Run ${highlight("vocoder translate")} to generate translations first.`);
			p.outro("");
			return 1;
		}

		spinner.stop(`Found locale files for ${highlight(branch)}`);

		for (const { appDir, localeFileTree } of apps) {
			if (!localeFileTree) {
				p.log.warn(
					`No translations found for ${highlight(appDir || "(root)")} on ${highlight(branch)}.`,
				);
				continue;
			}
			writeLocaleFileTree(localeFileTree, rootDir);
		}

		p.outro("Up to date.");
		return 0;
	} catch (error) {
		if (error instanceof VocoderAPIError) {
			spinner.stop(error.message, 1);
			if (error.status === 401) {
				p.log.info(`  Run ${highlight("vocoder init")} to re-authenticate.`);
			}
		} else {
			spinner.stop(error instanceof Error ? error.message : "Could not fetch locale files", 1);
		}
		p.outro("");
		return 1;
	}
}

export function writeLocaleFileTree(
	localeFileTree: Record<string, string>,
	rootDir: string,
): void {
	const dirCounts = new Map<string, number>();
	for (const [relativePath, content] of Object.entries(localeFileTree)) {
		const filePath = join(rootDir, relativePath);
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, content, "utf-8");
		const dir = dirname(relativePath);
		dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
	}
	for (const [dir, count] of dirCounts) {
		const displayDir = dir === "." ? "./" : `${dir}/`;
		p.log.success(`Wrote ${highlight(String(count))} file${count === 1 ? "" : "s"} to ${highlight(displayDir)}`);
	}
}
