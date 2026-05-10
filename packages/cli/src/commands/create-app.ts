import * as p from "@clack/prompts";
import chalk from "chalk";
import { active, highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { VocoderAPI, VocoderAPIError } from "../utils/api.js";
import { readAuthData } from "../utils/auth-store.js";
import { resolveGitRepositoryIdentity } from "../utils/git-identity.js";
import { getLimitErrorGuidance } from "./translate.js";

loadEnvFiles();

export interface CreateAppOptions {
	/** Project display name (required). */
	name: string;
	/** BCP 47 source locale code, e.g. "en" (required). */
	sourceLocale: string;
	/** Comma-separated target locale codes, e.g. "fr,de,pt-BR". */
	targetLocales?: string;
	/** Comma-separated branch names to enable sync on. Defaults to "main". */
	targetBranches?: string;
	/** Organization ID to create the app in (required). */
	organization: string;
	/**
	 * Explicit git repository canonical, e.g. "github:owner/repo".
	 * Auto-detected from git remote if omitted.
	 */
	repo?: string;
	/**
	 * App directory within the repository for monorepos, e.g. "apps/web".
	 * Defaults to "." (repo root).
	 */
	appDir?: string;
	apiUrl?: string;
}

/**
 * Creates a new Vocoder app without the interactive init flow.
 *
 * Requires a valid user token in the local auth store (run `vocoder init` first).
 * Prints the generated VOCODER_API_KEY to stdout on success.
 *
 * Git identity is auto-detected from the git remote. Use --repo to override
 * auto-detection, or omit repo binding entirely if not in a git repository.
 *
 * Endpoint: POST /api/cli/apps
 *
 * @param options.name           App display name (required).
 * @param options.sourceLocale   Source language BCP 47 code (required).
 * @param options.targetLocales  Comma-separated target locale codes.
 * @param options.targetBranches Comma-separated branch names (default: "main").
 * @param options.organization   Organization ID (required).
 * @param options.repo           Git repo canonical override.
 * @param options.appDir         App directory for monorepos (default: ".").
 *
 * @throws If user token is missing, organization is invalid, or the plan's
 *         maxApps limit is exceeded.
 */
export async function createApp(options: CreateAppOptions): Promise<number> {
	const authData = readAuthData();
	if (!authData) {
		p.log.error(
			"Not logged in. Run `npx @vocoder/cli init` to authenticate first.",
		);
		return 1;
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiKey: "", apiUrl });

	// Resolve repo identity — auto-detect if not overridden
	let repoCanonical: string | undefined;
	let appDir = options.appDir ?? ".";

	if (options.repo) {
		repoCanonical = options.repo;
	} else {
		const identity = resolveGitRepositoryIdentity();
		if (identity) {
			repoCanonical = identity.repoCanonical;
			// Only override appDir from git if the caller didn't specify one
			if (!options.appDir && identity.repoAppDir) {
				appDir = identity.repoAppDir;
			}
		} else {
			p.log.warn(
				"Could not detect a git remote. The app will be created without repo binding — " +
					"sync-on-push will not function until a repository is connected via the Vocoder dashboard.",
			);
		}
	}

	const targetLocales = options.targetLocales
		? options.targetLocales.split(",").map((l) => l.trim()).filter(Boolean)
		: [];

	const targetBranches = options.targetBranches
		? options.targetBranches.split(",").map((b) => b.trim()).filter(Boolean)
		: ["main"];

	const spinner = p.spinner();
	spinner.start(`Creating app "${options.name}"…`);

	try {
		const result = await api.createProject(authData.token, {
			organizationId: options.organization,
			name: options.name,
			sourceLocale: options.sourceLocale,
			targetLocales,
			targetBranches,
			appDirs: [appDir],
			...(repoCanonical ? { repoCanonical } : {}),
		});

		spinner.stop(`Created app ${chalk.bold(result.projectName)}`);

		const lines = [
			`App ID:         ${result.projectId}`,
			`Source locale:  ${highlight(result.sourceLocale)}`,
			`Target locales: ${result.targetLocales.length > 0 ? result.targetLocales.map((l) => highlight(l)).join(", ") : chalk.dim("(none)")}`,
			`Branches:       ${result.targetBranches.map((b) => highlight(b)).join(", ")}`,
			...(repoCanonical
				? [`Repository:     ${highlight(repoCanonical)}${appDir !== "." ? ` (${appDir})` : ""}`]
				: []),
			"",
			`Add this to your .env.local file:`,
			`  ${chalk.bold("VOCODER_API_KEY")}=${highlight(result.apiKey)}`,
		];

		p.note(lines.join("\n"), "App created");

		if (!result.repositoryBound && repoCanonical) {
			p.log.info(
				`Repository "${repoCanonical}" was not connected — it will bind automatically on first translate.`,
			);
		}

		return 0;
	} catch (error) {
		spinner.stop("Failed to create app.");

		if (error instanceof VocoderAPIError && error.limitError) {
			const { limitError } = error;
			p.log.error(limitError.message);
			for (const line of getLimitErrorGuidance(limitError)) {
				p.log.info(line);
			}
			return 1;
		}

		p.log.error(
			error instanceof Error ? error.message : "Unknown error.",
		);
		return 1;
	}
}
