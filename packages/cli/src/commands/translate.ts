import { randomUUID } from "node:crypto";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { computeFingerprint, loadVocoderConfig } from "@vocoder/extractor";
import type {
	ExtractedString,
	TranslateCommandOptions,
	TranslateStatusResponse,
	TranslationStringEntry,
} from "../types.js";
import { VocoderAPI, VocoderAPIError, computeStringsHash } from "../utils/api.js";
import { detectBranch, isTargetBranch } from "../utils/branch.js";
import { extractShortCodeFromApiKey, validateLocalConfig } from "../utils/config.js";
import { StringExtractor } from "../utils/extract.js";
import { detectCommitSha, resolveGitRepositoryIdentity } from "../utils/git-identity.js";
import { highlight } from "../utils/theme.js";
import type { LimitErrorResponse } from "../types.js";

type LocaleStatus = "pending" | "running" | "complete" | "failed";

function mergeContext(current?: string, incoming?: string): string | undefined {
	if (!incoming) return current;
	if (!current) return incoming;
	if (current === incoming) return current;
	const parts = new Set(
		[...current.split(" | "), ...incoming.split(" | ")].map((s) => s.trim()).filter(Boolean),
	);
	return Array.from(parts).join(" | ");
}

function buildStringEntries(extractedStrings: ExtractedString[]): TranslationStringEntry[] {
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
		} else if (existing.formality && str.formality && existing.formality !== str.formality) {
			existing.formality = "auto";
		}
	}
	return Array.from(byKey.values());
}

/** Returns the in-progress poll line. Exported for testing. */
export function formatProgress(status: TranslateStatusResponse): string {
	const { completed, total } = status.progress;
	return `  ⟳ ${completed}/${total} complete...`;
}

/** Returns the final per-locale status line. Exported for testing. */
export function formatLocaleResults(
	locales: Record<string, LocaleStatus>,
	elapsedSec: string,
): string {
	const parts = Object.entries(locales).map(([locale, s]) =>
		s === "complete" ? `${chalk.green("✓")} ${locale}` : `${chalk.red("✗")} ${locale}`,
	);
	const allComplete = Object.values(locales).every((s) => s === "complete");
	const suffix = allComplete ? ` — ${elapsedSec}s` : "";
	return `  ${parts.join("  ")}${suffix}`;
}

/** Returns the correct exit code. Exported for testing. */
export function computeExitCode(
	status: "complete" | "failed",
	onTranslationFailure: "fail" | "proceed",
): number {
	if (status === "complete") return 0;
	return onTranslationFailure === "fail" ? 1 : 0;
}

