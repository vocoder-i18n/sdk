import { checkPlanLimits, isPlanLimitFailure, printPlanLimitMessage } from "../utils/plan-check.js";
import {
	CommandSession,
	displayAppDir,
	formatLabelValue,
	joinHighlighted,
} from "../utils/command-session.js";
import { promptConfirm } from "../utils/prompt-select.js";

import type { InitOptions } from "../types.js";
import type { APIAppConfig } from "../types.js";
import { VocoderAPI, VocoderAPIError } from "../utils/api.js";
import { ensureAccountAuth } from "../utils/account-auth.js";
import { highlight } from "../utils/theme.js";
import { installForProject } from "../utils/install-packages.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { resolveCurrentAppDir, resolveGitContext } from "../utils/git-identity.js";
import { runProjectCreate } from "../utils/project-create.js";
import { resolveLookupMatch } from "../utils/project-lookup.js";
import { selectOrganizationForInit } from "../utils/organization-select.js";
import { writeApiKeyToEnv } from "../utils/output.js";
import { writeGitHubActionsWorkflow } from "../utils/workflow-write.js";

loadEnvFiles();

// ── Main command ──────────────────────────────────────────────────────────────

async function confirmApiKeyRepair(
	session: CommandSession,
	options: InitOptions,
	reason: "missing" | "invalid",
): Promise<boolean | null> {
	if (options.yes) {
		session.step("Regenerate API key", highlight("Yes"));
		return true;
	}

	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return null;
	}

	const answer = await promptConfirm({
		message:
			reason === "missing"
				? "Generate a project API key for this repo?"
				: "Generate a fresh project API key for this repo?",
		confirmLabel: "Regenerate API key",
		initialValue: true,
	});
	if (answer === null) return null;
	session.step("Regenerate API key", highlight(answer ? "Yes" : "No"));
	return answer;
}

async function ensureRepairApiKey(params: {
	apiUrl: string;
	repoRoot: string;
	projectId: string;
	userToken: string;
	session: CommandSession;
	options: InitOptions;
}): Promise<
	| { status: "ok"; envFile: string | null; apiKey: string; projectConfig: APIAppConfig | null }
	| { status: "cancelled" }
	| { status: "failed" }
> {
	const currentApiKey = process.env.VOCODER_API_KEY;
	const canPrompt = Boolean(process.stdin.isTTY && process.stdout.isTTY);

	if (currentApiKey) {
		const projectApi = new VocoderAPI({ apiUrl: params.apiUrl, apiKey: currentApiKey });
		try {
			const projectConfig = await projectApi.getAppConfig();
			params.session.step("API key", highlight("Configured"));
			return {
				status: "ok",
				envFile: null,
				apiKey: currentApiKey,
				projectConfig,
			};
		} catch (error) {
			if (
				error instanceof VocoderAPIError &&
				(error.status === 401 || error.status === 403)
			) {
				const confirmed = await confirmApiKeyRepair(
					params.session,
					params.options,
					"invalid",
				);
				if (confirmed === null) {
					if (!canPrompt) {
						params.session.error("A valid project API key is required to finish setup.");
						params.session.info(
							`Run ${highlight("vocoder init --yes")} to regenerate it automatically.`,
						);
						params.session.info(
							`Or run ${highlight("vocoder regenerate-key")} after signing in.`,
						);
						return { status: "failed" };
					}
					return params.options.yes
						? { status: "failed" }
						: { status: "cancelled" };
				}
				if (!confirmed) {
					params.session.error("A valid project API key is required to finish setup.");
					params.session.info(`Run ${highlight("vocoder regenerate-key")} when you're ready.`);
					return { status: "failed" };
				}
			} else {
				params.session.warn("Could not verify the local project API key.");
				params.session.info(
					error instanceof Error
						? error.message
						: "Check your network connection and try again.",
				);
				return {
					status: "ok",
					envFile: null,
					apiKey: currentApiKey,
					projectConfig: null,
				};
			}
		}
	} else {
		const confirmed = await confirmApiKeyRepair(params.session, params.options, "missing");
		if (confirmed === null) {
			if (!canPrompt) {
				params.session.error("A project API key is required to finish setup.");
				params.session.info(
					`Run ${highlight("vocoder init --yes")} to regenerate it automatically.`,
				);
				params.session.info(
					`Or run ${highlight("vocoder regenerate-key")} after signing in.`,
				);
				return { status: "failed" };
			}
			return params.options.yes ? { status: "failed" } : { status: "cancelled" };
		}
		if (!confirmed) {
			params.session.error("A project API key is required to finish setup.");
			params.session.info(`Run ${highlight("vocoder regenerate-key")} when you're ready.`);
			return { status: "failed" };
		}
	}

	const regenerateStep = params.session.startStep("Generating API key");
	try {
		const accountApi = new VocoderAPI({ apiUrl: params.apiUrl, apiKey: "" });
		const { apiKey } = await accountApi.regenerateProjectApiKey(
			params.userToken,
			params.projectId,
		);
		process.env.VOCODER_API_KEY = apiKey;
		const envFile = writeApiKeyToEnv(apiKey, params.repoRoot);
		regenerateStep.done(
			envFile ? `API key saved to ${highlight(envFile)}` : "Generated API key",
		);
		if (!envFile) {
			params.session.warn("Could not write the API key to an env file.");
			params.session.info(`Find it at ${highlight("https://vocoder.app/settings")}.`);
		}
		let projectConfig: APIAppConfig | null = null;
		try {
			projectConfig = await new VocoderAPI({
				apiUrl: params.apiUrl,
				apiKey,
			}).getAppConfig();
		} catch {
			projectConfig = null;
		}
		return { status: "ok", envFile, apiKey, projectConfig };
	} catch (error) {
		regenerateStep.fail(
			error instanceof Error ? error.message : "Failed to generate a project API key.",
		);
		return { status: "failed" };
	}
}

