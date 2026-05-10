import * as p from "@clack/prompts";
import chalk from "chalk";
import { loadEnvFiles } from "../utils/load-env.js";
import { detectRepoIdentity } from "@vocoder/plugin";
import { VocoderAPI } from "../utils/api.js";
import { verifyStoredAuth } from "../utils/auth-store.js";
import { runAuthFlow } from "../utils/auth-flow.js";
import { printApiKey } from "../utils/output.js";
import { writeAppConfigs } from "../utils/scaffold.js";
import { detectLocalEcosystem } from "../utils/detect-local.js";

loadEnvFiles();

export interface RegenerateKeyOptions {
	apiUrl?: string;
}

export async function regenerateKey(options: RegenerateKeyOptions = {}): Promise<number> {
	const apiUrl = options.apiUrl || process.env.VOCODER_API_URL || "https://vocoder.app";

	p.intro(chalk.bold("Regenerate API Key"));

	const identity = detectRepoIdentity();
	if (!identity) {
		p.log.error("Not inside a git repository. Run this command from your project root.");
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
		p.log.error("Could not reach Vocoder. Check your internet connection and try again.");
		return 1;
	}

	if (lookup.existingApps.length === 0) {
		p.log.error("No Vocoder app found for this repository. Run `vocoder init` to set one up.");
		return 1;
	}

	const firstApp = lookup.existingApps[0]!;
	p.log.info(`App: ${chalk.bold(firstApp.projectName)}`);

	// Auth — use stored token or browser flow
	const api = new VocoderAPI({ apiUrl, apiKey: "" });
	const storedAuth = await verifyStoredAuth(api);

	let userToken: string;
	if (storedAuth.status === "valid") {
		p.log.success(`Authenticated as ${chalk.bold(storedAuth.email)}`);
		userToken = storedAuth.token;
	} else {
		const authResult = await runAuthFlow(api, options, storedAuth.status === "expired");
		if (!authResult) return 1;
		userToken = authResult.token;
	}

	// Regenerate
	const spinner = p.spinner();
	spinner.start("Generating API key...");
	let apiKey: string;
	try {
		({ apiKey } = await api.regenerateProjectApiKey(userToken, firstApp.projectId));
		spinner.stop("API key ready");
	} catch (err) {
		spinner.stop("Failed");
		const msg = err instanceof Error ? err.message : String(err);
		p.log.error(msg.includes("403") ? "You must be an admin or owner to generate API keys." : `Could not generate API key: ${msg}`);
		return 1;
	}

	printApiKey(apiKey, identity.repoRoot);

	// Rewrite vocoder.config.ts files so appId is always current
	const detection = detectLocalEcosystem(identity.repoRoot);
	const targetBranches = lookup.exactMatch?.targetBranches ?? ["main"];
	writeAppConfigs(
		lookup.existingApps.map((a) => ({ appDir: a.appDir, appId: a.appId })),
		targetBranches,
		detection.isTypeScript,
		identity.repoRoot,
	);

	p.outro("Done.");
	return 0;
}
