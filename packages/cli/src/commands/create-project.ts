import {
	CommandSession,
	formatLabelValue,
	joinHighlighted,
} from "../utils/command-session.js";
import { highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { VocoderAPI, VocoderAPIError } from "../utils/api.js";
import { ensureAccountAuth } from "../utils/account-auth.js";
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
 * Auto-starts browser sign-in in interactive shells when needed.
 * Prints the generated VOCODER_API_KEY to stdout on success.
 *
 * Git identity is auto-detected from the git remote. Use --repo to override.
 * Apps are NOT created here — they are managed lazily from the GitHub Action's
 * app-dirs input.
 *
 * Endpoint: POST /api/projects
 */
export async function createProject(options: CreateProjectOptions): Promise<number> {
	const session = new CommandSession("Vocoder Create Project");

	const apiUrl = options.apiUrl ?? process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const api = new VocoderAPI({ apiKey: "", apiUrl });
	const authResult = await ensureAccountAuth({
		api,
		session,
		options: { apiUrl: options.apiUrl },
		loginIfNeeded: "interactive",
	});

	if (authResult.status === "required") {
		return session.fail("Account sign-in required.", [
			`Run ${highlight(authResult.command)}.`,
		]);
	}
	if (authResult.status === "unreachable") {
		session.info(formatLabelValue("Account", highlight(authResult.stored.email)));
		return session.fail("Could not verify stored credentials.", [
			authResult.message,
			`Run ${highlight("vocoder auth status")} once your connection is back.`,
		]);
	}
	if (authResult.status === "cancelled") {
		return session.cancelled();
	}

	if (authResult.source === "stored") {
		session.step("Authenticated as", highlight(authResult.auth.email));
	}

	let repoCanonical: string | undefined;

	if (options.repo) {
		repoCanonical = options.repo;
	} else {
		const identity = resolveGitRepositoryIdentity();
		if (identity) {
			repoCanonical = identity.repoCanonical;
		} else {
			session.warn(
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

	const step = session.startStep(`Creating project ${highlight(options.name)}`);

	try {
		const result = await api.createProject(authResult.auth.token, {
			organizationId: options.organization,
			name: options.name,
			sourceLocale: options.sourceLocale,
			targetLocales,
			targetBranches,
			...(repoCanonical ? { repoCanonical } : {}),
		});

		step.done(`Created project ${highlight(result.projectName)}`);
		session.step("Project ID", highlight(result.projectId));
		session.step("Source locale", highlight(result.sourceLocale));
		session.step(
			"Target locales",
			result.targetLocales.length > 0 ? joinHighlighted(result.targetLocales) : "(none)",
		);
		session.step("Branches", joinHighlighted(result.targetBranches));
		if (repoCanonical) {
			session.step("Repository", highlight(repoCanonical));
		}
		session.blank();
		session.section("Add to your .env.local");
		session.message(`  ${highlight("VOCODER_API_KEY")}=${highlight(result.apiKey)}`);

		if (!result.repositoryBound && repoCanonical) {
			session.info(
				`Repository ${highlight(repoCanonical)} was not connected — it will bind automatically on first translate.`,
			);
		}

		return session.end();
	} catch (error) {
		if (error instanceof VocoderAPIError && error.limitError) {
			const { limitError } = error;
			step.fail(limitError.message, getLimitErrorGuidance(limitError));
			return session.endFailure();
		}

		step.fail(
			error instanceof Error ? error.message : "Failed to create project",
		);
		return session.endFailure();
	}
}
