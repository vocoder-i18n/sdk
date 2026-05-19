import { CommandSession, joinHighlighted } from "../utils/command-session.js";
import { highlight } from "../utils/theme.js";
import { VocoderAPI } from "../utils/api.js";
import { loadEnvFiles } from "../utils/load-env.js";

loadEnvFiles();

export interface ConfigOptions {
	apiUrl?: string;
}

export async function config(options: ConfigOptions = {}): Promise<number> {
	const session = new CommandSession("Vocoder Config");

	const apiKey = process.env.VOCODER_API_KEY;
	if (!apiKey) {
		return session.fail("VOCODER_API_KEY is not set.", [
			"Run vocoder init to set up your project.",
		]);
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiKey, apiUrl });

	try {
		const projectConfig = await api.getAppConfig();

		session.step("Project", highlight(projectConfig.projectName));
		session.step("Workspace", highlight(projectConfig.organizationName));
		session.step("Source locale", highlight(projectConfig.sourceLocale));
		session.step(
			"Target locales",
			projectConfig.targetLocales.length > 0
				? joinHighlighted(projectConfig.targetLocales)
				: "(none)",
		);
		session.step("Target branches", joinHighlighted(projectConfig.targetBranches));
		if (projectConfig.primaryBranch) {
			session.step("Primary branch", highlight(projectConfig.primaryBranch));
		}
		session.blank();
		session.section("Sync policy");
		session.step(
			"Blocking branches",
			joinHighlighted(projectConfig.syncPolicy.blockingBranches),
			"info",
		);
		session.step(
			"Blocking mode",
			highlight(projectConfig.syncPolicy.blockingMode),
			"info",
		);
		session.step(
			"Non-blocking mode",
			highlight(projectConfig.syncPolicy.nonBlockingMode),
			"info",
		);
		session.step(
			"Max wait",
			`${highlight(String(projectConfig.syncPolicy.defaultMaxWaitMs))} ms`,
			"info",
		);
		return session.end();
	} catch (error) {
		return session.fail(
			error instanceof Error ? error.message : "Failed to fetch project config.",
		);
	}
}
