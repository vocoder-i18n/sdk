import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { highlight } from "../utils/theme.js";
import type { VocoderTranslationData } from "@vocoder/config";
import { computeFingerprint, loadVocoderConfig } from "@vocoder/extractor";
import type {
	EffectiveSyncMode,
	ExtractedString,
	LimitErrorResponse,
	LocalesMap,
	ProjectConfig,
	RequestedSyncMode,
	SyncPolicyConfig,
	TranslateOptions,
	TranslationStringEntry,
} from "../types.js";
import { VocoderAPI, VocoderAPIError } from "../utils/api.js";
import { detectBranch, isTargetBranch } from "../utils/branch.js";
import { extractShortCodeFromApiKey, getMergedConfig, validateLocalConfig } from "../utils/config.js";
import { StringExtractor } from "../utils/extract.js";
import {
	detectCommitSha,
	resolveGitRepositoryIdentity,
} from "../utils/git-identity.js";

type LocaleMetadataMap = LocalesMap;
type TranslationMap = Record<string, Record<string, string>>;
type TranslationArtifactSource = "fresh" | "local-cache" | "api-snapshot";

type TranslationArtifacts = {
	source: TranslationArtifactSource;
	translations: TranslationMap;
	localeMetadata?: LocaleMetadataMap;
	snapshotBatchId?: string;
	completedAt?: string | null;
};


function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLocaleMetadata(value: unknown): LocaleMetadataMap | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const metadata: LocaleMetadataMap = {};
	for (const [locale, rawValue] of Object.entries(value)) {
		if (!isRecord(rawValue)) {
			continue;
		}

		const nativeName = rawValue.nativeName;
		if (typeof nativeName !== "string" || nativeName.trim().length === 0) {
			continue;
		}

		const entry: { nativeName: string; dir?: "rtl" } = { nativeName };
		if (rawValue.dir === "rtl") {
			entry.dir = "rtl";
		}

		metadata[locale] = entry;
	}

	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function parseTranslations(value: unknown): TranslationMap | null {
	if (!isRecord(value)) {
		return null;
	}

	const translations: TranslationMap = {};

	for (const [locale, localeValue] of Object.entries(value)) {
		if (!isRecord(localeValue)) {
			continue;
		}

		const localeTranslations: Record<string, string> = {};
		for (const [source, translated] of Object.entries(localeValue)) {
			if (typeof translated === "string") {
				localeTranslations[source] = translated;
			}
		}

		translations[locale] = localeTranslations;
	}

	return Object.keys(translations).length > 0 ? translations : null;
}

function getCacheFilePath(projectRoot: string, fingerprint: string): string {
	return join(projectRoot, "node_modules", ".vocoder", "cache", `${fingerprint}.json`);
}

function buildTranslationData(params: {
	sourceLocale: string;
	targetLocales: string[];
	translations: TranslationMap;
	localeMetadata?: LocaleMetadataMap;
	updatedAt: string;
}): VocoderTranslationData {
	// Translations from the API are already key-keyed ({ [sourceKey]: translatedText }).
	// No remapping needed — pass through directly.
	const locales: Record<string, { nativeName: string; dir?: "rtl" }> = {};
	for (const code of [params.sourceLocale, ...params.targetLocales]) {
		const meta = params.localeMetadata?.[code];
		if (meta) locales[code] = { nativeName: meta.nativeName, ...(meta.dir ? { dir: meta.dir } : {}) };
	}

	return {
		config: { sourceLocale: params.sourceLocale, targetLocales: params.targetLocales, locales },
		translations: params.translations,
		updatedAt: params.updatedAt,
	};
}