export async function init(options: InitOptions = {}): Promise<number> {
	const apiUrl =
		options.apiUrl || process.env.VOCODER_API_URL || "https://vocoder.app";
	const debug = options.verbose ?? false;

	if (debug) {
		process.stderr.write(`[vocoder] API URL: ${apiUrl}\n`);
	}

	const session = new CommandSession("Vocoder Setup", {
		failureOutro: "Setup incomplete.",
		cancelOutro: "Setup cancelled.",
	});

	try {
		// ── 1. Detect git context ───────────────────────────────────────────────
		const gitContext = resolveGitContext();
		const identity = gitContext.identity;

		for (const warning of gitContext.warnings) {
			session.warn(warning);
		}

		const repoRoot = identity?.repoRoot;
		const currentAppDir = repoRoot ? resolveCurrentAppDir(repoRoot) : "";
		const api = new VocoderAPI({ apiUrl, apiKey: "", debug });

		// ── 2. Fast lookup: does an app already exist for this repo? ─────────
		if (identity) {
			const lookup = await api.lookupAppByRepo({
				repoCanonical: identity.repoCanonical,
				appDir: currentAppDir,
			});
			const matchedProject = resolveLookupMatch(lookup, currentAppDir);

			if (matchedProject) {
				const authResult = await ensureAccountAuth({
					api,
					session,
					options,
					repoCanonical: identity.repoCanonical,
					loginIfNeeded: "always",
					requiredCommand: "vocoder init --ci",
				});

				if (authResult.status === "required") {
					return session.fail("Interactive sign-in is not available in this shell.", [
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
				session.step("Workspace", highlight(matchedProject.organizationName));
				session.step("Project", highlight(matchedProject.projectName));
				if (matchedProject.appDir || lookup.hasWholeRepoApp) {
					session.step(
						"App",
						highlight(
							displayAppDir(matchedProject.appDir, { showRootLabel: true }) || "(root)",
						),
					);
				}

				const apiKeyResult = await ensureRepairApiKey({
					apiUrl,
					repoRoot: identity.repoRoot,
					projectId: matchedProject.projectId,
					userToken: authResult.auth.token,
					session,
					options,
				});

				if (apiKeyResult.status === "cancelled") {
					return session.cancelled();
				}
				if (apiKeyResult.status === "failed") {
					return session.endFailure();
				}

				const repairAppDirs = matchedProject.appDir ? [matchedProject.appDir] : [];
				const installMcpAnswer = await promptConfirm({
					message: "Install @vocoder/mcp for AI-assisted development? (optional)",
					confirmLabel: "Install MCP",
					initialValue: false,
				});
				if (installMcpAnswer === null) return session.cancelled();
				session.step("Install MCP", highlight(installMcpAnswer ? "Yes" : "No"));

				await installForProject({
					rootDir: identity.repoRoot,
					appDirs: repairAppDirs,
					installMcp: installMcpAnswer === true,
					session,
				});

				const workflowBranches =
					apiKeyResult.projectConfig?.targetBranches ??
					matchedProject.targetBranches ??
					["main"];
				const workflow = writeGitHubActionsWorkflow(
					identity.repoRoot,
					workflowBranches,
					repairAppDirs,
				);
				if (workflow.written) {
					session.success(`Created ${highlight(workflow.relativePath)}`);
				} else {
					session.warn(
						`${workflow.relativePath} already exists — review it to ensure it includes the Vocoder translate step.`,
					);
				}

				return session.end("Setup repaired.");
			}

			if (lookup.existingApps.length > 0) {
				const firstApp = lookup.existingApps[0]!;
				session.step("Project", highlight(firstApp.projectName));
				session.step(
					"Known apps",
					joinHighlighted(
						lookup.existingApps.map((app) =>
							displayAppDir(app.appDir, { showRootLabel: true }) || "(root)",
						),
					),
				);
				if (currentAppDir) {
					session.step("Current directory", highlight(currentAppDir));
				}
				return session.fail("This directory is not configured as a Vocoder app.", [
					"Run vocoder init from one of the known app directories.",
				]);
			}
		}

		// ── 3. Auth: check stored token, prompt if missing ──────────────────────
		const authResult = await ensureAccountAuth({
			api,
			session,
			options,
			repoCanonical: identity?.repoCanonical,
			loginIfNeeded: "always",
			requiredCommand: "vocoder init --ci",
		});
		if (authResult.status === "required") {
			return session.fail("Interactive sign-in is not available in this shell.", [
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
		if (authResult.status === "cancelled") return session.cancelled();

		if (authResult.source === "stored") {
			session.step("Authenticated as", highlight(authResult.auth.email));
		}

		// ── 4. Organization selection ────────────────────────────────────────────
		// Parse owner from "provider:owner/repo" — used as pre-fill for new workspace name.
		const repoOwner = identity?.repoCanonical?.split(":")?.[1]?.split("/")?.[0];
		const organizationResult = await selectOrganizationForInit({
			api,
			session,
			userToken: authResult.auth.token,
			options,
			suggestedName: repoOwner,
		});

		if (!organizationResult) return session.cancelled();

		const { organizationId: selectedOrganizationId } = organizationResult;

		// ── 5. Plan limit pre-flight ─────────────────────────────────────────────
		const planCheck = await checkPlanLimits(
			api,
			session,
			authResult.auth.token,
			selectedOrganizationId,
			apiUrl,
		);
		if (planCheck.atLimit) return session.cancelled();

		// ── 6. Project configuration ─────────────────────────────────────────────
		const projectResult = await runProjectCreate({
			api,
			session,
			userToken: authResult.auth.token,
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
