import type { VocoderAPI } from "@vocoder/cli/lib";

export async function runConfig(api: VocoderAPI): Promise<string> {
	const projectConfig = await api.getAppConfig();

	const lines = [
		`Project: ${projectConfig.projectName} (workspace: ${projectConfig.organizationName})`,
		`Source locale: ${projectConfig.sourceLocale}`,
		`Target locales: ${projectConfig.targetLocales.join(", ") || "(none configured)"}`,
		`Target branches: ${projectConfig.targetBranches.join(", ") || "(none configured)"}`,
		`Sync policy: blocking on [${projectConfig.syncPolicy.blockingBranches.join(", ")}] → ${projectConfig.syncPolicy.blockingMode}`,
	];

	return lines.join("\n");
}
