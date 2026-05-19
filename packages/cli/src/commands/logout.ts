import { CommandSession } from "../utils/command-session.js";
import { VocoderAPI } from "../utils/api.js";
import { clearAuthData, readAuthData } from "../utils/auth-store.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { highlight } from "../utils/theme.js";

loadEnvFiles();

export interface LogoutOptions {
	apiUrl?: string;
}

export async function logout(options: LogoutOptions = {}): Promise<number> {
	const session = new CommandSession("Vocoder Logout");

	const stored = readAuthData();

	if (!stored) {
		session.warn("Not logged in.");
		return session.end();
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiUrl, apiKey: "" });

	try {
		await api.revokeCliToken(stored.token);
	} catch {
		// Ignore errors — we still clear local data even if the server call fails
	}

	clearAuthData();
	session.step("Logged out", highlight(stored.email));
	return session.end();
}
