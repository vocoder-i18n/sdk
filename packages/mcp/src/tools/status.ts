import { detectRepoIdentity } from "@vocoder/plugin";
import type { VocoderClient } from "../client.js";

export async function runStatus(client: VocoderClient): Promise<string> {
	const identity = detectRepoIdentity();
	const config = await client.getConfig(identity?.repoCanonical);

	const lines = [
		`App: ${config.projectName} (org: ${config.organizationName})`,
		`Source locale: ${config.sourceLocale}`,
		`Target locales: ${config.targetLocales.join(", ") || "(none configured)"}`,
		`Target branches: ${config.targetBranches.join(", ") || "(none configured)"}`,
		`Sync policy: blocking on [${config.syncPolicy.blockingBranches.join(", ")}] → ${config.syncPolicy.blockingMode}`,
	];

	return lines.join("\n");
}
