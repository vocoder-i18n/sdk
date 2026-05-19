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
	p.intro(chalk.bold("Vocoder Config"));

	const apiKey = process.env.VOCODER_API_KEY;
	if (!apiKey) {
		p.log.error("VOCODER_API_KEY is not set.");
		p.log.info(`  Run ${highlight("vocoder init")} to set up your project.`);
		p.outro("");
		return 1;
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiKey, apiUrl });

	try {
		const projectConfig = await api.getAppConfig();

		p.log.success(`${highlight(projectConfig.projectName)} — project config`);
		p.log.info(`Workspace:       ${highlight(projectConfig.organizationName)}`);
		p.log.info(`Source locale:   ${highlight(projectConfig.sourceLocale)}`);
		p.log.info(`Target locales:  ${
			projectConfig.targetLocales.length > 0
				? projectConfig.targetLocales.map((l) => highlight(l)).join(", ")
				: chalk.dim("(none)")
		}`);
		p.log.info(`Target branches: ${projectConfig.targetBranches.map((b) => highlight(b)).join(", ")}`);
		if (projectConfig.primaryBranch) {
			p.log.info(`Primary branch:  ${highlight(projectConfig.primaryBranch)}`);
		}
		p.log.info("");
		p.log.message(chalk.bold("Sync policy:"));
		p.log.info(`  Blocking branches: ${projectConfig.syncPolicy.blockingBranches.map((b) => highlight(b)).join(", ")}`);
		p.log.info(`  Blocking mode:     ${highlight(projectConfig.syncPolicy.blockingMode)}`);
		p.log.info(`  Non-blocking mode: ${highlight(projectConfig.syncPolicy.nonBlockingMode)}`);
		p.log.info(`  Max wait:          ${highlight(String(projectConfig.syncPolicy.defaultMaxWaitMs))} ms`);
		p.outro("");
		return 0;
	} catch (error) {
		p.log.error(
			error instanceof Error ? error.message : "Failed to fetch project config.",
		);
		p.outro("");
		return 1;
	}
}
