import * as p from "@clack/prompts";
import chalk from "chalk";
import { highlight } from "../utils/theme.js";
import { VocoderAPI } from "../utils/api.js";
import { loadEnvFiles } from "../utils/load-env.js";

loadEnvFiles();

export interface ConfigOptions {
	apiUrl?: string;
}

export async function config(options: ConfigOptions = {}): Promise<number> {
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
		const projectConfig = await api.getAppConfig();

		const lines = [
			`Project:         ${chalk.bold(projectConfig.projectName)}`,
			`Workspace:       ${chalk.bold(projectConfig.organizationName)}`,
			`Source locale:   ${highlight(projectConfig.sourceLocale)}`,
			`Target locales:  ${
				projectConfig.targetLocales.length > 0
					? projectConfig.targetLocales.map((l) => highlight(l)).join(", ")
					: chalk.dim("(none)")
			}`,
			`Target branches: ${projectConfig.targetBranches.map((b) => highlight(b)).join(", ")}`,
			...(projectConfig.primaryBranch
				? [`Primary branch:  ${highlight(projectConfig.primaryBranch)}`]
				: []),
			`Sync policy:`,
			`  Blocking branches: ${projectConfig.syncPolicy.blockingBranches.map((b) => highlight(b)).join(", ")}`,
			`  Blocking mode:     ${highlight(projectConfig.syncPolicy.blockingMode)}`,
			`  Non-blocking mode: ${highlight(projectConfig.syncPolicy.nonBlockingMode)}`,
			`  Max wait:          ${highlight(String(projectConfig.syncPolicy.defaultMaxWaitMs))} ms`,
		];

		p.note(lines.join("\n"), `${projectConfig.projectName} — project config`);
		return 0;
	} catch (error) {
		p.log.error(
			error instanceof Error ? error.message : "Failed to fetch project config.",
		);
		return 1;
	}
}
