import * as p from "@clack/prompts";

import { active, highlight } from "../utils/theme.js";

import { VocoderAPI } from "../utils/api.js";
import chalk from "chalk";
import { config as loadEnv } from "dotenv";

loadEnv();

export interface AppConfigOptions {
	apiUrl?: string;
}

/**
 * Displays the current Vocoder app configuration.
 *
 * Shows: app name, organization, source locale, target locales,
 * target branches, primary branch, and sync policy settings.
 *
 * Reads the app API key from VOCODER_API_KEY.
 * Endpoint: GET /api/cli/config
 *
 * @throws If VOCODER_API_KEY is missing or invalid.
 */
export async function appConfig(options: AppConfigOptions = {}): Promise<number> {
	const apiKey = process.env.VOCODER_API_KEY;
	if (!apiKey) {
		p.log.error(
			"VOCODER_API_KEY is not set. Run `npx @vocoder/cli init` to set up your app.",
		);
		return 1;
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiKey, apiUrl });

	try {
		const config = await api.getAppConfig();

		const lines = [
			`App:             ${chalk.bold(config.projectName)}`,
			`Workspace:    	  ${chalk.bold(config.organizationName)}`,
			`Source locale:   ${highlight(config.sourceLocale)}`,
			`Target locales:  ${
				config.targetLocales.length > 0
					? config.targetLocales.map((l) => highlight(l)).join(", ")
					: chalk.dim("(none)")
			}`,
			`Target branches: ${config.targetBranches.map((b) => highlight(b)).join(", ")}`,
			...(config.primaryBranch
				? [`Primary branch:  ${highlight(config.primaryBranch)}`]
				: []),
			`Sync policy:`,
			`  Blocking branches: ${config.syncPolicy.blockingBranches.map((b) => highlight(b)).join(", ")}`,
			`  Blocking mode:     ${highlight(config.syncPolicy.blockingMode)}`,
			`  Non-blocking mode: ${highlight(config.syncPolicy.nonBlockingMode)}`,
			`  Max wait:          ${highlight(String(config.syncPolicy.defaultMaxWaitMs))} ms`,
		];

		p.note(lines.join("\n"), `${config.projectName} — app config`);
		return 0;
	} catch (error) {
		p.log.error(
			error instanceof Error ? error.message : "Failed to fetch app config.",
		);
		return 1;
	}
}
