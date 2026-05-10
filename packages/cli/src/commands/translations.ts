import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { active, highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { VocoderAPI } from "../utils/api.js";
import { detectBranch } from "../utils/branch.js";

loadEnvFiles();

export interface TranslationsOptions {
	/** Git branch. Auto-detected from git/CI env if omitted. */
	branch?: string;
	/** Specific target locale to fetch. All configured locales if omitted. */
	locale?: string;
	/**
	 * Output directory for locale JSON files.
	 * When set, writes one <locale>.json per locale to this directory.
	 * When omitted, prints the full snapshot as JSON to stdout.
	 */
	output?: string;
	apiUrl?: string;
}

/**
 * Downloads the current translation snapshot for the app.
 *
 * With --output <dir>: writes one <locale>.json file per locale to the
 * specified directory. Each file shape: { "source text": "translated text" }.
 *
 * Without --output: prints the full snapshot JSON to stdout, suitable
 * for piping or programmatic use.
 *
 * Reads the app API key from VOCODER_API_KEY.
 * Endpoint: GET /api/cli/sync/snapshot
 *
 * @param options.branch  Git branch (auto-detected from git/CI if omitted).
 * @param options.locale  Specific target locale; all configured locales if omitted.
 * @param options.output  Output directory. Omit to print to stdout.
 *
 * @throws If VOCODER_API_KEY is missing or invalid.
 */
export async function getTranslations(options: TranslationsOptions = {}): Promise<number> {
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
		// Fetch the app config to resolve which target locales to request
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
					"Run `vocoder sync` to generate one.",
			);
			return 1;
		}

		const translations = snapshot.translations ?? {};

		if (options.output) {
			writeLocaleFiles(translations, options.output);
		} else {
			// stdout — raw JSON for piping/programmatic use
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

/**
 * Writes one <locale>.json file per locale to the output directory.
 * Creates the directory if it does not exist.
 * Each file shape: { "source text": "translated text" }
 */
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
