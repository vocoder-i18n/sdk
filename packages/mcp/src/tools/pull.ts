import type { VocoderAPI } from "@vocoder/cli/lib";

export interface PullInput {
	branch?: string;
	locale?: string;
}

export async function runPull(input: PullInput, api: VocoderAPI): Promise<string> {
	const branch = input.branch ?? "main";

	let locales: string[];
	if (input.locale) {
		locales = [input.locale];
	} else {
		const config = await api.getAppConfig();
		locales = config.targetLocales;
		if (locales.length === 0) {
			return "No target locales configured. Add locales to your project first.";
		}
	}

	const snapshot = await api.getTranslationSnapshot({ branch, targetLocales: locales });

	if (snapshot.status === "NOT_FOUND") {
		return `No translations found for branch "${branch}". Run vocoder_translate first to generate translations.`;
	}

	const translations = snapshot.translations ?? {};

	if (Object.keys(translations).length === 0) {
		return `No translations available yet for branch "${branch}".`;
	}

	if (input.locale) {
		const localeTrans = translations[input.locale];
		if (!localeTrans) {
			return `No translations found for locale "${input.locale}" on branch "${branch}".`;
		}
		return JSON.stringify({ branch, locale: input.locale, translations: localeTrans }, null, 2);
	}

	return JSON.stringify({ branch, translations }, null, 2);
}
