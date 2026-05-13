import * as p from "@clack/prompts";
import chalk from "chalk";
import type { VocoderAPI } from "./api.js";
import { promptTextInput } from "./prompt-text.js";
import { collectAppDirs } from "./app-dir-select.js";
import { detectGitBranches, filterableBranchSelect } from "./branch-select.js";
import type { LocaleOption } from "./locale-search.js";
import {
	searchMultiSelectLocales,
	searchSelectLocale,
} from "./locale-search.js";

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
	/** App directories collected during setup — used for GitHub Actions workflow generation only. */
	appDirs: string[];
}

function buildLocaleOptions(
	locales: Array<{ code: string; name: string; nativeName?: string }>,
): LocaleOption[] {
	return locales.map((l) => ({
		bcp47: l.code,
		label: `${l.name} — ${l.code}`,
	}));
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
	const projectName = await promptTextInput({
		message: "Project name",
		placeholder: "my-project",
		initialValue: params.defaultName,
		confirmLabel: "Project",
		validate: (value) => (value.trim() ? undefined : "Name is required"),
	});
	if (!projectName) return null;

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

	const languageOptions = buildLocaleOptions(sourceLocales);

	// ── App directories (monorepo support) ──────────────────────────────────────
	const appDirs = await collectAppDirs({ cwd: repoRoot, maxDirs: params.maxAppDirs });
	if (appDirs === null) return null;

	// ── Source locale ───────────────────────────────────────────────────────────
	const sourceLocale = await searchSelectLocale(
		languageOptions,
		"Source language (the language your code is written in)",
		params.defaultSourceLocale ?? "en",
		"Source language",
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
		undefined,
		"Target languages",
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
				confirmLabel: "Trigger branches",
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
	// Apps are NOT created here — they are created lazily by the GitHub Action
	// when it first runs with the app-dirs input. appDirs collected above are
	// only used for generating the workflow YAML with the correct app-dirs input.
	// Errors (including plan limit errors) propagate to the caller so it can
	// decide whether to show an upgrade link or a generic error message.
	const result = await api.createProject(userToken, {
		organizationId,
		name: projectName,
		sourceLocale,
		targetLocales,
		targetBranches,
		repoCanonical,
		appDirs: appDirs.length > 0 ? appDirs : undefined,
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
		appDirs,
	};
}