export function getLimitErrorGuidance(limitError: LimitErrorResponse): string[] {
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
			`Required for this sync: ${limitError.required.toLocaleString()} chars`,
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

export async function translate(options: TranslateCommandOptions = {}): Promise<number> {
	const startTime = Date.now();
	const projectRoot = process.cwd();

	p.intro(chalk.bold("Vocoder Translate"));

	const apiKey = process.env.VOCODER_API_KEY;
	if (!apiKey) {
		p.log.warn("No API key found. Run init to get started:");
		p.log.info("  npx @vocoder/cli init");
		p.log.info("");
		p.log.info("  Or add your key to .env or .env.local: VOCODER_API_KEY=vca_...");
		p.outro("Run `npx @vocoder/cli init` to set up your app.");
		return 1;
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const localConfig = { apiKey, apiUrl };

	try {
		validateLocalConfig(localConfig);
	} catch (e) {
		p.log.error(e instanceof Error ? e.message : String(e));
		return 1;
	}

	const spinner = p.spinner();

	try {
		const branch = detectBranch(options.branch);

		spinner.start("Loading app configuration");
		const api = new VocoderAPI(localConfig);
		const apiConfig = await api.getAppConfig();
		spinner.stop(`Branch: ${highlight(branch)}`);

		if (!isTargetBranch(branch, apiConfig.targetBranches)) {
			p.log.warn(
				`Skipping translations (${highlight(branch)} is not a target branch)`,
			);
			p.log.info(
				`Target branches: ${apiConfig.targetBranches.map((b) => highlight(b)).join(", ")}`,
			);
			p.outro("");
			return 0;
		}

		const fileConfig = loadVocoderConfig(projectRoot);
		const onTranslationFailure = fileConfig?.onTranslationFailure ?? "proceed";
		const includePattern: string | string[] =
			fileConfig?.include?.length ? fileConfig.include : ["**/*.{tsx,jsx,ts,js}"];
		const excludePattern = fileConfig?.exclude?.length ? fileConfig.exclude : undefined;

		const patternsDisplay = Array.isArray(includePattern)
			? includePattern.join(", ")
			: includePattern;

		spinner.start(`Extracting strings from ${patternsDisplay}`);
		const extractor = new StringExtractor();
		const extractedStrings = await extractor.extractFromProject(
			includePattern,
			projectRoot,
			excludePattern,
		);
		spinner.stop(
			`Extracted ${highlight(extractedStrings.length)} strings from ${highlight(patternsDisplay)}`,
		);

		if (extractedStrings.length === 0) {
			p.log.warn("No translatable strings found");
			p.log.info("Make sure you are wrapping translatable strings with Vocoder");
			p.outro("");
			return 0;
		}

		const stringEntries = buildStringEntries(extractedStrings);

		if (options.verbose && stringEntries.length !== extractedStrings.length) {
			p.log.info(
				`Deduped ${extractedStrings.length} extracted entries into ${stringEntries.length} unique strings`,
			);
		}

		const sourceKeys = stringEntries.map((e) => e.key);
		const industry = fileConfig?.industry ?? fileConfig?.appIndustry;
		const stringsHash = computeStringsHash({ keys: sourceKeys, industry: industry ?? null });
		const fingerprint = computeFingerprint(extractShortCodeFromApiKey(apiKey), sourceKeys);

		if (options.dryRun) {
			p.note(
				[
					`Strings: ${stringEntries.length}`,
					`Branch: ${branch}`,
					`Target locales: ${apiConfig.targetLocales.map((l) => highlight(l)).join(", ")}`,
					`Fingerprint: ${fingerprint}`,
				].join("\n"),
				"Dry run — would translate",
			);
			p.outro("No API calls made.");
			return 0;
		}

		const repoIdentity = resolveGitRepositoryIdentity();
		const commitSha = options.commitSha ?? detectCommitSha() ?? undefined;

		if (options.verbose && !repoIdentity) {
			p.log.warn(
				"Could not detect git remote origin. Translation will continue without repo metadata.",
			);
		}

		// id-only entries (text: null) can't be translated without a localesPath source file
		const submitEntries = stringEntries.filter(
			(e): e is TranslationStringEntry & { text: string } => e.text != null,
		);

		spinner.start("Submitting to Vocoder");
		const submitResult = await api.submitTranslate({
			branch,
			...(commitSha ? { commitSha } : {}),
			stringEntries: submitEntries,
			targetLocales: apiConfig.targetLocales,
			stringsHash,
			...(repoIdentity?.repoCanonical ? { repoCanonical: repoIdentity.repoCanonical } : {}),
			clientRunId: randomUUID(),
		});
		spinner.stop("Job accepted");

		// Server found an existing completed batch for this stringsHash — no work needed
		if (submitResult.status === "complete") {
			const duration = ((Date.now() - startTime) / 1000).toFixed(1);
			p.log.success(`Bundle ready (cached — ${duration}s)`);
			p.outro("Up to date.");
			return 0;
		}

		const { jobId } = submitResult;
		const localeList = apiConfig.targetLocales.join(", ");
		process.stdout.write(`Translating ${stringEntries.length} strings → ${localeList}\n`);

		let interval = 1000;
		let lastLine = "";
		let finalStatus: TranslateStatusResponse | null = null;

		while (true) {
			await new Promise((resolve) =>
				setTimeout(resolve, interval + Math.floor(Math.random() * 200)),
			);
			const status = await api.pollTranslateStatus(jobId);

			const line = formatProgress(status);
			if (line !== lastLine) {
				process.stdout.write(`\r${line}`);
				lastLine = line;
			}

			if (status.status === "complete" || status.status === "failed") {
				finalStatus = status;
				process.stdout.write("\n");
				break;
			}

			interval = Math.min(interval * 1.5, 5000);
		}

		// Loop only exits when finalStatus is set — unreachable but satisfies TypeScript
		if (!finalStatus) {
			p.log.error("Unexpected: no final status received");
			return 1;
		}

		const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

		if (finalStatus.status === "complete") {
			process.stdout.write(`${formatLocaleResults(finalStatus.locales, elapsedSec)}\n`);
			p.outro(chalk.green("✓ Bundle ready"));
			return 0;
		}

		process.stdout.write(`${formatLocaleResults(finalStatus.locales, elapsedSec)}\n`);

		if (computeExitCode("failed", onTranslationFailure) === 0) {
			p.log.warn(
				`Translation incomplete — proceeding (onTranslationFailure: ${onTranslationFailure})`,
			);
			if (finalStatus.error) {
				p.log.info(finalStatus.error);
			}
			p.outro("");
			return 0;
		}

		p.log.error(`Translation failed${finalStatus.error ? `: ${finalStatus.error}` : ""}`);
		p.outro("Build halted (onTranslationFailure: fail)");
		return 1;
	} catch (error) {
		spinner.stop();

		if (error instanceof VocoderAPIError && error.limitError) {
			const { limitError } = error;
			p.log.error(limitError.message);
			for (const line of getLimitErrorGuidance(limitError)) {
				p.log.info(line);
			}
			return 1;
		}

		if (error instanceof VocoderAPIError) {
			p.log.error(error.message);
			if (error.status === 401) {
				p.log.warn(
					"API key rejected — the app may have been deleted or the key revoked.",
				);
				p.log.info("  Run `npx @vocoder/cli init` to create a new app and key.");
			}
			return 1;
		}

		if (error instanceof Error) {
			p.log.error(error.message);
			if (error.message.includes("git branch")) {
				p.log.warn("Run from a git repository, or use:");
				p.log.info("  vocoder translate --branch main");
			}
			if (options.verbose) {
				p.log.info(`Full error: ${error.stack ?? error}`);
			}
		}

		return 1;
	}
}
