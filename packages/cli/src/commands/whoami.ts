import * as p from "@clack/prompts";

import { VocoderAPI, VocoderAPIError } from "../utils/api.js";

import chalk from "chalk";
import { highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { readAuthData } from "../utils/auth-store.js";

loadEnvFiles();

export interface WhoamiOptions {
	apiUrl?: string;
}

export async function whoami(options: WhoamiOptions = {}): Promise<number> {
	p.intro(chalk.bold("Vocoder Whoami"));

	const stored = readAuthData();

	if (!stored) {
		p.log.error("Not logged in.");
		p.log.info(`  Run ${highlight("vocoder init")} to authenticate.`);
		p.outro("");
		return 1;
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiUrl, apiKey: "" });

	try {
		const info = await api.getCliUserInfo(stored.token);
		p.log.success(`Logged in as ${highlight(info.email)}`);
		if (info.name) {
			p.log.success(`Name: ${highlight(info.name)}`);
		}
		p.outro("");
		return 0;
	} catch (err) {
		if (err instanceof VocoderAPIError) {
			p.log.error("Stored credentials are invalid or expired.");
			p.log.info(`  Run ${highlight("vocoder init")} to re-authenticate.`);
		} else {
			p.log.error("Could not reach server.");
			p.log.info("  Check your network connection or try again.");
		}
		p.outro("");
		return 1;
	}
}
