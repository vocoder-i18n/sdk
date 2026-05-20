import { VocoderAPI, verifyStoredAuth } from "@vocoder/cli/lib";

import { detectRepoIdentity } from "@vocoder/plugin";

export interface RegenerateKeyResult {
	apiKey: string;
	projectName: string;
	apps: Array<{ appDir: string; appId: string }>;
	instructions: string;
}

export async function runRegenerateKey(): Promise<RegenerateKeyResult> {
	const apiUrl = process.env.VOCODER_API_URL || "https://vocoder.app";
	const identity = detectRepoIdentity();

	if (!identity) {
		throw new Error("Not inside a git repository. Run this tool from your project root.");
	}

	const anonApi = new VocoderAPI({ apiUrl, apiKey: "" });
	const lookup = await anonApi.lookupAppByRepo({
		repoCanonical: identity.repoCanonical,
		appDir: identity.appDir ?? "",
	});

	if (lookup.existingApps.length === 0) {
		throw new Error(
			"No Vocoder app found for this repository. Call vocoder_init_start to set one up.",
		);
	}

	const firstApp = lookup.existingApps[0]!;
	const apps = lookup.existingApps.map((a) => ({ appDir: a.appDir, appId: a.appId }));

	const api = new VocoderAPI({ apiUrl, apiKey: "" });
	const storedAuth = await verifyStoredAuth(api);

	if (storedAuth.status !== "valid") {
		throw new Error(
			"No valid stored auth token. The user must run `vocoder regenerate-key` in their terminal — it opens a browser flow that cannot be automated.",
		);
	}

	let apiKey: string;
	try {
		({ apiKey } = await api.regenerateProjectApiKey(storedAuth.token, firstApp.projectId));
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("403")) {
			throw new Error(
				"Permission denied — only admins and owners can generate API keys. Ask an admin to run `vocoder regenerate-key`.",
			);
		}
		throw new Error(`Failed to generate API key: ${msg}`);
	}

	const configLines = apps.map((app) =>
		[
			`// ${app.appDir || "repo root"} — vocoder.config.ts`,
			`import { defineConfig } from '@vocoder/config';`,
			`export default defineConfig({`,
			`  appId: '${app.appId}',`,
			`  localesDir: 'src/locales',`,
			`});`,
		].join("\n"),
	);

	return {
		apiKey,
		projectName: firstApp.projectName,
		apps,
		instructions: [
			`New API key generated for "${firstApp.projectName}".`,
			``,
			`1. Write to .env at the repo root:`,
			`   VOCODER_API_KEY=${apiKey}`,
			``,
			`2. Tell the user to update VOCODER_API_KEY in their MCP server environment config and restart their editor.`,
			``,
			`3. Each app directory needs a vocoder.config.ts with its appId:`,
			configLines.join("\n\n"),
		].join("\n"),
	};
}
