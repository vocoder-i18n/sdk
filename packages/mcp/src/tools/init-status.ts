import { detectRepoIdentity } from "@vocoder/cli/lib";
import {
	VocoderAPI,
	readAuthData,
	clearAuthData,
} from "@vocoder/cli/lib";

export interface InitStatusResult {
	ready: boolean;
	projectName: string | null;
	sourceLocale: string | null;
	targetLocales: string[] | null;
	initCommand: string;
	instructions: string;
	whatHappens: string;
	newApiKey?: string;
}

const INIT_COMMAND = "npx @vocoder/cli init";

export const WHAT_HAPPENS =
	"The init command opens a browser window to the Vocoder sign-in page. After authenticating, the terminal displays your VOCODER_API_KEY and writes a GitHub Actions workflow file to .github/workflows/vocoder.yml. Add VOCODER_API_KEY to .env and as a GitHub repository secret, then run /mcp reset to reload.";

export const INIT_INSTRUCTIONS = [
	"1. Run in your terminal: npx @vocoder/cli init",
	"2. Browser opens — sign in to your Vocoder account",
	"3. Copy the VOCODER_API_KEY shown in your terminal",
	"4. Add VOCODER_API_KEY as a GitHub repository secret:",
	"   GitHub repo → Settings → Secrets and variables → Actions → New repository secret",
	"5. Add to your MCP config: VOCODER_API_KEY=<your-key>",
	"6. Restart your MCP server / reload the editor session",
	"",
	"Then call vocoder_init_status again to verify.",
].join("\n");

export async function runInitStatus(
	api: VocoderAPI | null,
): Promise<InitStatusResult> {
	if (!api) {
		return {
			ready: false,
			projectName: null,
			sourceLocale: null,
			targetLocales: null,
			initCommand: INIT_COMMAND,
			instructions: INIT_INSTRUCTIONS,
			whatHappens: WHAT_HAPPENS,
		};
	}

	try {
		const config = await api.getAppConfig();
		return {
			ready: true,
			projectName: config.projectName,
			sourceLocale: config.sourceLocale,
			targetLocales: config.targetLocales,
			initCommand: INIT_COMMAND,
			instructions: `App "${config.projectName}" is configured and ready. Source locale: ${config.sourceLocale}. Target locales: ${config.targetLocales.join(", ")}.`,
			whatHappens: WHAT_HAPPENS,
		};
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		const is401 = msg.includes("401");

		if (is401) {
			// Try silent key regeneration using stored CLI auth token
			const stored = readAuthData();
			if (stored) {
				const apiUrl = process.env.VOCODER_API_URL ?? "https://vocoder.app";
				const anonApi = new VocoderAPI({ apiUrl, apiKey: "" });
				try {
					await anonApi.getCliUserInfo(stored.token);
					const identity = detectRepoIdentity();
					if (identity) {
						const lookup = await anonApi.lookupAppByRepo({
							repoCanonical: identity.repoCanonical,
							appDir: identity.appDir,
						});
						if (lookup.exactMatch) {
							const { apiKey } = await anonApi.regenerateProjectApiKey(
								stored.token,
								lookup.exactMatch.projectId,
							);
							return {
								ready: false,
								projectName: lookup.exactMatch.projectName,
								sourceLocale: lookup.exactMatch.sourceLocale ?? null,
								targetLocales: null,
								initCommand: INIT_COMMAND,
								newApiKey: apiKey,
								instructions: `API key was expired and has been silently regenerated. Write VOCODER_API_KEY=${apiKey} to .env, then run /mcp reset to reload.`,
								whatHappens: WHAT_HAPPENS,
							};
						}
					}
				} catch {
					clearAuthData();
				}
			}
		}

		return {
			ready: false,
			projectName: null,
			sourceLocale: null,
			targetLocales: null,
			initCommand: INIT_COMMAND,
			instructions: is401
				? "VOCODER_API_KEY is set but invalid or expired. Run `npx @vocoder/cli init` to get a new key, or [regenerate at vocoder.app](https://vocoder.app/dashboard)."
				: `Could not validate API key: ${msg}`,
			whatHappens: WHAT_HAPPENS,
		};
	}
}
