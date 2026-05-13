import type { VocoderAPI } from "@vocoder/cli/lib";

export async function runAddLocale(locale: string, api: VocoderAPI): Promise<string> {
	const result = await api.addLocale(locale);
	return `Locale "${locale}" added. Target locales are now: ${result.targetLocales.join(", ")}.`;
}

export async function runRemoveLocale(locale: string, api: VocoderAPI): Promise<string> {
	const result = await api.removeLocale(locale);
	const remaining = result.targetLocales.length > 0 ? result.targetLocales.join(", ") : "(none)";
	return `Locale "${locale}" removed. Target locales are now: ${remaining}.`;
}
