import * as p from "@clack/prompts";
import chalk from "chalk";
import { highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { VocoderAPI, VocoderAPIError } from "../utils/api.js";
import { readAuthData } from "../utils/auth-store.js";
import { resolveGitRepositoryIdentity } from "../utils/git-identity.js";
import { getLimitErrorGuidance } from "./translate.js";

loadEnvFiles();

export interface CreateProjectOptions {
	/** Project display name (required). */
	name: string;
	/** BCP 47 source locale code, e.g. "en" (required). */
	sourceLocale: string;
	/** Comma-separated target locale codes, e.g. "fr,de,pt-BR". */
	targetLocales?: string;
	/** Comma-separated branch names to enable sync on. Defaults to "main". */
	targetBranches?: string;
	/** Organization ID to create the project in (required). */
	organization: string;
	/**
	 * Explicit git repository canonical, e.g. "github:owner/repo".
	 * Auto-detected from git remote if omitted.
	 */
	repo?: string;
	apiUrl?: string;
}

/**
 * Creates a new Vocoder project without the interactive init flow.
 *
 * Requires a valid user token in the local auth store (run `vocoder init` first).
 * Prints the generated VOCODER_API_KEY to stdout on success.
 *
 * Git identity is auto-detected from the git remote. Use --repo to override.
 * Apps are NOT created here — they are managed lazily from the GitHub Action's
 * app-dirs input.
 *
 * Endpoint: POST /api/projects
 */
export async function createProject(options: CreateProjectOptions): Promise<number> {
	p.intro(chalk.bold("Vocoder Create Project"));

	const authData = readAuthData();
	if (!authData) {
		p.log.error(
			"Not logged in. Run `npx @vocoder/cli init` to authenticate first.",
		);
		p.outro("");
		return 1;
	}

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiKey: "", apiUrl });

	let repoCanonical: string | undefined;

	if (options.repo) {
		repoCanonical = options.repo;
	} else {
		const identity = resolveGitRepositoryIdentity();
		if (identity) {
			repoCanonical = identity.repoCanonical;
		} else {
			p.log.warn(
				"Could not detect a git remote. The project will be created without repo binding — " +
					"sync will not function until a repository is connected via the Vocoder dashboard.",
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
	spinner.start(`Creating project "${options.name}"…`);

	try {
		const result = await api.createProject(authData.token, {
			organizationId: options.organization,
			name: options.name,
			sourceLocale: options.sourceLocale,
			targetLocales,
			targetBranches,
			...(repoCanonical ? { repoCanonical } : {}),
		});

		spinner.stop(`Created project ${highlight(result.projectName)}`);

		const lines = [
			`Project ID:     ${highlight(result.projectId)}`,
			`Source locale:  ${highlight(result.sourceLocale)}`,
			`Target locales: ${result.targetLocales.length > 0 ? result.targetLocales.map((l) => highlight(l)).join(", ") : chalk.dim("(none)")}`,
			`Branches:       ${result.targetBranches.map((b) => highlight(b)).join(", ")}`,
			...(repoCanonical ? [`Repository:     ${highlight(repoCanonical)}`] : []),
			"",
			`Add this to your .env.local file:`,
			`  ${chalk.bold("VOCODER_API_KEY")}=${highlight(result.apiKey)}`,
		];

		p.note(lines.join("\n"), "Project created");

		if (!result.repositoryBound && repoCanonical) {
			p.log.info(
				`Repository ${highlight(repoCanonical)} was not connected — it will bind automatically on first translate.`,
			);
		}

		p.outro("");
		return 0;
	} catch (error) {
		spinner.stop("Failed to create project.", 1);

		if (error instanceof VocoderAPIError && error.limitError) {
			const { limitError } = error;
			p.log.error(limitError.message);
			for (const line of getLimitErrorGuidance(limitError)) {
				p.log.info(line);
			}
			p.outro("");
			return 1;
		}

		p.log.error(
			error instanceof Error ? error.message : "Unknown error.",
		);
		p.outro("");
		return 1;
	}
}
