import * as p from "@clack/prompts";

import type {
	AppTranslateStatus,
	BatchTranslateStatusResponse,
	TranslateCommandOptions,
	TranslationStringEntry,
} from "../types.js";
import { VocoderAPI, VocoderAPIError, computeSourceEntriesHash } from "../utils/api.js";
import { computeFingerprint, loadVocoderConfig } from "@vocoder/extractor";
import { detectBranch, isTargetBranch } from "../utils/branch.js";
import { detectCommitSha, resolveGitRepositoryIdentity, resolveGitRoot } from "../utils/git-identity.js";
import {
	readWorkflowAppDirs,
	readWorkflowBranches,
	readWorkflowCommitMode,
} from "../utils/workflow-read.js";

import type { LimitErrorResponse } from "../types.js";
import { StringExtractor } from "../utils/extract.js";
import { buildStringEntries } from "../utils/string-entries.js";
import chalk from "chalk";
import { existsSync, writeFileSync } from "node:fs";
import { extractProjectShortIdFromApiKey } from "@vocoder/core";
import { highlight } from "../utils/theme.js";
import { randomUUID } from "node:crypto";
import { validateLocalConfig } from "../utils/config.js";

type LocaleStatus = "pending" | "running" | "complete" | "failed";

/** Returns the in-progress poll line for a single app. Exported for testing. */
export function formatAppProgress(app: AppTranslateStatus): string {
	const { completed, total } = app.progress;
	const label = app.appDir || "(root)";
	return `  ⟳ ${label}: ${completed}/${total}`;
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
			"Add a DeepL API key in Dashboard → Workspace Settings → Providers.",
			`Open settings: ${limitError.upgradeUrl}`,
		];
	}
	if (limitError.limitType === "translation_chars") {
		return [
			`Used: ${limitError.current.toLocaleString()} / Needed: ${limitError.required.toLocaleString()} chars`,
			`Upgrade plan: ${limitError.upgradeUrl}`,
		];
	}
	if (limitError.limitType === "source_strings") {
		return [
			`Active strings: ${limitError.current.toLocaleString()} / Needed: ${limitError.required.toLocaleString()}`,
			`Upgrade plan: ${limitError.upgradeUrl}`,
		];
	}
	if (limitError.limitType === "target_locales") {
		return [
			`Locale limit: ${limitError.required} (${limitError.planId} plan allows ${limitError.current})`,
			`Upgrade plan: ${limitError.upgradeUrl}`,
		];
	}
	return [
		`Plan: ${limitError.planId} — Current: ${limitError.current} / Required: ${limitError.required}`,
		`Upgrade: ${limitError.upgradeUrl}`,
	];
}

type TranslateResultApp = {
	appDir: string;
	localeFileTree?: Record<string, string>;
	commitConfig?: { commitMode: string; autoMergePRs: boolean; skipCiOnDirectCommit: boolean };
};

// Writes a JSON result file for the GitHub Action commit step. No-op outside CI.
function writeTranslateResult(jobId: string, apps: TranslateResultApp[]): void {
	if (!process.env.GITHUB_ACTIONS) return;
	const runnerTemp = process.env.RUNNER_TEMP ?? "/tmp";
	try {
		writeFileSync(
			`${runnerTemp}/vocoder-result.json`,
			JSON.stringify({ jobId, status: "complete", apps }, null, 2),
		);
	} catch {
		// Non-fatal — commit step skips if file is absent
	}
}

