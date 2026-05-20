import * as p from "@clack/prompts";

import { CommandSession, formatLabelValue } from "../utils/command-session.js";
import { VocoderAPI, VocoderAPIError } from "../utils/api.js";
import { basename, join } from "node:path";
import { existsSync, readdirSync, rmSync } from "node:fs";

import type { CleanOptions } from "../types.js";
import { highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { loadVocoderConfig } from "@vocoder/extractor";
import { readWorkflowAppDirs } from "../utils/workflow-read.js";
import { resolveGitRoot } from "../utils/git-identity.js";
import { validateLocalConfig } from "../utils/config.js";

loadEnvFiles();

type OrphanedFile = { relativePath: string; locale: string };

/** Returns locale files in `localeDir` whose basename is not in `activeLocales`. */
export function findOrphanedFiles(
	localeDir: string,
	activeLocales: Set<string>,
): OrphanedFile[] {
	if (!existsSync(localeDir)) return [];

	const orphaned: OrphanedFile[] = [];
	for (const file of readdirSync(localeDir)) {
		if (!file.endsWith(".json")) continue;
		const name = basename(file, ".json");
		if (name === "manifest") continue;
		if (!activeLocales.has(name)) {
			orphaned.push({ relativePath: join(localeDir, file), locale: name });
		}
	}
	return orphaned;
}

export async function clean(options: CleanOptions = {}): Promise<number> {
	const session = new CommandSession("Vocoder Clean");

	const apiKey = process.env.VOCODER_API_KEY;
	if (!apiKey) {
		return session.fail("VOCODER_API_KEY is not set.", [
			"Run vocoder init or set VOCODER_API_KEY in .env.local.",
		]);
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const localConfig = { apiKey, apiUrl };

	try {
		validateLocalConfig(localConfig);
	} catch (e) {
		return session.fail(e instanceof Error ? e.message : String(e));
	}

	const cwd = process.cwd();
	const gitRoot = resolveGitRoot() ?? cwd;

	try {
		const step = session.startStep("Loading project configuration");
		const api = new VocoderAPI(localConfig);
		const apiConfig = await api.getAppConfig();
		step.done(formatLabelValue("Project", highlight(apiConfig.projectName)));

		const activeLocales = new Set([apiConfig.sourceLocale, ...apiConfig.targetLocales]);

		const yamlAppDirs = readWorkflowAppDirs(gitRoot);
		const appDirs = options.appDirs
			? options.appDirs
					.split(",")
					.map((d) => d.trim().replace(/^\/|\/$/g, ""))
					.filter(Boolean)
			: (yamlAppDirs ?? []);
		const effectiveAppDirs = appDirs.length > 0 ? appDirs : [""];

		const allOrphaned: OrphanedFile[] = [];

		for (const appDir of effectiveAppDirs) {
			const extractRoot = appDir ? `${gitRoot}/${appDir}` : gitRoot;
			const appConfig = loadVocoderConfig(extractRoot);
			const localesDir = appConfig?.localesDir ?? "locales";
			const localeDir = appDir
				? join(gitRoot, appDir, localesDir)
				: join(gitRoot, localesDir);

			allOrphaned.push(...findOrphanedFiles(localeDir, activeLocales));
		}

		if (allOrphaned.length === 0) {
			return session.end("No orphaned locale files found.");
		}

		const count = allOrphaned.length;
		session.section("Orphaned locale files");
		for (const { relativePath, locale } of allOrphaned) {
			session.message(`${highlight(locale)} — ${relativePath.replace(`${gitRoot}/`, "")}`);
		}

		if (!options.yes) {
			const confirmed = await p.confirm({
				message: `Delete ${count} file${count === 1 ? "" : "s"}?`,
			});
			if (p.isCancel(confirmed) || !confirmed) {
				return session.end("No files deleted.");
			}
		}

		for (const { relativePath } of allOrphaned) {
			rmSync(relativePath);
		}

		session.success(
			`Deleted ${highlight(String(count))} file${count === 1 ? "" : "s"}.`,
		);
		return session.end();
	} catch (error) {
		if (error instanceof VocoderAPIError) {
			const guidance =
				error.status === 401 || error.status === 403
					? [
							"API key rejected — the project may have been deleted or the key revoked.",
							"Run vocoder init or vocoder regenerate-key.",
						]
					: [];
			return session.fail(error.message, guidance);
		}

		return session.fail(
			error instanceof Error ? error.message : "Failed to load project configuration.",
		);
	}
}
