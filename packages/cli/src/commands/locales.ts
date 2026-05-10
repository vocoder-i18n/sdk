import * as p from "@clack/prompts";
import chalk from "chalk";
import { active, highlight } from "../utils/theme.js";
import { config as loadEnv } from "dotenv";
import { readFileSync } from "node:fs";
import { VocoderAPI, VocoderAPIError } from "../utils/api.js";
import { findExistingConfig } from "../utils/write-config.js";
import { getLimitErrorGuidance } from "./sync.js";

loadEnv();

export interface LocaleCommandOptions {
	apiUrl?: string;
}

/**
 * Read the appId from the nearest vocoder.config.ts/js in the CWD.
 * Returns undefined when no config file is found or it contains no appId.
 */
function readLocalAppId(): string | undefined {
	const configPath = findExistingConfig(process.cwd());
	if (!configPath) return undefined;
	try {
		const content = readFileSync(configPath, "utf-8");
		const match = content.match(/appId:\s*['"]([^'"]+)['"]/);
		return match?.[1];
	} catch {
		return undefined;
	}
}

function getApiConfig(options: LocaleCommandOptions): {
	apiKey: string;
	apiUrl: string;
} | null {
	const apiKey = process.env.VOCODER_API_KEY;
	if (!apiKey) {
		p.log.error(
			"VOCODER_API_KEY is not set. Run `npx @vocoder/cli init` to set up your app.",
		);
		return null;
	}
	return {
		apiKey,
		apiUrl: options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app",
	};
}

/**
 * Lists the app's configured source locale and target locales.
 * Reads the app API key from VOCODER_API_KEY.
 *
 * Endpoint: GET /api/cli/config
 *
 * @throws If VOCODER_API_KEY is missing or the API call fails.
 */
export async function listProjectLocales(options: LocaleCommandOptions = {}): Promise<number> {
	const config = getApiConfig(options);
	if (!config) return 1;

	const api = new VocoderAPI(config);

	try {
		const projectConfig = await api.getAppConfig();

		p.log.info(
			`Source locale:  ${highlight(projectConfig.sourceLocale)}`,
		);

		if (projectConfig.targetLocales.length === 0) {
			p.log.info("Target locales: (none configured)");
		} else {
			p.log.info(
				`Target locales: ${projectConfig.targetLocales.map((l) => highlight(l)).join(", ")}`,
			);
		}

		return 0;
	} catch (error) {
		p.log.error(
			error instanceof Error ? error.message : "Failed to fetch app locales.",
		);
		return 1;
	}
}

/**
 * Adds one or more target locales to the app.
 * Loops per locale — the API accepts one locale at a time.
 * Idempotent: locales already configured are silently skipped.
 *
 * Endpoint: POST /api/cli/app/locales (one call per locale)
 *
 * @param locales  Array of BCP 47 locale codes to add, e.g. ["fr", "de", "pt-BR"].
 * @throws {VocoderAPIError} status 422 for invalid/unsupported locale code.
 * @throws {VocoderAPIError} status 403 when the plan's maxTargetLocalesPerApp limit is reached.
 */
export async function addLocales(
	locales: string[],
	options: LocaleCommandOptions = {},
): Promise<number> {
	if (locales.length === 0) {
		p.log.error("No locale codes provided.");
		return 1;
	}

	const config = getApiConfig(options);
	if (!config) return 1;

	const api = new VocoderAPI(config);
	const appId = readLocalAppId();
	let lastTargetLocales: string[] = [];
	let hadError = false;

	for (const locale of locales) {
		const spinner = p.spinner();
		spinner.start(`Adding ${locale}…`);

		try {
			const result = await api.addLocale(locale, undefined, appId);
			lastTargetLocales = result.targetLocales;
			spinner.stop(`Added ${highlight(locale)}`);
		} catch (error) {
			spinner.stop(`Failed to add ${chalk.red(locale)}`);
			hadError = true;

			if (error instanceof VocoderAPIError && error.limitError) {
				const { limitError } = error;
				p.log.error(limitError.message);
				for (const line of getLimitErrorGuidance(limitError)) {
					p.log.info(line);
				}
				// Plan limit hit — remaining locales will also fail, so stop early
				break;
			}

			p.log.error(
				error instanceof Error ? error.message : "Unknown error",
			);
		}
	}

	if (lastTargetLocales.length > 0) {
		p.log.info(
			`Target locales now: ${lastTargetLocales.map((l) => highlight(l)).join(", ")}`,
		);
	}

	return hadError ? 1 : 0;
}

/**
 * Removes one or more target locales from the app.
 * Loops per locale — the API accepts one locale at a time.
 * Idempotent: locales not currently configured are silently skipped.
 *
 * Endpoint: DELETE /api/cli/app/locales (one call per locale)
 *
 * @param locales  Array of BCP 47 locale codes to remove, e.g. ["fr", "de"].
 */
export async function removeLocales(
	locales: string[],
	options: LocaleCommandOptions = {},
): Promise<number> {
	if (locales.length === 0) {
		p.log.error("No locale codes provided.");
		return 1;
	}

	const config = getApiConfig(options);
	if (!config) return 1;

	const api = new VocoderAPI(config);
	const appId = readLocalAppId();
	let lastTargetLocales: string[] = [];
	let hadError = false;

	for (const locale of locales) {
		const spinner = p.spinner();
		spinner.start(`Removing ${locale}…`);

		try {
			const result = await api.removeLocale(locale, undefined, appId);
			lastTargetLocales = result.targetLocales;
			spinner.stop(`Removed ${highlight(locale)}`);
		} catch (error) {
			spinner.stop(`Failed to remove ${chalk.red(locale)}`);
			hadError = true;
			p.log.error(
				error instanceof Error ? error.message : "Unknown error",
			);
		}
	}

	if (lastTargetLocales.length > 0) {
		p.log.info(
			`Target locales now: ${lastTargetLocales.map((l) => highlight(l)).join(", ")}`,
		);
	} else if (!hadError) {
		p.log.info("Target locales now: (none configured)");
	}

	return hadError ? 1 : 0;
}

/**
 * Lists all locales supported by Vocoder.
 * Useful for discovering valid BCP 47 codes before calling `add`.
 *
 * Endpoint: GET /api/cli/locales (accepts both user tokens and app API keys)
 */
export async function listSupportedLocales(options: LocaleCommandOptions = {}): Promise<number> {
	const config = getApiConfig(options);
	if (!config) return 1;

	const api = new VocoderAPI(config);

	try {
		// GET /api/cli/locales accepts both user tokens and app API keys as Bearer tokens
		const result = await api.listLocales(config.apiKey);
		p.log.info(chalk.bold("Source locales:"));
		printLocaleTable(result.sourceLocales);
		p.log.info("");
		p.log.info(chalk.bold("Target locales:"));
		printLocaleTable(result.targetLocales);
		return 0;
	} catch (error) {
		p.log.error(
			error instanceof Error ? error.message : "Failed to fetch supported locales.",
		);
		return 1;
	}
}

function printLocaleTable(
	locales: Array<{ code: string; name: string; nativeName?: string }>,
): void {
	for (const locale of locales) {
		const native =
			locale.nativeName && locale.nativeName !== locale.name
				? ` (${locale.nativeName})`
				: "";
		p.log.info(`  ${highlight(locale.code.padEnd(10))} ${locale.name}${native}`);
	}
}
