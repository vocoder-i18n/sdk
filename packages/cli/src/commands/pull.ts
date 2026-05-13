import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { VocoderAPI } from "../utils/api.js";
import { detectBranch } from "../utils/branch.js";

loadEnvFiles();

export interface PullOptions {
	branch?: string;
	locale?: string;
	/** Write one <locale>.json per locale to this directory. Prints to stdout if omitted. */
	output?: string;
	apiUrl?: string;
}

export async function pull(options: PullOptions = {}): Promise<number> {
	const apiKey = process.env.VOCODER_API_KEY;
	if (!apiKey) {
		p.log.error(
			"VOCODER_API_KEY is not set. Run `npx @vocoder/cli init` to set up your app.",
		);
		return 1;
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiKey, apiUrl });

	let branch: string;
	try {
		branch = detectBranch(options.branch);
	} catch (error) {
		p.log.error(
			error instanceof Error ? error.message : "Failed to detect branch.",
		);
		return 1;
	}

	const spinner = p.spinner();
	spinner.start(`Fetching translations for ${highlight(branch)}…`);

	try {
		const projectConfig = await api.getAppConfig();
		const targetLocales = options.locale
			? [options.locale]
			: projectConfig.targetLocales;

		if (targetLocales.length === 0) {
			spinner.stop("No target locales configured.");
			p.log.info("Add target locales with `vocoder locales add <code>`.");
			return 1;
		}

		const snapshot = await api.getTranslationSnapshot({ branch, targetLocales });
		spinner.stop(`Fetched translations for ${highlight(branch)}`);

		if (snapshot.status === "NOT_FOUND") {
			p.log.warn(
				`No translation snapshot found for branch "${branch}". ` +
					"Run `vocoder translate` to generate one.",
			);
			return 1;
		}

		const translations = snapshot.translations ?? {};

		if (options.output) {
			writeLocaleFiles(translations, options.output);
		} else {
			process.stdout.write(JSON.stringify(translations, null, 2));
			process.stdout.write("\n");
		}

		return 0;
	} catch (error) {
		spinner.stop("Failed to fetch translations.");
		p.log.error(
			error instanceof Error ? error.message : "Unknown error.",
		);
		return 1;
	}
}

function writeLocaleFiles(
	translations: Record<string, Record<string, string>>,
	outputDir: string,
): void {
	mkdirSync(outputDir, { recursive: true });

	for (const [locale, strings] of Object.entries(translations)) {
		const filePath = join(outputDir, `${locale}.json`);
		writeFileSync(filePath, JSON.stringify(strings, null, 2) + "\n", "utf-8");
		p.log.success(`Wrote ${highlight(filePath)}`);
	}
}
