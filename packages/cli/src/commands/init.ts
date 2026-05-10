import * as p from "@clack/prompts";

import { checkPlanLimits, isPlanLimitFailure, printPlanLimitMessage } from "../utils/plan-check.js";
import { runAppCreate, runProjectCreate } from "../utils/project-create.js";
import { runScaffold, writeAppConfigs } from "../utils/scaffold.js";
import {
	verifyStoredAuth,
	writeAuthData,
} from "../utils/auth-store.js";

import type { InitOptions } from "../types.js";
import { VocoderAPI } from "../utils/api.js";
import chalk from "chalk";
import { detectLocalEcosystem } from "../utils/detect-local.js";
import { highlight } from "../utils/theme.js";
import { loadEnvFiles } from "../utils/load-env.js";
import { printApiKey } from "../utils/output.js";
import { resolveGitContext } from "../utils/git-identity.js";
import { runAuthFlow } from "../utils/auth-flow.js";
import { runMcpSetup } from "../utils/mcp-setup.js";
import { selectOrganizationForInit } from "../utils/organization-select.js";
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

		// ── 2. Fast lookup: does an app already exist for this repo? ─────────
		// No spinner — fast DB read, and we don't want a stray ◇ on a miss.
		let existingAppsForRepo: Array<{
			appDir: string;
			appId: string;
			projectId: string;
			projectName: string;
			organizationName: string;
		}> = [];
		let repoProjectId: string | null = null;
		let repoProjectName: string | null = null;
		let lookup: Awaited<ReturnType<VocoderAPI["lookupAppByRepo"]>> | null = null;

		if (identity) {
			const anonApi = new VocoderAPI({ apiUrl, apiKey: "", debug });
			lookup = await anonApi.lookupAppByRepo({
				repoCanonical: identity.repoCanonical,
				appDir: "",
			});

			if (lookup.existingApps.length > 0) {
				const allApps = lookup.existingApps;
				const firstApp = allApps[0]!;

				p.log.success(`App: ${chalk.bold(firstApp.projectName)}`);
				p.log.info(
					`Configured apps: ${allApps.map((a) => highlight(a.appDir || "(entire repo)")).join(", ")}`,
				);
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
			p.log.success(`Authenticated as ${chalk.bold(storedAuth.email)}`);
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
		const organizationResult = await selectOrganizationForInit({
			api,
			userToken,
			options,
		});

		if (!organizationResult) return 1;

		const { organizationId: selectedOrganizationId, organizationName: selectedOrganizationName } =
			organizationResult;

		// ── 5. Add-app path: repo already has scoped apps ─────────────────────────
		// Skips plan limit check — only a new App is added, not a new Project.
		if (repoProjectId && repoProjectName && existingAppsForRepo.length > 0) {
			const appResult = await runAppCreate({
				api,
				userToken,
				projectId: repoProjectId,
				projectName: repoProjectName,
				organizationName: selectedOrganizationName,
				repoCanonical: identity?.repoCanonical,
				existingApps: existingAppsForRepo,
			});

			if (!appResult) {
				p.log.error("App setup failed. Run `vocoder init` again.");
				return 1;
			}

			const detection = detectLocalEcosystem();
			runScaffold({ targetBranches: appResult.targetBranches });
			writeAppConfigs(
				[{ appDir: appResult.appDir, appId: appResult.appId }],
				appResult.targetBranches,
				detection.isTypeScript,
				identity?.repoRoot,
			);
			p.log.info(chalk.dim("Use the VOCODER_API_KEY already in your .env or .env.local"));
			p.outro("You're all set.");
			return 0;
		}

		// ── 6. Plan limit pre-flight ─────────────────────────────────────────────
		// Compute remaining app slots to cap the app-directory TUI.
		const planCheck = await checkPlanLimits(
			api,
			userToken,
			selectedOrganizationId,
			apiUrl,
		);
		if (planCheck.atLimit) return 1;

		// ── 7. Project configuration ─────────────────────────────────────────────
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

		// ── 8. Scaffold + config write ───────────────────────────────────────────
		const detection = detectLocalEcosystem();
		runScaffold({ targetBranches: projectResult.targetBranches });
		writeAppConfigs(
			projectResult.apps,
			projectResult.targetBranches,
			detection.isTypeScript,
			identity?.repoRoot,
		);
		printApiKey(projectResult.apiKey, identity?.repoRoot);

		// ── 9. GitHub Actions workflow ───────────────────────────────────────────
		// The translate-action runs on push to one of the target branches the user
		// selected at project-create time. If a workflow already exists, leave it —
		// the user may have customized it.
		if (identity?.repoRoot) {
			const workflow = writeGitHubActionsWorkflow(
				identity.repoRoot,
				projectResult.targetBranches,
			);
			if (workflow.written) {
				p.log.success(`Created ${highlight(workflow.relativePath)}`);
			} else {
				p.log.warn(
					`${workflow.relativePath} already exists — review it to ensure it includes the Vocoder translate step.`,
				);
			}

			p.note(
				`GitHub repo → Settings → Secrets and variables → Actions → New repository secret\n` +
					`  Name:  ${chalk.bold("VOCODER_API_KEY")}\n` +
					`  Value: ${chalk.bold(projectResult.apiKey)}`,
				"Next: add VOCODER_API_KEY as a repository secret",
			);

			p.note(
				`git add ${workflow.relativePath} && git commit -m "Add Vocoder translate workflow"`,
				"Don't forget to commit the workflow file",
			);
		}

		// ── 10. MCP setup ────────────────────────────────────────────────────────
		const wantsMcp = await p.confirm({
			message: "Set up the Vocoder MCP server?",
		});
		if (!p.isCancel(wantsMcp) && wantsMcp) {
			await runMcpSetup(projectResult.apiKey);
		}

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
