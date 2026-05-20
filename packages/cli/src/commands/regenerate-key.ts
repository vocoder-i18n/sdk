import { VocoderAPI } from "../utils/api.js";
import { CommandSession, formatLabelValue } from "../utils/command-session.js";
import { ensureAccountAuth } from "../utils/account-auth.js";
import { highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { writeApiKeyToEnv } from "../utils/output.js";
import {
	resolveCurrentAppDir,
	resolveGitRepositoryIdentity,
} from "../utils/git-identity.js";
import { resolveLookupMatch } from "../utils/project-lookup.js";

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
	const appDir = resolveCurrentAppDir(identity.repoRoot);

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

	const matchedApp = resolveLookupMatch(lookup, appDir);
	if (!matchedApp) {
		return session.fail("This directory is not configured as a Vocoder app.", [
			`Known apps: ${lookup.existingApps.map((app) => app.appDir || "(root)").join(", ")}`,
			"Run vocoder init from one of the known app directories.",
		]);
	}
	session.step("Project", highlight(matchedApp.projectName));

	const api = new VocoderAPI({ apiUrl, apiKey: "" });
	const authResult = await ensureAccountAuth({
		api,
		session,
		options: { apiUrl: options.apiUrl },
		repoCanonical: identity.repoCanonical,
		loginIfNeeded: "interactive",
	});

	if (authResult.status === "required") {
		return session.fail("Account sign-in required.", [
			`Run ${highlight(authResult.command)}.`,
		]);
	}
	if (authResult.status === "unreachable") {
		session.info(formatLabelValue("Account", highlight(authResult.stored.email)));
		return session.fail("Could not verify stored credentials.", [
			authResult.message,
			`Run ${highlight("vocoder auth status")} once your connection is back.`,
		]);
	}
	if (authResult.status === "cancelled") {
		return session.cancelled();
	}
	if (authResult.source === "stored") {
		session.step("Authenticated as", highlight(authResult.auth.email));
	}

	// Regenerate and save
	const step = session.startStep("Generating API key");
	try {
		const { apiKey } = await api.regenerateProjectApiKey(
			authResult.auth.token,
			matchedApp.projectId,
		);
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
