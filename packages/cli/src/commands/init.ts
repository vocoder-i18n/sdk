import * as p from "@clack/prompts";

import { checkPlanLimits, isPlanLimitFailure, printPlanLimitMessage } from "../utils/plan-check.js";
import {
	verifyStoredAuth,
	writeAuthData,
} from "../utils/auth-store.js";

import type { InitOptions } from "../types.js";
import { VocoderAPI } from "../utils/api.js";
import chalk from "chalk";
import { highlight } from "../utils/theme.js";
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

	p.intro(chalk.bold("Vocoder Setup"));

	try {
		// ── 1. Detect git context ───────────────────────────────────────────────
		const gitContext = resolveGitContext();
		const identity = gitContext.identity;

		for (const warning of gitContext.warnings) {
			p.log.warn(warning);
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
				const isMonorepo = allApps.every(app => app.appDir !== '');

				p.log.success(`Project ${chalk.bold(firstApp.projectName)} already exists`);
				if (isMonorepo) {
					p.log.info(
						`Configured apps: ${allApps.map((a) => highlight(a.appDir)).join(", ")}`,
					);
				}
				p.log.info(`Need a new API key? Run ${highlight("vocoder regenerate-key")}`);
				p.outro("Already set up.");
				return 0;
			}
		}

		// ── 3. Auth: check stored token, prompt if missing ──────────────────────
		const api = new VocoderAPI({ apiUrl, apiKey: "", debug });
		let userToken: string;
		let userName: string | null;

		const storedAuth = await verifyStoredAuth(api);

		if (storedAuth.status === "valid") {
			p.log.success(`Authenticated as: ${chalk.bold(storedAuth.email)}`);
			userToken = storedAuth.token;
			userName = storedAuth.name;
		} else {
			const reauth = storedAuth.status === "expired";
			if (reauth) {
				p.log.warn("Stored credentials expired — signing in again");
			} else if (storedAuth.status === "gone") {
				p.log.warn("Account not found — starting fresh setup");
			}
			const authResult = await runAuthFlow(
				api,
				options,
				reauth,
				identity?.repoCanonical,
			);
			if (!authResult) return 1;
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
			userToken,
			options,
			suggestedName: repoOwner,
		});

		if (!organizationResult) return 1;

		const { organizationId: selectedOrganizationId } = organizationResult;

		// ── 5. Plan limit pre-flight ─────────────────────────────────────────────
		const planCheck = await checkPlanLimits(
			api,
			userToken,
			selectedOrganizationId,
			apiUrl,
		);
		if (planCheck.atLimit) return 1;

		// ── 6. Project configuration ─────────────────────────────────────────────
		const projectResult = await runProjectCreate({
			api,
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
		if (!projectResult) return 1;

		// ── 7. Write API key to .env.local ───────────────────────────────────────
		const envFile = repoRoot
			? writeApiKeyToEnv(projectResult.apiKey, repoRoot)
			: writeApiKeyToEnv(projectResult.apiKey);

		// ── 8. GitHub Actions workflow ───────────────────────────────────────────
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
				p.log.warn(
					`${workflow.relativePath} already exists — review it to ensure it includes the Vocoder translate step.`,
				);
			}
		}

		// ── 9. Post-setup summary ────────────────────────────────────────────────
		const triggerBranch = projectResult.targetBranches[0] ?? "main";
		const url = (s: string) => chalk.cyan(chalk.underline(s));

		if (repoRoot && workflowWritten) {
			p.log.success(`Created ${highlight(workflowRelativePath)}`);
		}
		if (envFile) {
			p.log.success(`API key saved to ${highlight(envFile)}`);
		}

		p.log.message(chalk.bold("Next steps:"));
		p.log.message(`  1. Add ${highlight("VOCODER_API_KEY")} as a repository secret: ${url("https://vocoder.app/docs/secrets")}`);
		p.log.message(`  2. Add the Vocoder unplugin to your framework config: ${url("https://vocoder.app/docs/setup")}`);
		p.log.message(`  3. Wrap translatable strings with <T>: ${url("https://vocoder.app/docs/sdk")}`);
		p.log.message(`  4. Push to ${highlight(triggerBranch)} (or any of your trigger branches) — translations will run automatically.`);
		p.log.message(`  5. ${chalk.dim("(Optional)")} MCP server for AI-assisted setup: ${url("https://vocoder.app/docs/mcp")}`);

		p.outro("You're all set.");
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown setup error";
		if (isPlanLimitFailure(message)) {
			printPlanLimitMessage(apiUrl, message);
		} else {
			p.log.error(message);
		}
		return 1;
	}
}

