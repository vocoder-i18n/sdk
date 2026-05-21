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
	readWorkflowBranches,
	readWorkflowCommitMode,
} from "../utils/workflow-read.js";

import type { LimitErrorResponse } from "../types.js";
import { StringExtractor } from "../utils/extract.js";
import { buildStringEntries } from "../utils/string-entries.js";
import chalk from "chalk";
import {
	CommandSession,
	CommandStep,
	displayAppDir,
	formatLabelValue,
	joinHighlighted,
} from "../utils/command-session.js";
import { dirname, join } from "node:path";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { writeLocaleFileTree } from "./pull.js";
import { extractProjectShortIdFromApiKey } from "@vocoder/core";
import { highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { randomUUID } from "node:crypto";
import { validateLocalConfig } from "../utils/config.js";

loadEnvFiles();

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

type TranslationOutputApp = {
	appDir: string;
	localeFileTree?: Record<string, string>;
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

function warnOrphanedLocaleFiles(
	session: CommandSession,
	apps: TranslationOutputApp[],
	rootDir: string,
): void {
	const writtenPaths = new Set<string>();
	const localeDirs = new Set<string>();

	for (const app of apps) {
		if (!app.localeFileTree) continue;
		for (const relativePath of Object.keys(app.localeFileTree)) {
			writtenPaths.add(join(rootDir, relativePath));
			localeDirs.add(join(rootDir, dirname(relativePath)));
		}
	}

	if (localeDirs.size === 0) return;

	const orphaned: string[] = [];
	for (const dir of localeDirs) {
		if (!existsSync(dir)) continue;
		for (const file of readdirSync(dir)) {
			if (!file.endsWith(".json")) continue;
			if (!writtenPaths.has(join(dir, file))) {
				orphaned.push(file);
			}
		}
	}

	if (orphaned.length === 0) return;

	const count = orphaned.length;
	session.warn(
		`${highlight(String(count))} locale file${count === 1 ? "" : "s"} not in target locales: ${orphaned.join(", ")}`,
	);
	session.message(
		`Run ${highlight("vocoder clean")} to remove ${count === 1 ? "it" : "them"}.`,
	);
}

function renderWrittenLocaleFiles(
	session: CommandSession,
	apps: TranslationOutputApp[],
	rootDir: string,
): void {
	const showRootLabel = apps.length > 1;
	for (const app of apps) {
		if (app.localeFileTree) {
			for (const result of writeLocaleFileTree(app.localeFileTree, rootDir)) {
				session.success(
					`Wrote ${highlight(String(result.count))} file${result.count === 1 ? "" : "s"} to ${highlight(result.displayDir)}`,
				);
			}
		}
		if (apps.length > 1 || !!app.appDir) {
			session.success(
				formatLabelValue(
					highlight(displayAppDir(app.appDir, { showRootLabel })),
					"translated",
				),
			);
		}
	}
}

export async function translate(options: TranslateCommandOptions = {}): Promise<number> {
	const startTime = Date.now();
	const cwd = process.cwd();
	// Git root anchors YAML lookup, config loading, and extraction paths so they work
	// correctly regardless of which subdirectory the CLI was invoked from.
	// Falls back to cwd when not inside a git repository.
	const gitRoot = resolveGitRoot() ?? cwd;

	const session = new CommandSession("Vocoder Translate");

	const apiKey = process.env.VOCODER_API_KEY;
	if (!apiKey) {
		return session.fail("VOCODER_API_KEY is not set.", [
			"Run vocoder init or set VOCODER_API_KEY in .env.local.",
		]);
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const localConfig = { apiKey, apiUrl };

	try {
		validateLocalConfig(localConfig);
	} catch (e) {
		return session.fail(e instanceof Error ? e.message : String(e));
	}

	const projectShortId = extractProjectShortIdFromApiKey(apiKey);
	if (!projectShortId) {
		return session.fail("Invalid API key format. Expected a project key (vcp_...).");
	}

	let activeStep: CommandStep | null = null;

	try {
		const branch = detectBranch(options.branch);

		activeStep = session.startStep("Loading project configuration");
		const api = new VocoderAPI(localConfig);
		const apiConfig = await api.getAppConfig();
		activeStep.done(formatLabelValue("Branch", highlight(branch)));
		activeStep = null;

		// YAML branches are the source of truth — fall back to server config if YAML absent.
		const yamlBranches = readWorkflowBranches(gitRoot);
		const yamlCommitMode = readWorkflowCommitMode(gitRoot);
		const effectiveTargetBranches = yamlBranches ?? apiConfig.targetBranches;

		if (!isTargetBranch(branch, effectiveTargetBranches)) {
			session.warn(`Skipping translations for ${highlight(branch)}.`);
			session.step("Target branches", joinHighlighted(effectiveTargetBranches));
			return session.end();
		}

		// onTranslationFailure is a job-level setting — load from git root, not per-app.
		// VOCODER_ON_FAILURE env var takes highest precedence.
		const rootConfig = loadVocoderConfig(gitRoot);
		const onTranslationFailure =
			(process.env.VOCODER_ON_FAILURE as "fail" | "proceed" | undefined) ??
			rootConfig?.onTranslationFailure ??
			"proceed";

		// --app-dirs flag > vocoder.config.ts apps[] > single-app root ("")
		// Monorepo users declare app dirs in vocoder.config.ts; flag overrides for one-off runs.
		const configAppDirs = rootConfig?.apps?.map((a) => a.appDir).filter(Boolean) ?? null;
		const appDirs = options.appDirs
			? options.appDirs
					.split(",")
					.map((d) => d.trim().replace(/^\/|\/$/g, ""))
					.filter(Boolean)
			: (configAppDirs ?? []);
		const effectiveAppDirs = appDirs.length > 0 ? appDirs : [""];

		// Validate and display named app dirs. Root ("") always valid — skip for single-app projects.
		const namedAppDirs = effectiveAppDirs.filter(Boolean);
		if (namedAppDirs.length > 0) {
			activeStep = session.startStep("Checking app directories");
			for (const appDir of namedAppDirs) {
				if (!existsSync(`${gitRoot}/${appDir}`)) {
					activeStep.fail(`App directory not found: ${highlight(appDir)}`, [
						"Fix app dirs in vocoder.config.ts or --app-dirs.",
					]);
					return session.endFailure();
				}
			}
			activeStep.done(formatLabelValue("Apps", joinHighlighted(namedAppDirs)));
			activeStep = null;
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
			// Resolve effective per-app config: root config merged with matching apps[] entry overrides.
			const extractRoot = appDir ? `${gitRoot}/${appDir}` : gitRoot;
			const appEntry = appDir ? rootConfig?.apps?.find((a) => a.appDir === appDir) : undefined;
			const appConfig = appEntry ? { ...rootConfig, ...appEntry } : rootConfig;

			const includePattern: string | string[] =
				appConfig?.include?.length ? appConfig.include : ["**/*.{tsx,jsx,ts,js}"];
			const excludePattern = appConfig?.exclude?.length ? appConfig.exclude : undefined;
			const industry = appConfig?.industry;

			const patternsDisplay = Array.isArray(includePattern)
				? includePattern.join(", ")
				: includePattern;

			activeStep = session.startStep(
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

			activeStep.done(
				appDir
					? formatLabelValue(
							highlight(appDir),
							`${highlight(String(extractedStrings.length))} string${extractedStrings.length === 1 ? "" : "s"}`,
						)
					: formatLabelValue(
							"Strings",
							`${highlight(String(extractedStrings.length))}`,
						),
			);
			activeStep = null;

			const stringEntries = buildStringEntries(extractedStrings);
			const sourceEntriesHash = computeSourceEntriesHash({ entries: stringEntries, industry: industry ?? null });

			// Fingerprint: hash(projectShortId:appDir:sortedKeys) — matches server formula
			const scope = `${projectShortId}:${appDir}`;
			const fingerprint = computeFingerprint(scope, stringEntries.map((e) => e.key));

			appExtractions.push({ appDir, stringEntries, sourceEntriesCount: stringEntries.length, sourceEntriesHash, fingerprint });
		}

		const totalSourceEntries = appExtractions.reduce((sum, a) => sum + a.sourceEntriesCount, 0);
		if (totalSourceEntries === 0) {
			session.warn(
				"No translatable strings found — deleted strings will still be synced.",
			);
		}

		if (options.dryRun) {
			const showRootLabel = appExtractions.length > 1;
			session.section("Dry run");
			session.step("Branch", highlight(branch));
			session.step("Target locales", joinHighlighted(apiConfig.targetLocales));
			for (const extraction of appExtractions) {
				session.step(
					displayAppDir(extraction.appDir, { showRootLabel }) || "App",
					`${highlight(String(extraction.sourceEntriesCount))} string${extraction.sourceEntriesCount === 1 ? "" : "s"}, fingerprint ${highlight(extraction.fingerprint)}`,
				);
			}
			return session.end("No API calls made.");
		}

		const repoIdentity = resolveGitRepositoryIdentity();
		const commitSha = options.commitSha ?? detectCommitSha() ?? undefined;

		if (options.verbose && !repoIdentity) {
			session.warn(
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

		activeStep = session.startStep(
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
			// Send branches so server can reconcile project.targetBranches.
			// Prefer config file value; fall back to YAML; omit if neither found (preserves server value).
			...(rootConfig?.targetBranches ?? yamlBranches
				? { targetBranches: (rootConfig?.targetBranches ?? yamlBranches) as string[] }
				: {}),
		});

		// All apps cached — stop spinner with that result, no polling needed
		if (submitResult.status === "complete") {
			const duration = ((Date.now() - startTime) / 1000).toFixed(1);
			activeStep.done(`Cached translations ready in ${duration}s`);
			activeStep = null;
			writeTranslateResult(
				submitResult.jobId,
				submitResult.apps.map((a) => ({
					appDir: a.appDir,
					...(a.localeFileTree ? { localeFileTree: a.localeFileTree } : {}),
					...(a.commitConfig ? { commitConfig: a.commitConfig } : {}),
				})),
			);
			renderWrittenLocaleFiles(session, submitResult.apps, gitRoot);
			warnOrphanedLocaleFiles(session, submitResult.apps, gitRoot);
			return session.end("Up to date.");
		}

		activeStep.done("Queued translation job");
		activeStep = null;

		const { jobId } = submitResult;
		const localeList = joinHighlighted(apiConfig.targetLocales);

		activeStep = session.startStep(
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
					activeStep.update(`${highlight(app.appDir)}: ${completed}/${total}`);
				}
			}

			if (status.status === "complete" || status.status === "failed") {
				finalStatus = status;
				break;
			}

			interval = Math.min(interval * 1.5, 5000);
		}

		if (!finalStatus) {
			activeStep.fail("No final translation status received.");
			return session.endFailure();
		}

		const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

		if (finalStatus.status === "complete") {
			activeStep.done(`Translations ready in ${elapsedSec}s`);
			activeStep = null;
			writeTranslateResult(
				finalStatus.jobId,
				finalStatus.apps.map((a) => ({
					appDir: a.appDir,
					...(a.localeFileTree ? { localeFileTree: a.localeFileTree } : {}),
					...(a.commitConfig ? { commitConfig: a.commitConfig } : {}),
				})),
			);
			renderWrittenLocaleFiles(session, finalStatus.apps, gitRoot);
			warnOrphanedLocaleFiles(session, finalStatus.apps, gitRoot);
			return session.end("Up to date.");
		}

		activeStep.fail("Translation incomplete");
		for (const app of finalStatus.apps) {
			if ((finalStatus.apps.length > 1 || !!app.appDir) && app.status !== "complete") {
				const label = displayAppDir(app.appDir, {
					showRootLabel: finalStatus.apps.length > 1,
				});
				session.warn(`${highlight(label)}${app.error ? `: ${app.error}` : ""}`);
			}
		}
		activeStep = null;

		if (computeExitCode("failed", onTranslationFailure) === 0) {
			return session.end("Continuing with existing translations.");
		}

		return session.endFatal("Build halted — translation failed.");
	} catch (error) {
		if (error instanceof VocoderAPIError && error.limitError) {
			const { limitError } = error;
			if (activeStep) {
				activeStep.fail(limitError.message, getLimitErrorGuidance(limitError));
				return session.endFailure();
			}
			return session.fail(limitError.message, getLimitErrorGuidance(limitError));
		}

		if (error instanceof VocoderAPIError) {
			const guidance =
				error.status === 401 || error.status === 403
					? [
							"API key rejected — the project may have been deleted or the key revoked.",
							"Run vocoder init or vocoder regenerate-key.",
						]
					: [];
			if (activeStep) {
				activeStep.fail(error.message, guidance);
				return session.endFailure();
			}
			return session.fail(error.message, guidance);
		}

		if (error instanceof Error) {
			const guidance: string[] = [];
			if (error.message.includes("git branch")) {
				guidance.push("Run from a git repository, or use vocoder translate --branch main.");
			}
			if (options.verbose) {
				guidance.push(`Full error: ${error.stack ?? error}`);
			}
			if (activeStep) {
				activeStep.fail(error.message, guidance);
				return session.endFailure();
			}
			return session.fail(error.message, guidance);
		}

		if (activeStep) {
			activeStep.fail("Translation failed.");
			return session.endFailure();
		}
		return session.fail("Translation failed.");
	}
}
