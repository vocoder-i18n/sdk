import * as p from "@clack/prompts";

import { VocoderAPI } from "../utils/api.js";
import chalk from "chalk";
import { highlight } from "../utils/theme.js";
import { detectRepoIdentity } from "@vocoder/plugin";
import { loadEnvFiles } from "../utils/load-env.js";
import { writeApiKeyToEnv } from "../utils/output.js";
import { runAuthFlow } from "../utils/auth-flow.js";
import { verifyStoredAuth } from "../utils/auth-store.js";

loadEnvFiles();

export interface RegenerateKeyOptions {
	apiUrl?: string;
}

export async function regenerateKey(options: RegenerateKeyOptions = {}): Promise<number> {
	const apiUrl = options.apiUrl || process.env.VOCODER_API_URL || "https://vocoder.app";

	p.intro(chalk.bold("Regenerate API Key"));

	const identity = detectRepoIdentity();
	if (!identity) {
		p.log.error("Not inside a git repository.");
		p.log.info("  Run this command from your project root.");
		p.outro("");
		return 1;
	}

	// Anonymous lookup — find the project for this repo
	const anonApi = new VocoderAPI({ apiUrl, apiKey: "" });
	let lookup: Awaited<ReturnType<VocoderAPI["lookupAppByRepo"]>>;
	try {
		lookup = await anonApi.lookupAppByRepo({
			repoCanonical: identity.repoCanonical,
			appDir: identity.appDir ?? "",
		});
	} catch {
		p.log.error("Could not reach Vocoder.");
		p.log.info("  Check your internet connection and try again.");
		p.outro("");
		return 1;
	}

	if (lookup.existingApps.length === 0) {
		p.log.error("No Vocoder project found for this repository.");
		p.log.info(`  Run ${highlight("vocoder init")} to set one up.`);
		p.outro("");
		return 1;
	}

	const firstApp = lookup.existingApps[0]!;
	p.log.success(`Project ${highlight(firstApp.projectName)} found`);

	// Auth — use stored token or browser flow
	const api = new VocoderAPI({ apiUrl, apiKey: "" });
	const storedAuth = await verifyStoredAuth(api);

	let userToken: string;
	if (storedAuth.status === "valid") {
		p.log.success(`Authenticated as ${highlight(storedAuth.email)}`);
		userToken = storedAuth.token;
	} else {
		const authResult = await runAuthFlow(api, options, storedAuth.status === "expired");
		if (!authResult) return 1;
		userToken = authResult.token;
	}

	// Regenerate and save
	const spinner = p.spinner();
	spinner.start("Generating API key…");
	try {
		const { apiKey } = await api.regenerateProjectApiKey(userToken, firstApp.projectId);
		const file = writeApiKeyToEnv(apiKey, identity.repoRoot);
		spinner.stop(file ? `API key saved to ${highlight(file)}` : "API key generated");
		if (!file) {
			p.log.warn(`Could not write to .env.local — find your API key at ${highlight("https://vocoder.app/settings")}`);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		spinner.stop(
			msg.includes("403") ? "Permission denied" : "Failed to generate key",
			1,
		);
		p.log.info(
			msg.includes("403")
				? "  You must be an admin or owner to regenerate API keys."
				: `  ${msg}`,
		);
		p.outro("");
		return 1;
	}

	p.outro("Done.");
	return 0;
}
