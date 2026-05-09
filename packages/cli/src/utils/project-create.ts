import * as p from "@clack/prompts";
import chalk from "chalk";
import type { VocoderAPI } from "./api.js";
import { collectAppDirs, promptSingleAppDir } from "./app-dir-select.js";
import { detectGitBranches, filterableBranchSelect } from "./branch-select.js";
import type { LocaleOption } from "./locale-search.js";
import {
	searchMultiSelectLocales,
	searchSelectLocale,
} from "./locale-search.js";

export interface ExistingApp {
	appDir: string;
	appId: string;
	projectId: string;
	projectName: string;
	organizationName: string;
}

export interface ProjectCreateParams {
	api: VocoderAPI;
	userToken: string;
	organizationId: string;
	/** Default project name (repo name or directory name) */
	defaultName?: string;
	/** Pre-detected source locale, e.g. "en" */
	defaultSourceLocale?: string;
	/** Repo canonical for binding the project, e.g. "github:owner/repo" */
	repoCanonical?: string;
	/** Default target branches */
	defaultBranches?: string[];
	/** Git repository root — used as base for app directory validation */
	repoRoot?: string;
	/**
	 * Maximum number of app directories the user may add in this session.
	 * Derived from the workspace's remaining app entitlement (maxApps - appCount).
	 * Undefined means unlimited.
	 */
	maxAppDirs?: number;
}

export interface AppCreateParams {
	api: VocoderAPI;
	userToken: string;
	projectId: string;
	projectName: string;
	organizationName: string;
	repoCanonical?: string;
	/** Existing apps to display and validate against */
	existingApps: ExistingApp[];
}

export interface AppCreateResult {
	projectId: string;
	projectName: string;
	appDir: string;
	appId: string;
	sourceLocale: string;
	targetLocales: string[];
	targetBranches: string[];
}

export interface ProjectCreateResult {
	projectId: string;
	projectName: string;
	/** Project-scoped API key (vcp_) — one key covers all apps in this project. */
	apiKey: string;
	sourceLocale: string;
	targetLocales: string[];
	targetBranches: string[];
	repositoryBound: boolean;
	configureUrl?: string;
	/** One entry per created app, each with its own appId for vocoder.config.ts. */
	apps: Array<{ appDir: string; appId: string }>;
}

/** All locales — used for target language selection. */
function buildLocaleOptions(
	locales: Array<{ code: string; name: string; nativeName?: string }>,
): LocaleOption[] {
	return locales.map((l) => ({
		bcp47: l.code,
		label: `${l.name} — ${l.code}`,
	}));
}

/**
 * Deduplicated language list — used for source language selection.
 * Groups locales by language family (prefix before first hyphen) and keeps one
 * representative per family, preferring the shortest/base code (e.g. "en" over
 * "en-US"). This prevents showing "English", "English (American)", "English
 * (British)" as three separate choices when the user just means "English".
 */
function buildLanguageOptions(
	locales: Array<{ code: string; name: string; nativeName?: string }>,
): LocaleOption[] {
	const byFamily = new Map<string, LocaleOption>();

	for (const l of locales) {
		const family = l.code.split("-")[0]!.toLowerCase();
		const opt: LocaleOption = { bcp47: l.code, label: `${l.name} — ${l.code}` };
		const existing = byFamily.get(family);
		// Prefer base code (shorter, no region suffix) over regional variants
		if (!existing || l.code.length < existing.bcp47.length) {
			byFamily.set(family, opt);
		}
	}

	return Array.from(byFamily.values());
}

/**
 * Run the full project configuration TUI: prompts for app directories, source locale,
 * target locales, and target branches, then calls POST /api/cli/apps.
 *
 * Returns the created project info (including project-scoped API key and per-app IDs),
 * or null if cancelled.
 */
