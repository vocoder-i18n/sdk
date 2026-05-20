import { CommandSession } from "../utils/command-session.js";
import { VocoderAPI } from "../utils/api.js";
import { highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { verifyStoredAuth } from "../utils/auth-store.js";

loadEnvFiles();

export interface AuthStatusOptions {
	apiUrl?: string;
}

export async function authStatus(options: AuthStatusOptions = {}): Promise<number> {
	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const session = new CommandSession("Vocoder Auth");
	const api = new VocoderAPI({ apiUrl, apiKey: "" });
	const storedAuth = await verifyStoredAuth(api);

	if (storedAuth.status === "valid") {
		session.step("Signed in", highlight("Yes"));
		session.step("Account", highlight(storedAuth.email));
		if (storedAuth.name) {
			session.step("Name", highlight(storedAuth.name));
		}
		return session.end();
	}

	if (storedAuth.status === "unreachable") {
		session.step("Signed in", highlight("Yes"));
		session.step("Account", highlight(storedAuth.stored.email));
		session.warn("Could not verify the stored account with the server.");
		session.info(storedAuth.message);
		return session.endFailure();
	}

	session.step("Signed in", highlight("No"));
	session.info(`Run ${highlight("vocoder auth login")} to sign in.`);
	return session.endFailure();
}