function readLocalCache(params: {
	projectRoot: string;
	fingerprint: string;
}): TranslationArtifacts | null {
	const cacheFilePath = getCacheFilePath(params.projectRoot, params.fingerprint);
	if (!existsSync(cacheFilePath)) return null;
	try {
		const raw = readFileSync(cacheFilePath, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (!isRecord(parsed)) return null;
		// VocoderTranslationData shape: { config, translations, updatedAt }
		const inner = isRecord(parsed.config) ? parsed : null;
		if (!inner) return null;
		const translations = parseTranslations(inner.translations);
		if (!translations) return null;
		const localeMetadata = isRecord(inner.config)
			? parseLocaleMetadata(inner.config.locales)
			: undefined;
		return { source: "local-cache", translations, localeMetadata };
	} catch {
		return null;
	}
}

function writeCache(params: {
	projectRoot: string;
	fingerprint: string;
	data: VocoderTranslationData;
}): string {
	const cacheDir = join(params.projectRoot, "node_modules", ".vocoder", "cache");
	mkdirSync(cacheDir, { recursive: true });
	const cacheFilePath = getCacheFilePath(params.projectRoot, params.fingerprint);
	writeFileSync(cacheFilePath, JSON.stringify(params.data), "utf-8");
	return cacheFilePath;
}

function resolveEffectiveModeFromPolicy(params: {
	branch: string;
	requestedMode: RequestedSyncMode;
	policy: SyncPolicyConfig;
}): EffectiveSyncMode {
	const { requestedMode, policy, branch } = params;

	let mode: EffectiveSyncMode;
	if (requestedMode === "auto") {
		const isBlockingBranch = isTargetBranch(branch, policy.blockingBranches);
		mode = isBlockingBranch ? policy.blockingMode : policy.nonBlockingMode;
	} else {
		mode = requestedMode;
	}

	return mode;
}

function resolveWaitTimeoutMs(params: {
	requestedMaxWaitMs?: number;
	policyDefaultMaxWaitMs?: number;
	fallbackTimeoutMs: number;
}): number {
	if (
		typeof params.requestedMaxWaitMs === "number" &&
		Number.isFinite(params.requestedMaxWaitMs) &&
		params.requestedMaxWaitMs > 0
	) {
		return Math.floor(params.requestedMaxWaitMs);
	}

	if (
		typeof params.policyDefaultMaxWaitMs === "number" &&
		Number.isFinite(params.policyDefaultMaxWaitMs) &&
		params.policyDefaultMaxWaitMs > 0
	) {
		return Math.floor(params.policyDefaultMaxWaitMs);
	}

	return params.fallbackTimeoutMs;
}

function normalizeTranslations(params: {
	sourceLocale: string;
	targetLocales: string[];
	stringEntries: TranslationStringEntry[];
	translations: TranslationMap;
}): TranslationMap {
	const merged: TranslationMap = {};

	for (const [locale, values] of Object.entries(params.translations)) {
		merged[locale] = { ...values };
	}

	const expectedLocales = [
		params.sourceLocale,
		...params.targetLocales.filter((locale) => locale !== params.sourceLocale),
	];

	for (const locale of expectedLocales) {
		if (!merged[locale]) {
			merged[locale] = {};
		}
	}

	if (!merged[params.sourceLocale]) {
		merged[params.sourceLocale] = {};
	}

	// Ensure source locale has an identity mapping (key → text) for all known strings.
	// id-only entries (text: null) are skipped — their source text is in a localesPath file.
	for (const entry of params.stringEntries) {
		if (!entry.text) continue;
		if (!(entry.key in merged[params.sourceLocale]!)) {
			merged[params.sourceLocale]![entry.key] = entry.text;
		}
	}

	return merged;
}

export function getLimitErrorGuidance(
	limitError: LimitErrorResponse,
): string[] {
	if (limitError.limitType === "providers") {
		return [
			"Provider setup required.",
			"Add a DeepL API key in Dashboard -> Workspace Settings -> Providers.",
			`Open settings: ${limitError.upgradeUrl}`,
		];
	}

	if (limitError.limitType === "translation_chars") {
		return [
			"Monthly translation character limit reached.",
			`Used this month: ${limitError.current.toLocaleString()} chars`,
			`Requested after sync: ${limitError.required.toLocaleString()} chars`,
			`Upgrade plan: ${limitError.upgradeUrl}`,
		];
	}

	if (limitError.limitType === "source_strings") {
		return [
			"Active source string limit reached.",
			`Current active strings: ${limitError.current.toLocaleString()}`,
			`Required for this sync: ${limitError.required.toLocaleString()}`,
			`Upgrade plan: ${limitError.upgradeUrl}`,
		];
	}

	if (limitError.limitType === "target_locales") {
		return [
			`Current target locales: ${limitError.current}`,
			`Plan limit: ${limitError.current} (${limitError.planId})`,
			`Upgrade plan: ${limitError.upgradeUrl}`,
		];
	}

	return [
		`Plan: ${limitError.planId}`,
		`Current: ${limitError.current}`,
		`Required: ${limitError.required}`,
		`Upgrade: ${limitError.upgradeUrl}`,
	];
}

function getSyncPolicyErrorGuidance(
	error: NonNullable<VocoderAPIError["syncPolicyError"]>,
): string[] {
	if (error.errorCode === "BRANCH_NOT_ALLOWED") {
		const lines = ["This branch is not allowed for this project."];
		if (error.branch) {
			lines.push(`Current branch: ${error.branch}`);
		}
		// targetBranches removed — configure branches in project settings
		lines.push(
			"Update your project target branches in the dashboard if needed.",
		);
		return lines;
	}

	const lines = ["This project is bound to a different repository."];
	if (error.boundRepoLabel) {
		lines.push(`Bound repository: ${error.boundRepoLabel}`);
	}
	if (error.boundScopePath) {
		lines.push(`Bound scope: ${error.boundScopePath}`);
	}
	lines.push(
		"Run `vocoder init` from the correct repository or create a separate project.",
	);
	return lines;
}

function mergeContext(
	current: string | undefined,
	incoming: string | undefined,
): string | undefined {
	if (!incoming) return current;
	if (!current) return incoming;
	if (current === incoming) return current;

	const merged = new Set(
		[...current.split(" | "), ...incoming.split(" | ")]
			.map((part) => part.trim())
			.filter(Boolean),
	);
	return Array.from(merged).join(" | ");
}

function buildStringEntries(
	extractedStrings: ExtractedString[],
): TranslationStringEntry[] {
	const byKey = new Map<string, TranslationStringEntry>();

	for (const str of extractedStrings) {
		const existing = byKey.get(str.key);
		if (!existing) {
			byKey.set(str.key, {
				key: str.key,
				text: str.text,
				...(str.context ? { context: str.context } : {}),
				...(str.formality ? { formality: str.formality } : {}),
				...(str.uiRole ? { uiRole: str.uiRole } : {}),
			});
			continue;
		}

		existing.context = mergeContext(existing.context, str.context);

		if (!existing.formality && str.formality) {
			existing.formality = str.formality;
		} else if (
			existing.formality &&
			str.formality &&
			existing.formality !== str.formality
		) {
			existing.formality = "auto";
		}
	}

	return Array.from(byKey.values());
}

async function fetchApiSnapshot(
	api: VocoderAPI,
	params: {
		branch: string;
		targetLocales: string[];
	},
): Promise<TranslationArtifacts | null> {
	const snapshot = await api.getTranslationSnapshot({
		branch: params.branch,
		targetLocales: params.targetLocales,
	});

	if (snapshot.status !== "FOUND" || !snapshot.translations) {
		return null;
	}

	return {
		source: "api-snapshot",
		translations: snapshot.translations,
		localeMetadata: snapshot.localeMetadata,
		snapshotBatchId: snapshot.snapshotBatchId,
		completedAt: snapshot.completedAt,
	};
}

/**
 * Main sync command
 */
export async function sync(options: TranslateOptions = {}): Promise<number> {
	const startTime = Date.now();
	const projectRoot = process.cwd();

	p.intro(chalk.bold("Vocoder Sync"));

	// Check for API key before doing any work — missing key is an onboarding
	// issue, not an error. Show friendly guidance and exit cleanly.
	const mergedConfig = await getMergedConfig(options, options.verbose);
	if (!mergedConfig.apiKey) {
		p.log.warn("No API key found. Run init to get started:");
		p.log.info("  npx @vocoder/cli init");
		p.log.info("");
		p.log.info(
			"  Or add your key to .env: VOCODER_API_KEY=vca_...",
		);
		p.outro("Run `npx @vocoder/cli init` to set up your project.");
		return 1;
	}

	const spinner = p.spinner();

	try {
		const branch = detectBranch(options.branch);

		spinner.start("Loading project configuration");

		const localConfig = {
			apiKey: mergedConfig.apiKey,
			apiUrl: mergedConfig.apiUrl || "https://vocoder.app",
		};
		validateLocalConfig(localConfig);

		const api = new VocoderAPI(localConfig);
		const apiConfig = await api.getAppConfig();

		const requestedMode = mergedConfig.mode;
		const waitTimeoutMs = resolveWaitTimeoutMs({
			requestedMaxWaitMs: mergedConfig.maxWaitMs,
			policyDefaultMaxWaitMs: apiConfig.syncPolicy.defaultMaxWaitMs,
			fallbackTimeoutMs: 60_000,
		});

		const fileConfig = loadVocoderConfig(process.cwd());
		const config: ProjectConfig = {
			...localConfig,
			...apiConfig,
			includePattern: mergedConfig.includePattern,
			excludePattern: mergedConfig.excludePattern,
			timeout: waitTimeoutMs,
			...(fileConfig?.appIndustry ? { appIndustry: fileConfig.appIndustry } : {}),
			...(fileConfig?.formality ? { formality: fileConfig.formality } : {}),
		};

		spinner.stop(`Branch: ${highlight(branch)}`);

		if (!options.force && !isTargetBranch(branch, config.targetBranches)) {
			p.log.warn(
				`Skipping translations (${highlight(branch)} is not a target branch)`,
			);
			p.log.info(`Target branches: ${config.targetBranches.map((b) => highlight(b)).join(", ")}`);
			p.log.info("Use --force to translate anyway");
			p.outro("");
			return 0;
		}

		const patternsDisplay = Array.isArray(config.includePattern)
			? config.includePattern.join(", ")
			: config.includePattern;

		spinner.start(`Extracting strings from ${patternsDisplay}`);
		const extractor = new StringExtractor();
		const extractedStrings = await extractor.extractFromProject(
			config.includePattern,
			projectRoot,
			config.excludePattern,
		);

		if (extractedStrings.length === 0) {
			spinner.stop("No translatable strings found");
			p.log.warn(
				"Make sure you are wrapping translatable strings with Vocoder",
			);
			p.outro("");
			return 0;
		}

		spinner.stop(
			`Extracted ${highlight(extractedStrings.length)} strings from ${highlight(patternsDisplay)}`,
		);

		if (options.verbose) {
			const sampleLines = extractedStrings
				.slice(0, 5)
				.map((s: ExtractedString) => `  "${s.text}" (${s.file}:${s.line})`);
			if (extractedStrings.length > 5) {
				sampleLines.push(`  ... and ${extractedStrings.length - 5} more`);
			}
			p.note(sampleLines.join("\n"), "Sample strings");
		}

		if (options.dryRun) {
			p.note(
				[
					`Strings: ${extractedStrings.length}`,
					`Branch: ${branch}`,
					`Target locales: ${config.targetLocales.map((l) => highlight(l)).join(", ")}`,
					`Requested mode: ${requestedMode}`,
					`Max wait: ${waitTimeoutMs}ms`,
					`No fallback: ${mergedConfig.noFallback ? "yes" : "no"}`,
				].join("\n"),
				"Dry run - would translate",
			);
			p.outro("No API calls made.");
			return 0;
		}

		const repoIdentity = resolveGitRepositoryIdentity();
		if (!repoIdentity && options.verbose) {
			p.log.warn(
				"Could not detect git remote origin. Sync will continue without repo metadata.",
			);
		}
		const commitSha = detectCommitSha() ?? undefined;

		const stringEntries = buildStringEntries(extractedStrings);

		if (options.verbose && stringEntries.length !== extractedStrings.length) {
			p.log.info(
				`Deduped ${extractedStrings.length} extracted entries into ${stringEntries.length} unique strings`,
			);
		}

		// Fingerprint uses source keys (not texts) — one text can produce multiple keys via
		// formality/context, so keying by text would produce an incorrect CDN bundle URL.
		const sourceKeys = stringEntries.map((entry) => entry.key);
		const fingerprint = computeFingerprint(extractShortCodeFromApiKey(localConfig.apiKey), sourceKeys);

		// Local cache check — skip API submission if translations already exist for this fingerprint.
		if (!options.force) {
			const cacheFile = getCacheFilePath(projectRoot, fingerprint);
			if (existsSync(cacheFile)) {
				if (options.verbose) {
					p.log.info(`Cache hit: ${chalk.dim(cacheFile)} (fingerprint ${highlight(fingerprint)})`);
				}
				const duration = ((Date.now() - startTime) / 1000).toFixed(1);
				p.outro(`Up to date (${duration}s)`);
				return 0;
			}
			if (options.verbose) {
				p.log.info(`No cache for fingerprint ${highlight(fingerprint)} — will submit to API`);
			}
		}

		spinner.start("Submitting strings to Vocoder API");

		const batchResponse = await api.submitTranslation(
			branch,
			stringEntries,
			config.targetLocales,
			{
				requestedMode,
				requestedMaxWaitMs: waitTimeoutMs,
				clientRunId: randomUUID(),
				force: options.force,
				// Sync appIndustry from vocoder.config.ts to App on every push
				...(config.appIndustry ? { appIndustry: config.appIndustry } : {}),
			},
			repoIdentity ? { ...repoIdentity, commitSha } : { commitSha },
		);

		spinner.stop("Strings submitted");

		const effectiveMode =
			batchResponse.effectiveMode ??
			resolveEffectiveModeFromPolicy({
				branch,
				requestedMode,
				policy: config.syncPolicy,
			});

		if (options.verbose) {
			p.log.info(`Batch: ${chalk.dim(batchResponse.batchId)}`);
			p.log.info(`Requested mode: ${requestedMode}`);
			p.log.info(`Effective mode: ${effectiveMode}`);
			p.log.info(`Wait timeout: ${waitTimeoutMs}ms`);
			if (batchResponse.queueStatus) {
				p.log.info(`Queue status: ${batchResponse.queueStatus}`);
			}
		}

		if (batchResponse.status === "UP_TO_DATE" && batchResponse.noChanges) {
			p.log.success(`Up to date — ${highlight(batchResponse.totalStrings)} strings, no changes`);
		} else if (batchResponse.newStrings === 0) {
			const archivedNote =
				batchResponse.deletedStrings && batchResponse.deletedStrings > 0
					? `, ${chalk.yellow(batchResponse.deletedStrings)} archived`
					: "";
			p.log.success(`No new strings — ${highlight(batchResponse.totalStrings)} total${archivedNote}, using existing translations`);
		} else {
			const statParts = [`${highlight(batchResponse.newStrings)} new, ${highlight(batchResponse.totalStrings)} total`];
			if (batchResponse.deletedStrings && batchResponse.deletedStrings > 0) {
				statParts.push(`${chalk.yellow(batchResponse.deletedStrings)} archived`);
			}
			const estTime = batchResponse.estimatedTime ? ` (~${batchResponse.estimatedTime}s)` : "";
			p.log.info(`${statParts.join(", ")} → syncing to ${config.targetLocales.map((l) => highlight(l)).join(", ")}${estTime}`);
		}

		let artifacts: TranslationArtifacts | null = null;
		if (batchResponse.translations) {
			artifacts = {
				source: "fresh",
				translations: batchResponse.translations,
			};
		}

		let waitError: Error | null = null;
		if (
			!artifacts &&
			(effectiveMode === "required" || effectiveMode === "best-effort")
		) {
			const waitTimeoutSecs = Math.round(waitTimeoutMs / 1000);
			spinner.start(`Waiting for translations (max ${waitTimeoutSecs}s)`);

			let lastProgress = 0;
			try {
				const completion = await api.waitForCompletion(
					batchResponse.batchId,
					waitTimeoutMs,
					(progress) => {
						const percent = Math.round(progress * 100);
						if (percent > lastProgress) {
							spinner.message(`Translating... ${percent}%`);
							lastProgress = percent;
						}
					},
				);

				artifacts = {
					source: "fresh",
					translations: completion.translations,
					localeMetadata: completion.localeMetadata,
				};
				spinner.stop("Translations complete");
			} catch (error) {
				spinner.stop("Translation wait incomplete");
				waitError = error instanceof Error ? error : new Error(String(error));

				if (effectiveMode === "required") {
					throw waitError;
				}

				p.log.warn(`Best-effort wait ended early: ${waitError.message}`);
			}
		}

		if (!artifacts) {
			if (mergedConfig.noFallback) {
				throw new Error(
					"Fresh translations are not available and fallback is disabled (--no-fallback).",
				);
			}

			spinner.start("Loading fallback translations");

			const localFallback = readLocalCache({
				projectRoot,
				fingerprint,
			});

			if (localFallback) {
				artifacts = localFallback;
				spinner.stop(`Using local cached snapshot (${fingerprint})`);
			} else {
				try {
					const apiSnapshot = await fetchApiSnapshot(api, {
						branch,
						targetLocales: config.targetLocales,
					});

					if (apiSnapshot) {
						artifacts = apiSnapshot;
						spinner.stop("Using latest completed API snapshot");
					} else {
						spinner.stop("No completed API snapshot available");
					}
				} catch (error) {
					spinner.stop("Failed to fetch API snapshot");
					if (options.verbose) {
						const message =
							error instanceof Error
								? error.message
								: "Unknown snapshot fetch error";
						p.log.warn(`Snapshot fetch error: ${message}`);
					}
				}
			}

			if (!artifacts) {
				if (waitError) {
					throw new Error(
						`No fallback snapshot available after wait failure: ${waitError.message}`,
					);
				}

				throw new Error(
					"No fallback snapshot available. Try again shortly or run with --mode required.",
				);
			}
		}

		const finalTranslations = normalizeTranslations({
			sourceLocale: config.sourceLocale,
			targetLocales: config.targetLocales,
			stringEntries,
			translations: artifacts.translations,
		});

		try {
			const data = buildTranslationData({
				sourceLocale: config.sourceLocale,
				targetLocales: config.targetLocales,
				translations: finalTranslations,
				localeMetadata: artifacts.localeMetadata,
				updatedAt: new Date().toISOString(),
			});
			const cachePath = writeCache({ projectRoot, fingerprint, data });
			if (options.verbose) {
				p.log.info(`Cache written: ${highlight(cachePath)}`);
			}
		} catch (error) {
			if (options.verbose) {
				const message =
					error instanceof Error ? error.message : "Unknown cache write error";
				p.log.warn(`Failed to write cache: ${message}`);
			}
		}

		if (artifacts.source !== "fresh") {
			const sourceLabel =
				artifacts.source === "local-cache"
					? "local cached snapshot"
					: "completed API snapshot";
			p.log.warn(
				`Using ${sourceLabel}. New strings may appear after the background sync completes.`,
			);
		}

		const duration = ((Date.now() - startTime) / 1000).toFixed(1);
		p.outro(`Sync complete! (${duration}s)`);
		return 0;
	} catch (error) {
		spinner.stop();

		if (error instanceof VocoderAPIError && error.syncPolicyError) {
			p.log.error(error.syncPolicyError.message);
			const guidance = getSyncPolicyErrorGuidance(error.syncPolicyError);
			for (const line of guidance) {
				p.log.info(line);
			}
			return 1;
		}

		if (error instanceof VocoderAPIError && error.limitError) {
			const { limitError } = error;
			p.log.error(limitError.message);
			const guidance = getLimitErrorGuidance(limitError);
			for (const line of guidance) {
				p.log.info(line);
			}
			return 1;
		}

		if (error instanceof Error) {
			p.log.error(error.message);

			const isInvalidKey =
				error.message.toLowerCase().includes("invalid api key") ||
				(error instanceof VocoderAPIError && error.status === 401);

			if (isInvalidKey) {
				p.log.warn(
					"API key rejected — the project may have been deleted or the key revoked.",
				);
				p.log.info(
					"  Run `npx @vocoder/cli init` to create a new project and key.",
				);
			} else if (error.message.includes("git branch")) {
				p.log.warn("Run from a git repository, or use:");
				p.log.info("  vocoder sync --branch main");
			}

			if (options.verbose) {
				p.log.info(`Full error: ${error.stack ?? error}`);
			}
		}

		return 1;
	}
}