export async function runProjectCreate(
	params: ProjectCreateParams,
): Promise<ProjectCreateResult | null> {
	const { api, userToken, organizationId, repoCanonical, repoRoot } = params;

	// ── Project name ────────────────────────────────────────────────────────────
	// Use the detected repo name automatically — no prompt needed.
	const projectName = (params.defaultName ?? "my-project").trim();
	p.log.success(`Project: ${chalk.bold(projectName)}`);

	// ── Fetch source locales ────────────────────────────────────────────────────
	let sourceLocales: Array<{ code: string; name: string; nativeName?: string }>;
	try {
		({ sourceLocales } = await api.listLocales(userToken));
	} catch {
		p.log.error(
			"Failed to fetch supported locales. Check your connection and try again.",
		);
		return null;
	}

	const languageOptions = buildLanguageOptions(sourceLocales);

	// ── App directories (monorepo support) ──────────────────────────────────────
	const appDirs = await collectAppDirs({ cwd: repoRoot, maxDirs: params.maxAppDirs });
	if (appDirs === null) return null;

	if (appDirs.length > 0) {
		p.log.success(`App directories: ${appDirs.map((d) => chalk.bold(d)).join(", ")}`);
	}

	// ── Source locale ───────────────────────────────────────────────────────────
	const sourceLocale = await searchSelectLocale(
		languageOptions,
		"Source language (the language your code is written in)",
		params.defaultSourceLocale ?? "en",
	);

	if (sourceLocale === null) return null;

	// ── Compatible target locales (fetched after source is known) ───────────────
	let compatibleTargets: Array<{ code: string; name: string; nativeName?: string }>;
	try {
		compatibleTargets = await api.listCompatibleLocales(userToken, sourceLocale);
	} catch {
		p.log.error(
			"Failed to fetch compatible target locales. Check your connection and try again.",
		);
		return null;
	}

	const localeOptions = buildLocaleOptions(compatibleTargets);

	// ── Target locales ──────────────────────────────────────────────────────────
	const targetOptions = localeOptions.filter(
		(opt) => opt.bcp47 !== sourceLocale,
	);

	const targetLocales = await searchMultiSelectLocales(
		targetOptions,
		"Target languages (languages to translate into)",
	);

	if (targetLocales === null) return null;

	if (targetLocales.length === 0) {
		p.log.warn(
			"No target languages selected — you can add them later from the dashboard.",
		);
	}

	// ── Branch triggers ─────────────────────────────────────────────────────────
	const detected = detectGitBranches();
	const initialBranches = params.defaultBranches?.length
		? params.defaultBranches
		: [detected.defaultBranch];

	let pushBranches: string[] = [];
	{
		let initial = initialBranches;
		while (pushBranches.length === 0) {
			const result = await filterableBranchSelect({
				message: "Which branches should trigger translations?",
				branches: detected.branches,
				defaultBranch: detected.defaultBranch,
				initialValues: initial,
			});
			if (result === null) return null;
			if (result.length === 0) {
				p.log.warn(
					"At least one branch is required. Please select at least one.",
				);
				initial = [detected.defaultBranch];
			} else {
				pushBranches = result;
			}
		}
	}

	const targetBranches = pushBranches;

	// ── Create project ──────────────────────────────────────────────────────────
	try {
		const result = await api.createProject(userToken, {
			organizationId,
			name: projectName,
			sourceLocale,
			targetLocales,
			targetBranches,
			appDirs,
			repoCanonical,
		});

		p.log.success(`Project ${chalk.bold(result.projectName)} created!`);
		return {
			projectId: result.projectId,
			projectName: result.projectName,
			apiKey: result.apiKey,
			sourceLocale,
			targetLocales,
			targetBranches,
			repositoryBound: result.repositoryBound,
			configureUrl: result.configureUrl,
			apps: result.apps,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		p.log.error(`Failed to create project: ${message}`);
		return null;
	}
}

/**
 * Configure and create a new App under an existing project.
 * Used when the repo already has a project (monorepo: adding a new app directory).
 * No plan limit check runs — only a new App is created, not a new Project.
 */
export async function runAppCreate(
	params: AppCreateParams,
): Promise<AppCreateResult | null> {
	const { api, userToken, projectId, projectName, repoCanonical } = params;
	const existingDirs = params.existingApps.map((a) => a.appDir);

	// ── App directory ───────────────────────────────────────────────────────────
	const appDir = await promptSingleAppDir({ existingDirs });
	if (appDir === null) return null;
	if (appDir) {
		p.log.success(`App directory: ${chalk.bold(appDir)}`);
	}

	// ── Fetch source locales ────────────────────────────────────────────────────
	let sourceLocales: Array<{ code: string; name: string; nativeName?: string }>;
	try {
		({ sourceLocales } = await api.listLocales(userToken));
	} catch {
		p.log.error(
			"Failed to fetch supported locales. Check your connection and try again.",
		);
		return null;
	}

	const languageOptions = buildLanguageOptions(sourceLocales);

	// ── Source locale ───────────────────────────────────────────────────────────
	const sourceLocale = await searchSelectLocale(
		languageOptions,
		"Source language",
		"en",
	);
	if (sourceLocale === null) return null;

	// ── Compatible target locales (fetched after source is known) ───────────────
	let compatibleTargets: Array<{ code: string; name: string; nativeName?: string }>;
	try {
		compatibleTargets = await api.listCompatibleLocales(userToken, sourceLocale);
	} catch {
		p.log.error(
			"Failed to fetch compatible target locales. Check your connection and try again.",
		);
		return null;
	}

	// ── Target locales ──────────────────────────────────────────────────────────
	const targetOptions = buildLocaleOptions(compatibleTargets).filter(
		(opt) => opt.bcp47 !== sourceLocale,
	);
	const targetLocales = await searchMultiSelectLocales(
		targetOptions,
		"Target languages",
	);
	if (targetLocales === null) return null;
	if (targetLocales.length === 0) {
		p.log.warn(
			"No target languages selected — you can add them later from the dashboard.",
		);
	}

	// ── Branch triggers ─────────────────────────────────────────────────────────
	const detectedApp = detectGitBranches();

	let appPushBranches: string[] = [];
	{
		let initial = [detectedApp.defaultBranch];
		while (appPushBranches.length === 0) {
			const result = await filterableBranchSelect({
				message: "Which branches should trigger translations?",
				branches: detectedApp.branches,
				defaultBranch: detectedApp.defaultBranch,
				initialValues: initial,
			});
			if (result === null) return null;
			if (result.length === 0) {
				p.log.warn("At least one branch is required.");
				initial = [detectedApp.defaultBranch];
			} else {
				appPushBranches = result;
			}
		}
	}

	const targetBranches = appPushBranches;

	// ── Create the App ─────────────────────────────────────────────────────────
	try {
		const result = await api.createApp(userToken, {
			projectId,
			appDir,
			sourceLocale,
			targetLocales,
			targetBranches,
			repoCanonical: repoCanonical ?? "",
		});

		p.log.success(
			`App ${chalk.bold(appDir || "(root)")} added to ${chalk.bold(projectName)}!`,
		);
		return {
			projectId: result.projectId,
			projectName: result.projectName,
			appDir: result.appDir,
			appId: result.appId,
			sourceLocale,
			targetLocales,
			targetBranches,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		p.log.error(`Failed to add app: ${message}`);
		return null;
	}
}
