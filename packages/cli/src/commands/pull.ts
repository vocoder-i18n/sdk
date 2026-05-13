import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as p from "@clack/prompts";
import { computeFingerprint, detectAppDir, loadVocoderConfig } from "@vocoder/extractor";
import { extractProjectShortIdFromApiKey } from "@vocoder/core";
import type { VocoderTranslationData } from "@vocoder/core";
import { loadEnvFiles } from "../utils/load-env.js";
import { VocoderAPI } from "../utils/api.js";
import { detectBranch } from "../utils/branch.js";
import { StringExtractor } from "../utils/extract.js";
import { buildStringEntries } from "../utils/string-entries.js";
import { highlight } from "../utils/theme.js";
import type { PullOptions } from "../types.js";

loadEnvFiles();

// ── Per-app result type ───────────────────────────────────────────────────────

export interface AppPullResult {
	appDir: string;
	fingerprint: string;
	data: VocoderTranslationData;
}

// ── Core: extract → fingerprint → fetch bundle ────────────────────────────────

/**
 * Extract source strings for one app directory, compute the bundle fingerprint,
 * and fetch the compiled TranslationBundle from /api/t/{fingerprint}.
 *
 * This is the same data path the build plugin follows: the returned bundle is
 * identical to what __VOCODER_BUNDLE__ contains at runtime, including
 * TranslationOverride wins. It is NOT a branch snapshot.
 *
 * Exported for unit tests.
 */
export async function pullAppBundle(params: {
	projectShortId: string;
	appDir: string;
	projectRoot: string;
	api: VocoderAPI;
	fileConfig: ReturnType<typeof loadVocoderConfig>;
}): Promise<AppPullResult> {
	const { projectShortId, appDir, projectRoot, api, fileConfig } = params;

	const extractRoot = appDir ? resolve(projectRoot, appDir) : projectRoot;
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
	const stringEntries = buildStringEntries(extracted);
	const sourceKeys = stringEntries.map((e) => e.key);

	// Scope mirrors the server-side computeBundleFingerprint formula:
	//   hash(projectShortId + ":" + appDir + ":" + sortedKeys)
	const scope = `${projectShortId}:${appDir}`;
	const fingerprint = computeFingerprint(scope, sourceKeys);

	const data = await api.fetchBundle(fingerprint);
	return {
		appDir,
		fingerprint,
		data: data ?? {
			config: { sourceLocale: "", targetLocales: [], locales: {} },
			translations: {},
			updatedAt: null,
		},
	};
}

// ── Pure helpers (exported for tests) ────────────────────────────────────────

/** Filter a VocoderTranslationData bundle to a single locale. */
export function filterByLocale(
	data: VocoderTranslationData,
	locale: string,
): VocoderTranslationData {
	const localeData = data.translations[locale];
	return {
		...data,
		translations: localeData ? { [locale]: localeData } : {},
	};
}

/** True when the bundle is empty (no translations fetched yet). */
export function isBundleEmpty(data: VocoderTranslationData): boolean {
	return !data.config.sourceLocale;
}

// ── Main command ──────────────────────────────────────────────────────────────

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
	const projectRoot = process.cwd();

	// ── --snapshot: legacy branch-based audit mode ───────────────────────────
	// Reads from raw Translation rows, NOT from TranslationBundle.
	// Does not include TranslationOverride wins. Use for audit/debugging only.
	if (options.snapshot) {
		return pullSnapshot(api, options, projectRoot);
	}

	// ── Default: fingerprint-based bundle fetch ───────────────────────────────
	// Mirrors the build plugin exactly: extract → fingerprint → /api/t/{fingerprint}.
	// Returns what __VOCODER_BUNDLE__ contains at runtime (overrides applied).
	const projectShortId = extractProjectShortIdFromApiKey(apiKey);
	if (!projectShortId) {
		p.log.error("Invalid API key format. Expected a project key (vcp_...).");
		return 1;
	}

	const fileConfig = loadVocoderConfig(projectRoot);

	// --app-dirs overrides auto-detection. Without it, appDir is derived from
	// cwd relative to the git root (mirrors detectAppDir in the build plugin).
	const appDirs = options.appDirs
		? options.appDirs
				.split(",")
				.map((d) => d.trim().replace(/^\/|\/$/g, ""))
				.filter(Boolean)
		: [detectAppDir(projectRoot)];

	const spinner = p.spinner();
	const label =
		appDirs.length > 1
			? `${appDirs.length} apps`
			: highlight(appDirs[0] || "(root)");
	spinner.start(`Extracting strings and fetching bundle for ${label}…`);

	try {
		const results: AppPullResult[] = [];
		for (const appDir of appDirs) {
			const result = await pullAppBundle({
				projectShortId,
				appDir,
				projectRoot,
				api,
				fileConfig,
			});
			results.push(result);
		}

		const anyFound = results.some((r) => !isBundleEmpty(r.data));

		if (!anyFound) {
			spinner.stop("No bundle found");
			p.log.warn(
				"No translations found for the current string set. Run `vocoder translate` first.",
			);
			for (const r of results) {
				p.log.info(
					`  ${r.appDir || "(root)"}: fingerprint ${r.fingerprint} (no bundle)`,
				);
			}
			return 1;
		}

		spinner.stop("Bundle fetched");

		// Apply --locale filter
		const filtered = results.map((r) => ({
			...r,
			data: options.locale ? filterByLocale(r.data, options.locale) : r.data,
		}));

		if (options.output) {
			for (const r of filtered) {
				// In monorepo mode, nest output under the appDir so files don't collide
				const outDir =
					results.length > 1
						? join(options.output, r.appDir || ".")
						: options.output;
				writeLocaleFiles(r.data.translations, outDir);
			}
		} else {
			if (filtered.length === 1) {
				process.stdout.write(JSON.stringify(filtered[0]!.data, null, 2));
				process.stdout.write("\n");
			} else {
				// Multi-app: key output by appDir
				const out: Record<string, VocoderTranslationData> = {};
				for (const r of filtered) {
					out[r.appDir || "(root)"] = r.data;
				}
				process.stdout.write(JSON.stringify(out, null, 2));
				process.stdout.write("\n");
			}
		}

		return 0;
	} catch (error) {
		spinner.stop("Failed");
		p.log.error(error instanceof Error ? error.message : "Unknown error");
		return 1;
	}
}

// ── Legacy snapshot path ──────────────────────────────────────────────────────

async function pullSnapshot(
	api: VocoderAPI,
	options: PullOptions,
	_projectRoot: string,
): Promise<number> {
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
	spinner.start(`Fetching translation snapshot for ${highlight(branch)} (audit mode)…`);

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
		spinner.stop(`Fetched snapshot for ${highlight(branch)}`);

		if (snapshot.status === "NOT_FOUND") {
			p.log.warn(
				`No translation snapshot found for branch "${branch}". Run \`vocoder translate\` to generate one.`,
			);
			return 1;
		}

		const translations = snapshot.translations ?? {};

		p.log.warn(
			"Snapshot mode: data comes from raw Translation rows, not the compiled bundle. " +
				"TranslationOverrides are NOT applied. Use default mode for the live bundle.",
		);

		if (options.output) {
			writeLocaleFiles(translations, options.output);
		} else {
			process.stdout.write(JSON.stringify(translations, null, 2));
			process.stdout.write("\n");
		}

		return 0;
	} catch (error) {
		spinner.stop("Failed to fetch snapshot.");
		p.log.error(error instanceof Error ? error.message : "Unknown error.");
		return 1;
	}
}

// ── File output helper ────────────────────────────────────────────────────────

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
