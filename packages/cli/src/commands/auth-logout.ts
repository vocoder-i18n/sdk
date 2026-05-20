import { CommandSession } from "../utils/command-session.js";
import { VocoderAPI } from "../utils/api.js";
import { clearAuthData, readAuthData } from "../utils/auth-store.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { highlight } from "../utils/theme.js";

loadEnvFiles();

export interface AuthLogoutOptions {
	apiUrl?: string;
}

export async function authLogout(options: AuthLogoutOptions = {}): Promise<number> {
	const session = new CommandSession("Vocoder Auth");
	const stored = readAuthData();

	if (!stored) {
		session.step("Signed in", highlight("No"));
		return session.end();
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiUrl, apiKey: "" });

	try {
		await api.revokeCliToken(stored.token);
	} catch {
		// Best-effort revoke — always clear local auth.
	}

	clearAuthData();
	session.step("Logged out", highlight(stored.email));
	return session.end();
}
