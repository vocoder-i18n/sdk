import { resolve } from "node:path";
import {
	type VocoderAPI,
	StringExtractor,
	buildStringEntries,
	extractProjectShortIdFromApiKey,
	loadVocoderConfig,
} from "@vocoder/cli/lib";
import { computeFingerprint, detectAppDir } from "@vocoder/extractor";

export interface PullInput {
	/**
	 * Explicit app directory override for monorepos.
	 * When omitted, auto-detected from cwd relative to the git root
	 * (same logic as the build plugin).
	 */
	appDir?: string;
	/** Filter output to a single locale (e.g. "fr"). Returns all locales when omitted. */
	locale?: string;
}

/**
 * Fetch the compiled translation bundle for the current app.
 *
 * Extraction → fingerprint → GET /api/t/{fingerprint}.
 * Identical data path to the build plugin: returned bundle matches
 * __VOCODER_BUNDLE__ at runtime, TranslationOverrides included.
 */
export async function runPull(input: PullInput, api: VocoderAPI): Promise<string> {
	const apiKey = process.env.VOCODER_API_KEY ?? "";
	const projectShortId = extractProjectShortIdFromApiKey(apiKey);
	if (!projectShortId) {
		return "Invalid API key format. Expected a project key (vcp_...).";
	}

	const projectRoot = process.cwd();

	// appDir: explicit override or auto-detect from cwd vs git root
	const appDir = input.appDir !== undefined ? input.appDir : detectAppDir(projectRoot);
	const extractRoot = appDir ? resolve(projectRoot, appDir) : projectRoot;

	const fileConfig = loadVocoderConfig(projectRoot);
	const includePattern = fileConfig?.include?.length
		? fileConfig.include
		: ["**/*.{tsx,jsx,ts,js}"];
	const excludePattern = fileConfig?.exclude?.length ? fileConfig.exclude : undefined;

	const extractor = new StringExtractor();
	const extracted = await extractor.extractFromProject(
		includePattern,
		extractRoot,
		excludePattern,
	);

	if (extracted.length === 0) {
		return 'No translatable strings found. Wrap strings with <T>text</T> or t("text") and run vocoder_translate first.';
	}

	const stringEntries = buildStringEntries(extracted);
	const sourceKeys = stringEntries.map((e) => e.key);

	// Scope matches server-side computeBundleFingerprint
	const scope = `${projectShortId}:${appDir}`;
	const fingerprint = computeFingerprint(scope, sourceKeys);

	const bundle = await api.fetchBundle(fingerprint);

	if (!bundle || !bundle.config.sourceLocale) {
		return `No bundle found for fingerprint ${fingerprint}${appDir ? ` (appDir: ${appDir})` : ""}. Run vocoder_translate first to generate translations.`;
	}

	const translations = input.locale
		? { [input.locale]: bundle.translations[input.locale] ?? {} }
		: bundle.translations;

	const localeCount = Object.keys(translations).length;
	const stringCount = Object.values(translations).reduce(
		(sum, t) => sum + Object.keys(t ?? {}).length,
		0,
	);

	return JSON.stringify(
		{
			fingerprint,
			appDir: appDir || null,
			sourceLocale: bundle.config.sourceLocale,
			targetLocales: bundle.config.targetLocales,
			localeCount,
			stringCount,
			translations,
			updatedAt: bundle.updatedAt,
		},
		null,
		2,
	);
}
