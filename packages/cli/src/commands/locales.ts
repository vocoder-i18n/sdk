import { CommandSession, joinHighlighted } from "../utils/command-session.js";
import { highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { VocoderAPI, VocoderAPIError } from "../utils/api.js";
import { getLimitErrorGuidance } from "./translate.js";

loadEnvFiles();

export interface LocaleCommandOptions {
	apiUrl?: string;
}

function getApiConfig(options: LocaleCommandOptions): {
	apiKey: string;
	apiUrl: string;
} | { error: string } {
	const apiKey = process.env.VOCODER_API_KEY;
	if (!apiKey) {
		return { error: "VOCODER_API_KEY is not set." };
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
	const session = new CommandSession("Vocoder Locales");

	const config = getApiConfig(options);
	if ("error" in config) {
		return session.fail(config.error, ["Run vocoder init to set up your project."]);
	}

	const api = new VocoderAPI(config);

	try {
		const projectConfig = await api.getAppConfig();

		const targetDisplay =
			projectConfig.targetLocales.length > 0
				? joinHighlighted(projectConfig.targetLocales)
				: "(none configured)";

		session.step("Source locale", highlight(projectConfig.sourceLocale));
		session.step("Target locales", targetDisplay);

		return session.end();
	} catch (error) {
		return session.fail(
			error instanceof Error ? error.message : "Failed to fetch app locales.",
		);
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
	const session = new CommandSession("Vocoder Locales");

	if (locales.length === 0) {
		return session.fail("No locale codes provided.");
	}

	const config = getApiConfig(options);
	if ("error" in config) {
		return session.fail(config.error, ["Run vocoder init to set up your project."]);
	}

	const api = new VocoderAPI(config);
	let lastTargetLocales: string[] = [];

	for (const locale of locales) {
		const step = session.startStep(`Adding ${highlight(locale)}`);

		try {
			const result = await api.addLocale(locale);
			lastTargetLocales = result.targetLocales;
			step.done(`Added ${highlight(locale)}`);
		} catch (error) {
			if (error instanceof VocoderAPIError && error.limitError) {
				const { limitError } = error;
				step.fail(limitError.message, getLimitErrorGuidance(limitError));
				return session.endFailure();
			}

			step.fail(
				error instanceof Error ? error.message : `Failed to add ${highlight(locale)}`,
			);
			return session.endFailure();
		}
	}

	if (lastTargetLocales.length > 0) {
		session.step("Target locales", joinHighlighted(lastTargetLocales), "info");
	}

	return session.end();
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
	const session = new CommandSession("Vocoder Locales");

	if (locales.length === 0) {
		return session.fail("No locale codes provided.");
	}

	const config = getApiConfig(options);
	if ("error" in config) {
		return session.fail(config.error, ["Run vocoder init to set up your project."]);
	}

	const api = new VocoderAPI(config);
	let lastTargetLocales: string[] = [];

	for (const locale of locales) {
		const step = session.startStep(`Removing ${highlight(locale)}`);

		try {
			const result = await api.removeLocale(locale);
			lastTargetLocales = result.targetLocales;
			step.done(`Removed ${highlight(locale)}`);
		} catch (error) {
			step.fail(
				error instanceof Error ? error.message : `Failed to remove ${highlight(locale)}`,
			);
			return session.endFailure();
		}
	}

	if (lastTargetLocales.length > 0) {
		session.step("Target locales", joinHighlighted(lastTargetLocales), "info");
	} else {
		session.step("Target locales", "(none configured)", "info");
	}

	return session.end();
}

/**
 * Lists all locales supported by Vocoder.
 * Useful for discovering valid BCP 47 codes before calling `add`.
 *
 * Endpoint: GET /api/cli/locales (accepts both user tokens and app API keys)
 */
export async function listSupportedLocales(options: LocaleCommandOptions = {}): Promise<number> {
	const session = new CommandSession("Vocoder Locales");

	const config = getApiConfig(options);
	if ("error" in config) {
		return session.fail(config.error, ["Run vocoder init to set up your project."]);
	}

	const api = new VocoderAPI(config);

	try {
		// GET /api/cli/locales accepts both user tokens and app API keys as Bearer tokens
		const result = await api.listLocales(config.apiKey);
		session.section("Source locales");
		printLocaleTable(result.sourceLocales, session);
		session.blank();
		session.section("Target locales");
		printLocaleTable(result.targetLocales, session);
		return session.end();
	} catch (error) {
		return session.fail(
			error instanceof Error ? error.message : "Failed to fetch supported locales.",
		);
	}
}

function printLocaleTable(
	locales: Array<{ code: string; name: string; nativeName?: string }>,
	session: CommandSession,
): void {
	for (const locale of locales) {
		const native =
			locale.nativeName && locale.nativeName !== locale.name
				? ` (${locale.nativeName})`
				: "";
		session.info(`  ${highlight(locale.code.padEnd(10))} ${locale.name}${native}`);
	}
}
