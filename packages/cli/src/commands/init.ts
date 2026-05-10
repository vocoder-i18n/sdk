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
import { config as loadEnv } from "dotenv";
import { printApiKey } from "../utils/output.js";
import { resolveGitContext } from "../utils/git-identity.js";
import { runAuthFlow } from "../utils/auth-flow.js";
import { runMcpSetup } from "../utils/mcp-setup.js";
import { selectOrganizationForInit } from "../utils/organization-select.js";

loadEnv();

// ── Main command ──────────────────────────────────────────────────────────────

export async function init(options: InitOptions = {}): Promise<number> {
	const apiUrl =
		options.apiUrl || process.env.VOCODER_API_URL || "https://vocoder.app";

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
			const anonApi = new VocoderAPI({ apiUrl, apiKey: "" });
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

				const routeAction = await p.select<string>({
					message: "This repo is already set up. What would you like to do?",
					options: [
						{ value: "key", label: "Get an API key for this app" },
						{ value: "add", label: "Add a new app directory" },
					],
				});

				if (p.isCancel(routeAction)) {
					p.cancel("Setup cancelled.");
					return 1;
				}

				if (routeAction === "key") {
					const anonApi2 = new VocoderAPI({ apiUrl, apiKey: "" });
					const authResult = await runAuthFlow(anonApi2, options, /* reauth */ true);
					if (!authResult) return 1;

					const spinner = p.spinner();
					spinner.start("Generating API key...");
					let apiKey: string;
					try {
						({ apiKey } = await anonApi2.regenerateProjectApiKey(
							authResult.token,
							firstApp.projectId,
						));
						spinner.stop("API key ready");
					} catch (err) {
						spinner.stop("Failed to generate key");
						const msg = err instanceof Error ? err.message : String(err);
						p.log.error(`Could not generate API key: ${msg}`);
						p.log.info("Try again or generate one from the dashboard.");
						return 1;
					}

					printApiKey(apiKey, identity.repoRoot);

					const detection = detectLocalEcosystem();
					const targetBranches = lookup.exactMatch?.targetBranches ?? ["main"];
					writeAppConfigs(
						allApps.map((a) => ({ appDir: a.appDir, appId: a.appId })),
						targetBranches,
						detection.isTypeScript,
						identity.repoRoot,
					);

					p.outro("Vocoder is set up for this repository.");
					return 0;
				}

				// "add" path — fall through to runAppCreate block below
				existingAppsForRepo = allApps;
				repoProjectId = firstApp.projectId;
				repoProjectName = firstApp.projectName;
			}
		}

		// ── 3. Auth: check stored token, prompt if missing ──────────────────────
		const api = new VocoderAPI({ apiUrl, apiKey: "" });
		let userToken: string;
		let userEmail: string;
		let userName: string | null;
		let authOrganizationId: string | undefined;

		const storedAuth = await verifyStoredAuth(api);

		if (storedAuth.status === "valid") {
			p.log.success(`Authenticated as ${chalk.bold(storedAuth.email)}`);
			userToken = storedAuth.token;
			userEmail = storedAuth.email;
			userName = storedAuth.name;
		} else {
			// "gone" = user deleted → full first-time flow (installUrl)
			// "expired" = token rejected → reauth via verificationUrl (no new org)
			// "none" = no stored token → full first-time flow (installUrl)
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
			userEmail = authResult.email;
			userName = authResult.name;
			authOrganizationId = authResult.organizationId;

			writeAuthData({
				token: userToken,
				userId: authResult.userId,
				email: userEmail,
				name: userName,
				createdAt: new Date().toISOString(),
			});
		}

		// ── 4. Organization selection ────────────────────────────────────────────
		const organizationResult = await selectOrganizationForInit({
			api,
			userToken,
			userEmail,
			identity: identity ?? null,
			lookup,
			repoProjectId,
			authOrganizationId,
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
			p.log.info(chalk.dim("Use the VOCODER_API_KEY already in your root .env"));
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

		if (!projectResult.repositoryBound && identity?.repoCanonical) {
			p.log.warn(
				`This repository isn't accessible to your GitHub App installation.\n` +
					`Translations won't run automatically until you grant access.\n\n` +
					`  To fix: go to your GitHub App installation settings and add this\n` +
					`  repository to the allowed list, or switch to "All repositories".\n` +
					(projectResult.configureUrl
						? `\n  ${chalk.dim(projectResult.configureUrl)}\n`
						: ""),
			);
		}

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

		// ── 9. MCP setup ─────────────────────────────────────────────────────────
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
