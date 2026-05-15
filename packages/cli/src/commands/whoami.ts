import * as p from "@clack/prompts";
import chalk from "chalk";
import { VocoderAPI } from "../utils/api.js";
import { readAuthData } from "../utils/auth-store.js";
import { highlight } from "../utils/theme.js";

export interface WhoamiOptions {
	apiUrl?: string;
}

export async function whoami(options: WhoamiOptions = {}): Promise<number> {
	p.intro(chalk.bold("Vocoder Whoami"));

	const stored = readAuthData();

	if (!stored) {
		p.log.info("Not logged in. Run `vocoder init` to authenticate.");
		p.outro("");
		return 1;
	}

	const apiUrl = options.apiUrl ?? stored.apiUrl ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiUrl, apiKey: "" });

	try {
		const info = await api.getCliUserInfo(stored.token);
		p.log.info(`Logged in as ${highlight(info.email)}`);
		if (info.name) {
			p.log.info(`Name: ${info.name}`);
		}
		p.log.info(`API: ${highlight(apiUrl)}`);
		p.outro("");
		return 0;
	} catch {
		p.log.error(
			"Stored credentials are invalid or expired. Run `vocoder init` to re-authenticate.",
		);
		p.outro("");
		return 1;
	}
}
