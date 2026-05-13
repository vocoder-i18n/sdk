import { randomUUID } from "node:crypto";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { computeFingerprint, loadVocoderConfig } from "@vocoder/extractor";
import { extractProjectShortIdFromApiKey } from "@vocoder/core";
import type {
	AppTranslateStatus,
	BatchTranslateStatusResponse,
	ExtractedString,
	TranslateCommandOptions,
	TranslationStringEntry,
} from "../types.js";
import { VocoderAPI, VocoderAPIError, computeStringsHash } from "../utils/api.js";
import { detectBranch, isTargetBranch } from "../utils/branch.js";
import { readWorkflowAppDirs, readWorkflowBranches } from "../utils/workflow-read.js";
import { validateLocalConfig } from "../utils/config.js";
import { StringExtractor } from "../utils/extract.js";
import { detectCommitSha, resolveGitRepositoryIdentity } from "../utils/git-identity.js";
import { highlight } from "../utils/theme.js";
import { buildStringEntries } from "../utils/string-entries.js";
import type { LimitErrorResponse } from "../types.js";

type LocaleStatus = "pending" | "running" | "complete" | "failed";

function overallStatus(statuses: LocaleStatus[]): LocaleStatus {
	if (statuses.every((s) => s === "complete")) return "complete";
	if (statuses.some((s) => s === "failed")) return "failed";
	if (statuses.some((s) => s === "running")) return "running";
	return "pending";
}

