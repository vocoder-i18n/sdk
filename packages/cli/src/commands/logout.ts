import * as p from "@clack/prompts";
import chalk from "chalk";
import { VocoderAPI } from "../utils/api.js";
import { clearAuthData, readAuthData } from "../utils/auth-store.js";
import { highlight } from "../utils/theme.js";

export interface LogoutOptions {
	apiUrl?: string;
}

export async function logout(options: LogoutOptions = {}): Promise<number> {
	p.intro(chalk.bold("Vocoder Logout"));

	const stored = readAuthData();

	if (!stored) {
		p.log.info("Not currently authenticated.");
		p.outro("");
		return 0;
	}

	const apiUrl = options.apiUrl ?? stored.apiUrl ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiUrl, apiKey: "" });

	try {
		await api.revokeCliToken(stored.token);
	} catch {
		// Ignore errors — we still clear local data even if the server call fails
	}

	clearAuthData();
	p.log.success(`Logged out (was ${highlight(stored.email)})`);
	p.outro("");
	return 0;
}
