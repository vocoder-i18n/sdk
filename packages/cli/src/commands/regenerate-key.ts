import { VocoderAPI } from "../utils/api.js";
import { CommandSession, formatLabelValue } from "../utils/command-session.js";
import { highlight } from "../utils/theme.js";
import { relative } from "node:path";
import { loadEnvFiles } from "../utils/load-env.js";
import { writeApiKeyToEnv } from "../utils/output.js";
import { runAuthFlow } from "../utils/auth-flow.js";
import { verifyStoredAuth } from "../utils/auth-store.js";
import { resolveGitRepositoryIdentity } from "../utils/git-identity.js";

loadEnvFiles();

export interface RegenerateKeyOptions {
	apiUrl?: string;
}

export async function regenerateKey(options: RegenerateKeyOptions = {}): Promise<number> {
	const apiUrl = options.apiUrl || process.env.VOCODER_API_URL || "https://vocoder.app";

	const session = new CommandSession("Regenerate API Key");

	const identity = resolveGitRepositoryIdentity();
	if (!identity) {
		return session.fail("Not inside a git repository.", [
			"Run this command from your project root.",
		]);
	}
	const appDir = relative(identity.repoRoot, process.cwd())
		.replace(/\\/g, "/")
		.replace(/^\.\/|\/$/g, "");

	// Anonymous lookup — find the project for this repo
	const anonApi = new VocoderAPI({ apiUrl, apiKey: "" });
	let lookup: Awaited<ReturnType<VocoderAPI["lookupAppByRepo"]>>;
	try {
		lookup = await anonApi.lookupAppByRepo({
			repoCanonical: identity.repoCanonical,
			appDir: appDir === "." ? "" : appDir,
		});
	} catch {
		return session.fail("Could not reach Vocoder.", [
			"Check your internet connection and try again.",
		]);
	}

	if (lookup.existingApps.length === 0) {
		return session.fail("No Vocoder project found for this repository.", [
			"Run vocoder init to set one up.",
		]);
	}

	const firstApp = lookup.existingApps[0]!;
	session.step("Project", highlight(firstApp.projectName));

	// Auth — use stored token or browser flow
	const api = new VocoderAPI({ apiUrl, apiKey: "" });
	const storedAuth = await verifyStoredAuth(api);

	let userToken: string;
	if (storedAuth.status === "valid") {
		session.step("Authenticated as", highlight(storedAuth.email));
		userToken = storedAuth.token;
	} else {
		const authResult = await runAuthFlow(
			api,
			options,
			session,
			storedAuth.status === "expired",
		);
		if (!authResult) return session.cancelled();
		userToken = authResult.token;
	}

	// Regenerate and save
	const step = session.startStep("Generating API key");
	try {
		const { apiKey } = await api.regenerateProjectApiKey(userToken, firstApp.projectId);
		const file = writeApiKeyToEnv(apiKey, identity.repoRoot);
		step.done(file ? `API key saved to ${highlight(file)}` : "Generated API key");
		if (!file) {
			session.warn("Could not write the API key to an env file.");
			session.info(`Find it at ${highlight("https://vocoder.app/settings")}.`);
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		step.fail(
			msg.includes("403") ? "Permission denied" : "Failed to generate key",
			[
				msg.includes("403")
					? "You must be an admin or owner to regenerate API keys."
					: formatLabelValue("Details", msg),
			],
		);
		return session.endFailure();
	}

	return session.end("Done.");
}