/** Returns the in-progress poll line for a single app. Exported for testing. */
export function formatAppProgress(app: AppTranslateStatus): string {
	const { completed, total } = app.progress;
	return app.appDir
		? `  ⟳ ${app.appDir}: ${completed}/${total}`
		: `  ⟳ ${completed}/${total}`;
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
		p.log.info("  Or add your key to .env or .env.local: VOCODER_API_KEY=vcp_...");
		p.outro("Run `npx @vocoder/cli init` to set up your project.");
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

	const projectShortId = extractProjectShortIdFromApiKey(apiKey);
	if (!projectShortId) {
		p.log.error("Invalid API key format. Expected a project key (vcp_...).");
		return 1;
	}

	const spinner = p.spinner();

	try {
		const branch = detectBranch(options.branch);

		spinner.start("Loading project configuration");
		const api = new VocoderAPI(localConfig);
		const apiConfig = await api.getAppConfig();
		spinner.stop(`Branch: ${highlight(branch)}`);

		// YAML branches are the source of truth — fall back to server config if YAML absent.
		const yamlBranches = readWorkflowBranches(projectRoot);
		const yamlAppDirs = readWorkflowAppDirs(projectRoot);
		const effectiveTargetBranches = yamlBranches ?? apiConfig.targetBranches;

		if (!isTargetBranch(branch, effectiveTargetBranches)) {
			p.log.warn(
				`Skipping translations (${highlight(branch)} is not a target branch)`,
			);
			p.log.info(
				`Target branches: ${effectiveTargetBranches.map((b) => highlight(b)).join(", ")}`,
			);
			p.outro("");
			return 0;
		}

		const fileConfig = loadVocoderConfig(projectRoot);

		// VOCODER_ON_FAILURE env var overrides vocoder.config.ts setting
		const onTranslationFailure =
			(process.env.VOCODER_ON_FAILURE as "fail" | "proceed" | undefined) ??
			fileConfig?.onTranslationFailure ??
			"proceed";

		// --app-dirs flag > YAML app-dirs > single-app (root "")
		const appDirs = options.appDirs
			? options.appDirs
					.split(",")
					.map((d) => d.trim().replace(/^\/|\/$/g, ""))
					.filter(Boolean)
			: (yamlAppDirs ?? []);
		// Single-app: appDir = "" (whole repo)
		const effectiveAppDirs = appDirs.length > 0 ? appDirs : [""];

		const includePattern: string | string[] =
			fileConfig?.include?.length ? fileConfig.include : ["**/*.{tsx,jsx,ts,js}"];
		const excludePattern = fileConfig?.exclude?.length ? fileConfig.exclude : undefined;
		const industry = fileConfig?.industry ?? fileConfig?.appIndustry;

		// Extract strings for each app directory
		type AppExtraction = {
			appDir: string;
			stringEntries: TranslationStringEntry[];
			sourceKeys: string[];
			stringsHash: string;
			fingerprint: string;
		};
		const appExtractions: AppExtraction[] = [];

		for (const appDir of effectiveAppDirs) {
			const extractRoot = appDir ? `${projectRoot}/${appDir}` : projectRoot;
			const patternsDisplay = Array.isArray(includePattern)
				? includePattern.join(", ")
				: includePattern;

			spinner.start(
				appDir
					? `Extracting strings from ${highlight(appDir)} (${patternsDisplay})`
					: `Extracting strings from ${patternsDisplay}`,
			);

			const extractor = new StringExtractor();
			const extractedStrings = await extractor.extractFromProject(
				includePattern,
				extractRoot,
				excludePattern,
			);

			spinner.stop(
				`Extracted ${highlight(extractedStrings.length)} string${extractedStrings.length === 1 ? "" : "s"}${appDir ? ` from ${highlight(appDir)}` : ""}`,
			);

			const stringEntries = buildStringEntries(extractedStrings);
			const sourceKeys = stringEntries.map((e) => e.key);
			const stringsHash = computeStringsHash({ keys: sourceKeys, industry: industry ?? null });

			// Fingerprint: hash(projectShortId:appDir:sortedKeys) — matches server formula
			const scope = `${projectShortId}:${appDir}`;
			const fingerprint = computeFingerprint(scope, sourceKeys);

			appExtractions.push({ appDir, stringEntries, sourceKeys, stringsHash, fingerprint });
		}

		const totalStrings = appExtractions.reduce((sum, a) => sum + a.sourceKeys.length, 0);
		if (totalStrings === 0) {
			p.log.warn("No translatable strings found");
			p.log.info("Make sure you are wrapping translatable strings with Vocoder");
			p.outro("");
			return 0;
		}

		if (options.dryRun) {
			const lines = appExtractions.map(
				(a) =>
					`${a.appDir || "(root)"}: ${a.sourceKeys.length} string${a.sourceKeys.length === 1 ? "" : "s"}, fingerprint ${a.fingerprint}`,
			);
			p.note(
				[
					`Branch: ${branch}`,
					`Target locales: ${apiConfig.targetLocales.map((l) => highlight(l)).join(", ")}`,
					...lines,
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

		// Build per-app submissions — filter out id-only entries (text: null)
		const apps = appExtractions
			.filter((a) => a.sourceKeys.length > 0)
			.map((a) => ({
				appDir: a.appDir,
				strings: a.stringEntries
					.filter((e): e is TranslationStringEntry & { text: string } => e.text != null)
					.map((e) => ({
						key: e.key,
						text: e.text,
						...(e.context ? { context: e.context } : {}),
						...(e.formality ? { formality: e.formality } : {}),
						...(e.uiRole ? { uiRole: e.uiRole } : {}),
					})),
				stringsHash: a.stringsHash,
			}));

		spinner.start(
			apps.length > 1
				? `Submitting ${apps.length} apps to Vocoder`
				: "Submitting to Vocoder",
		);
		const submitResult = await api.submitTranslate({
			apps,
			branch,
			...(commitSha ? { commitSha } : {}),
			repoUrl: repoIdentity?.repoCanonical ?? "",
			clientRunId: randomUUID(),
			// Send YAML-derived branches so server can reconcile project.targetBranches.
			// Only sent when YAML was found — omitting preserves server value if no YAML.
			...(yamlBranches ? { targetBranches: yamlBranches } : {}),
		});
		spinner.stop("Job accepted");

		// All apps cached — no work needed
		if (submitResult.status === "complete") {
			const duration = ((Date.now() - startTime) / 1000).toFixed(1);
			p.log.success(`Bundle ready (cached — ${duration}s)`);
			p.outro("Up to date.");
			return 0;
		}

		const { jobId } = submitResult;
		const localeList = apiConfig.targetLocales.join(", ");
		process.stdout.write(
			`Translating ${totalStrings} string${totalStrings === 1 ? "" : "s"} → ${localeList}\n`,
		);

		let interval = 1000;
		let finalStatus: BatchTranslateStatusResponse | null = null;

		while (true) {
			await new Promise((resolve) =>
				setTimeout(resolve, interval + Math.floor(Math.random() * 200)),
			);
			const status = await api.pollTranslateStatus(jobId);

			// Show per-app progress
			for (const app of status.apps) {
				if (app.status === "running") {
					process.stdout.write(`\r${formatAppProgress(app)}          `);
				}
			}

			if (status.status === "complete" || status.status === "failed") {
				finalStatus = status;
				process.stdout.write("\n");
				break;
			}

			interval = Math.min(interval * 1.5, 5000);
		}

		if (!finalStatus) {
			p.log.error("Unexpected: no final status received");
			return 1;
		}

		const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

		// Per-app final status lines — only shown for monorepo (multiple apps or named appDir).
		// Root-level single-app setup shows no label; the outro line is sufficient.
		for (const app of finalStatus.apps) {
			const showLabel = finalStatus.apps.length > 1 || !!app.appDir;
			if (!showLabel) continue;

			const appStatusLine =
				app.status === "complete"
					? chalk.green(`✓ ${app.appDir}`)
					: chalk.red(`✗ ${app.appDir}`) + (app.error ? `: ${app.error}` : "");
			process.stdout.write(`  ${appStatusLine}\n`);
		}

		if (finalStatus.status === "complete") {
			p.outro(chalk.green(`✓ Bundle ready — ${elapsedSec}s`));
			return 0;
		}

		if (computeExitCode("failed", onTranslationFailure) === 0) {
			p.log.warn(
				`Translation incomplete — proceeding (onTranslationFailure: ${onTranslationFailure})`,
			);
			p.outro("");
			return 0;
		}

		p.log.error("Translation failed");
		p.outro("Build halted (onTranslationFailure: fail)");
		return 1;
	} catch (error) {
		if (error instanceof VocoderAPIError && error.limitError) {
			const { limitError } = error;
			spinner.stop(limitError.message, 1);
			for (const line of getLimitErrorGuidance(limitError)) {
				p.log.info(line);
			}
			return 1;
		}

		if (error instanceof VocoderAPIError) {
			spinner.stop(error.message, 1);
			if (error.status === 401) {
				p.log.warn(
					"API key rejected — the project may have been deleted or the key revoked.",
				);
				p.log.info("  Run `npx @vocoder/cli init` to create a new project and key.");
			}
			return 1;
		}

		if (error instanceof Error) {
			spinner.stop(error.message, 1);
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
