import { VocoderAPI, VocoderAPIError } from "../utils/api.js";

import { CommandSession } from "../utils/command-session.js";
import { highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { readAuthData } from "../utils/auth-store.js";

loadEnvFiles();

export interface WhoamiOptions {
	apiUrl?: string;
}

export async function whoami(options: WhoamiOptions = {}): Promise<number> {
	const session = new CommandSession("Vocoder Whoami");

	const stored = readAuthData();

	if (!stored) {
		return session.fail("Not logged in.", ["Run vocoder init to authenticate."]);
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiUrl, apiKey: "" });

	try {
		const info = await api.getCliUserInfo(stored.token);
		session.step("Authenticated as", highlight(info.email));
		if (info.name) {
			session.step("Name", highlight(info.name));
		}
		return session.end();
	} catch (err) {
		if (err instanceof VocoderAPIError) {
			return session.fail("Stored credentials are invalid or expired.", [
				"Run vocoder init to re-authenticate.",
			]);
		}
		return session.fail("Could not reach the server.", [
			"Check your network connection and try again.",
		]);
	}
}
