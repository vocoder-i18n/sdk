import { CommandSession, formatLabelValue } from "../utils/command-session.js";
import type { AccountAuthOptions } from "../types.js";
import { VocoderAPI } from "../utils/api.js";
import { highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { ensureAccountAuth } from "../utils/account-auth.js";

loadEnvFiles();

export type AuthLoginOptions = AccountAuthOptions;

export async function authLogin(options: AuthLoginOptions = {}): Promise<number> {
	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const debug = options.verbose ?? false;
	const session = new CommandSession("Vocoder Auth");
	const api = new VocoderAPI({ apiUrl, apiKey: "", debug });

	const authResult = await ensureAccountAuth({
		api,
		session,
		options,
		loginIfNeeded: "always",
	});

	if (authResult.status === "authenticated") {
		if (authResult.source === "stored") {
			session.step("Signed in", highlight("Yes"));
			session.step("Account", highlight(authResult.auth.email));
			if (authResult.auth.name) {
				session.step("Name", highlight(authResult.auth.name));
			}
		}
		return session.end();
	}

	if (authResult.status === "unreachable") {
		session.info(formatLabelValue("Account", highlight(authResult.stored.email)));
		return session.fail("Could not verify stored credentials.", [
			authResult.message,
			"Check your connection and try vocoder auth status or vocoder auth login again.",
		]);
	}

	if (authResult.status === "required") {
		return session.fail("Interactive sign-in is not available in this shell.", [
			`Run ${highlight(authResult.command)}.`,
		]);
	}

	return session.cancelled();
}
