import { checkPlanLimits, isPlanLimitFailure, printPlanLimitMessage } from "../utils/plan-check.js";
import {
	CommandSession,
	displayAppDir,
	joinHighlighted,
} from "../utils/command-session.js";
import { promptConfirm } from "../utils/prompt-select.js";
import {
	verifyStoredAuth,
	writeAuthData,
} from "../utils/auth-store.js";

import type { InitOptions } from "../types.js";
import { VocoderAPI } from "../utils/api.js";
import { highlight } from "../utils/theme.js";
import { installForProject } from "../utils/install-packages.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { resolveGitContext } from "../utils/git-identity.js";
import { runAuthFlow } from "../utils/auth-flow.js";
import { runProjectCreate } from "../utils/project-create.js";
import { selectOrganizationForInit } from "../utils/organization-select.js";
import { writeApiKeyToEnv } from "../utils/output.js";
import { writeGitHubActionsWorkflow } from "../utils/workflow-write.js";

loadEnvFiles();

// ── Main command ──────────────────────────────────────────────────────────────

export async function init(options: InitOptions = {}): Promise<number> {
	const apiUrl =
		options.apiUrl || process.env.VOCODER_API_URL || "https://vocoder.app";
	const debug = options.verbose ?? false;

	if (debug) {
		process.stderr.write(`[vocoder] API URL: ${apiUrl}\n`);
	}

	const session = new CommandSession("Vocoder Setup");

	try {
		// ── 1. Detect git context ───────────────────────────────────────────────
		const gitContext = resolveGitContext();
		const identity = gitContext.identity;

		for (const warning of gitContext.warnings) {
			session.warn(warning);
		}

		const repoRoot = identity?.repoRoot;

		// ── 2. Fast lookup: does an app already exist for this repo? ─────────
		// No spinner — fast DB read, and we don't want a stray ◇ on a miss.
		if (identity) {
			const anonApi = new VocoderAPI({ apiUrl, apiKey: "", debug });
			const lookup = await anonApi.lookupAppByRepo({
				repoCanonical: identity.repoCanonical,
				appDir: "",
			});

			if (lookup.existingApps.length > 0) {
				const allApps = lookup.existingApps;
				const firstApp = allApps[0]!;
				const showRootLabel = allApps.length > 1;

				session.step("Project", highlight(firstApp.projectName));
				if (allApps.length > 0) {
					session.step(
						"Apps",
						joinHighlighted(
							allApps.map((app) =>
								displayAppDir(app.appDir, { showRootLabel }),
							),
						),
					);
				}
				session.info("Run vocoder regenerate-key to create a new API key.");
				return session.end();
			}
		}

		// ── 3. Auth: check stored token, prompt if missing ──────────────────────
		const api = new VocoderAPI({ apiUrl, apiKey: "", debug });
		let userToken: string;
		let userName: string | null;

		const storedAuth = await verifyStoredAuth(api);

		if (storedAuth.status === "valid") {
			session.step("Authenticated as", highlight(storedAuth.email));
			userToken = storedAuth.token;
			userName = storedAuth.name;
		} else {
			const reauth = storedAuth.status === "expired";
			if (reauth) {
				session.warn("Stored credentials expired — signing in again.");
			} else if (storedAuth.status === "gone") {
				session.warn("Account not found — starting fresh setup.");
			}
			const authResult = await runAuthFlow(
				api,
				options,
				session,
				reauth,
				identity?.repoCanonical,
			);
			if (!authResult) return session.cancelled();
			userToken = authResult.token;
			userName = authResult.name;

			writeAuthData({
				token: userToken,
				userId: authResult.userId,
				email: authResult.email,
				name: userName,
				createdAt: new Date().toISOString(),
			});
		}

		// ── 4. Organization selection ────────────────────────────────────────────
		// Parse owner from "provider:owner/repo" — used as pre-fill for new workspace name.
		const repoOwner = identity?.repoCanonical?.split(":")?.[1]?.split("/")?.[0];
		const organizationResult = await selectOrganizationForInit({
			api,
			session,
			userToken,
			options,
			suggestedName: repoOwner,
		});

		if (!organizationResult) return session.cancelled();

		const { organizationId: selectedOrganizationId } = organizationResult;

		// ── 5. Plan limit pre-flight ─────────────────────────────────────────────
		const planCheck = await checkPlanLimits(
			api,
			session,
			userToken,
			selectedOrganizationId,
			apiUrl,
		);
		if (planCheck.atLimit) return session.cancelled();

		// ── 6. Project configuration ─────────────────────────────────────────────
		const projectResult = await runProjectCreate({
			api,
			session,
			userToken,
			organizationId: selectedOrganizationId,
			defaultName: identity?.repoCanonical
				? identity.repoCanonical.split("/").pop()
				: undefined,
			defaultSourceLocale: "en",
			repoCanonical: identity?.repoCanonical,
			repoRoot: identity?.repoRoot,
			defaultBranches: ["main"],
			maxAppDirs: planCheck.remaining,
		});

		// null means user cancelled a prompt — individual steps already logged
		if (!projectResult) return session.cancelled();

		// ── 8. Install Vocoder packages ───────────────────────────────────────────
		const installMcpAnswer = await promptConfirm({
			message: "Install @vocoder/mcp for AI-assisted development? (optional)",
			confirmLabel: "Install MCP",
			initialValue: false,
		});
		if (installMcpAnswer === null) return session.cancelled();
		session.step("Install MCP", highlight(installMcpAnswer ? "Yes" : "No"));

		await installForProject({
			rootDir: repoRoot ?? process.cwd(),
			appDirs: projectResult.appDirs,
			installMcp: installMcpAnswer === true,
			session,
		});

		// ── 9. Write API key to .env.local ───────────────────────────────────────
		const envFile = repoRoot
			? writeApiKeyToEnv(projectResult.apiKey, repoRoot)
			: writeApiKeyToEnv(projectResult.apiKey);

		// ── 10. GitHub Actions workflow ──────────────────────────────────────────
		let workflowWritten = false;
		let workflowRelativePath = ".github/workflows/vocoder-translate.yml";
		if (repoRoot) {
			const workflow = writeGitHubActionsWorkflow(
				repoRoot,
				projectResult.targetBranches,
				projectResult.appDirs,
			);
			workflowWritten = workflow.written;
			workflowRelativePath = workflow.relativePath;

			if (!workflow.written) {
				session.warn(
					`${workflow.relativePath} already exists — review it to ensure it includes the Vocoder translate step.`,
				);
			}
		}

		// ── 11. Post-setup summary ───────────────────────────────────────────────
		const triggerBranch = projectResult.targetBranches[0] ?? "main";
		if (repoRoot && workflowWritten) {
			session.success(`Created ${highlight(workflowRelativePath)}`);
		}
		if (envFile) {
			session.success(`API key saved to ${highlight(envFile)}`);
		}

		session.blank();
		session.section("Next steps");
		session.message(`1. Add ${highlight("VOCODER_API_KEY")} as a repository secret: https://vocoder.app/docs/secrets`);
		session.message(`2. Set up ${highlight("@vocoder/react")}: install it, configure ${highlight("VocoderProvider")}, and wrap strings with ${highlight("<T>")}: https://vocoder.app/docs/setup`);
		session.message(`3. Push to ${highlight(triggerBranch)} to let Vocoder commit translations automatically.`);
		session.message(`4. Run ${highlight("vocoder pull")} to sync locale files locally.`);

		return session.end("You're all set.");
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown setup error";
		if (isPlanLimitFailure(message)) {
			printPlanLimitMessage(apiUrl, message);
			return session.endFailure();
		}
		return session.fail(message);
	}
}
