import { detectRepoIdentity } from "@vocoder/plugin";
import type { VocoderClient } from "../client.js";

/**
 * Add a target locale to the Vocoder app.
 * Idempotent: returns success even if the locale is already configured.
 *
 * @param locale  BCP 47 locale code, e.g. "fr" or "pt-BR".
 * @param client  Authenticated VocoderClient instance.
 */
export async function runAddLocale(
	locale: string,
	client: VocoderClient,
): Promise<string> {
	const identity = detectRepoIdentity();
	const result = await client.addLocale(locale, identity?.repoCanonical);
	return `Locale "${locale}" added. Target locales are now: ${result.targetLocales.join(", ")}.`;
}

/**
 * Remove a target locale from the Vocoder app.
 * Idempotent: returns success even if the locale is not currently configured.
 *
 * @param locale  BCP 47 locale code, e.g. "fr" or "pt-BR".
 * @param client  Authenticated VocoderClient instance.
 */
export async function runRemoveLocale(
	locale: string,
	client: VocoderClient,
): Promise<string> {
	const identity = detectRepoIdentity();
	const result = await client.removeLocale(locale, identity?.repoCanonical);
	const remaining =
		result.targetLocales.length > 0
			? result.targetLocales.join(", ")
			: "(none)";
	return `Locale "${locale}" removed. Target locales are now: ${remaining}.`;
}