export async function translate(options: TranslateCommandOptions = {}): Promise<number> {
	const startTime = Date.now();
	const cwd = process.cwd();
	// Git root anchors YAML lookup, config loading, and extraction paths so they work
	// correctly regardless of which subdirectory the CLI was invoked from.
	// Falls back to cwd when not inside a git repository.
	const gitRoot = resolveGitRoot() ?? cwd;

	p.intro(chalk.bold("Vocoder Translate"));

	const apiKey = process.env.VOCODER_API_KEY;
	if (!apiKey) {
		p.log.error("No API key found.");
		p.log.info("  Run `npx @vocoder/cli init` — or set VOCODER_API_KEY in .env.local");
		p.outro("");
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
		const yamlBranches = readWorkflowBranches(gitRoot);
		const yamlAppDirs = readWorkflowAppDirs(gitRoot);
		const yamlCommitMode = readWorkflowCommitMode(gitRoot);
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

		// onTranslationFailure is a job-level setting — load from git root, not per-app.
		// VOCODER_ON_FAILURE env var takes highest precedence.
		const rootConfig = loadVocoderConfig(gitRoot);
		const onTranslationFailure =
			(process.env.VOCODER_ON_FAILURE as "fail" | "proceed" | undefined) ??
			rootConfig?.onTranslationFailure ??
			"proceed";

		// --app-dirs flag > YAML app-dirs > single-app root ("")
		// Monorepo users must declare app dirs explicitly (flag or YAML); no CWD inference.
		const appDirs = options.appDirs
			? options.appDirs
					.split(",")
					.map((d) => d.trim().replace(/^\/|\/$/g, ""))
					.filter(Boolean)
			: (yamlAppDirs ?? []);
		const effectiveAppDirs = appDirs.length > 0 ? appDirs : [""];

		// Validate and display named app dirs. Root ("") always valid — skip for single-app projects.
		const namedAppDirs = effectiveAppDirs.filter(Boolean);
		if (namedAppDirs.length > 0) {
			spinner.start("Checking app directories");
			for (const appDir of namedAppDirs) {
				if (!existsSync(`${gitRoot}/${appDir}`)) {
					spinner.stop(`App directory not found: ${highlight(appDir)}`, 1);
					p.outro("Fix app-dirs in your workflow YAML or --app-dirs flag.");
					return 1;
				}
			}
			spinner.stop(`Apps: ${namedAppDirs.map((d) => highlight(d)).join(", ")}`);
		}

		// Extract strings for each app directory
		type AppExtraction = {
			appDir: string;
			stringEntries: TranslationStringEntry[];
			sourceEntriesCount: number;
			sourceEntriesHash: string;
			fingerprint: string;
		};
		const appExtractions: AppExtraction[] = [];

		for (const appDir of effectiveAppDirs) {
			// Each app owns its vocoder.config.ts for include/exclude/industry/formality.
			// Root-level projects: extractRoot === gitRoot, config loaded from there.
			const extractRoot = appDir ? `${gitRoot}/${appDir}` : gitRoot;
			const appConfig = loadVocoderConfig(extractRoot);

			const includePattern: string | string[] =
				appConfig?.include?.length ? appConfig.include : ["**/*.{tsx,jsx,ts,js}"];
			const excludePattern = appConfig?.exclude?.length ? appConfig.exclude : undefined;
			const industry = appConfig?.industry;

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
			const sourceEntriesHash = computeSourceEntriesHash({ entries: stringEntries, industry: industry ?? null });

			// Fingerprint: hash(projectShortId:appDir:sortedKeys) — matches server formula
			const scope = `${projectShortId}:${appDir}`;
			const fingerprint = computeFingerprint(scope, stringEntries.map((e) => e.key));

			appExtractions.push({ appDir, stringEntries, sourceEntriesCount: stringEntries.length, sourceEntriesHash, fingerprint });
		}

		const totalSourceEntries = appExtractions.reduce((sum, a) => sum + a.sourceEntriesCount, 0);
		if (totalSourceEntries === 0) {
			p.log.warn("No translatable strings found — notifying server to remove any deleted strings");
		}

		if (options.dryRun) {
			const lines = appExtractions.map(
				(a) =>
					`${a.appDir || "(root)"}: ${a.sourceEntriesCount} string${a.sourceEntriesCount === 1 ? "" : "s"}, fingerprint ${a.fingerprint}`,
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
		const apps = appExtractions.map((a) => ({
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
			sourceEntriesHash: a.sourceEntriesHash,
			// Forward YAML commit-mode so DB stays in sync when the YAML is updated.
			// Omitted when YAML is absent — server value is preserved in that case.
			...(yamlCommitMode ? { commitMode: yamlCommitMode } : {}),
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

		// All apps cached — stop spinner with that result, no polling needed
		if (submitResult.status === "complete") {
			const duration = ((Date.now() - startTime) / 1000).toFixed(1);
			spinner.stop(`Bundle ready — cached in ${duration}s`);
			writeTranslateResult(
				submitResult.jobId,
				submitResult.apps.map((a) => ({
					appDir: a.appDir,
					...(a.localeFileTree ? { localeFileTree: a.localeFileTree } : {}),
					...(a.commitConfig ? { commitConfig: a.commitConfig } : {}),
				})),
			);
			p.outro("Up to date.");
			return 0;
		}

		spinner.stop("Queued");

		const { jobId } = submitResult;
		const localeList = apiConfig.targetLocales.join(", ");

		spinner.start(
			`Translating ${totalSourceEntries} string${totalSourceEntries === 1 ? "" : "s"} → ${localeList}`,
		);

		let interval = 1000;
		let finalStatus: BatchTranslateStatusResponse | null = null;

		while (true) {
			await new Promise((resolve) =>
				setTimeout(resolve, interval + Math.floor(Math.random() * 200)),
			);
			const status = await api.pollTranslateStatus(jobId);

			// Update spinner message with per-app progress for monorepo
			for (const app of status.apps) {
				if (app.status === "running" && app.appDir) {
					const { completed, total } = app.progress;
					spinner.message(`${highlight(app.appDir)}: ${completed}/${total}`);
				}
			}

			if (status.status === "complete" || status.status === "failed") {
				finalStatus = status;
				break;
			}

			interval = Math.min(interval * 1.5, 5000);
		}

		if (!finalStatus) {
			p.log.error("Unexpected: no final status received");
			return 1;
		}

		const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

		if (finalStatus.status === "complete") {
			spinner.stop(`Bundle ready — ${elapsedSec}s`);
			writeTranslateResult(
				finalStatus.jobId,
				finalStatus.apps.map((a) => ({
					appDir: a.appDir,
					...(a.localeFileTree ? { localeFileTree: a.localeFileTree } : {}),
					...(a.commitConfig ? { commitConfig: a.commitConfig } : {}),
				})),
			);
			// Per-app lines only for monorepo (multiple apps or named appDir)
			for (const app of finalStatus.apps) {
				if (finalStatus.apps.length > 1 || !!app.appDir) {
					p.log.info(`${app.appDir}: done`);
				}
			}
			p.outro("Up to date.");
			return 0;
		}

		spinner.stop("Translation incomplete", 1);
		for (const app of finalStatus.apps) {
			if ((finalStatus.apps.length > 1 || !!app.appDir) && app.status !== "complete") {
				p.log.warn(`${app.appDir}${app.error ? `: ${app.error}` : ""}`);
			}
		}

		if (computeExitCode("failed", onTranslationFailure) === 0) {
			p.outro(`Translation incomplete — proceeding (onTranslationFailure: ${onTranslationFailure})`);
			return 0;
		}

		p.outro(chalk.red("Build halted — translation failed (onTranslationFailure: fail)"));
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
				p.log.info("  Run from a git repository, or use: vocoder translate --branch main");
			}
			if (options.verbose) {
				p.log.info(`Full error: ${error.stack ?? error}`);
			}
		}

		return 1;
	}
}
