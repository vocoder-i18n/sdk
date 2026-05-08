import * as p from "@clack/prompts";

import { VocoderAPI, VocoderAPIError } from "../utils/api.js";
import {
	buildInstallCommand,
	detectLocalEcosystem,
	getPackagesToInstall,
} from "../utils/detect-local.js";
import {
	clearAuthData,
	readAuthData,
	verifyStoredAuth,
	writeAuthData,
} from "../utils/auth-store.js";
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { findExistingConfig, writeVocoderConfig } from "../utils/write-config.js";
import { highlight, info } from "../utils/theme.js";
import {
	runAppCreate,
	runProjectCreate,
} from "../utils/project-create.js";
import {
	runGitHubDiscoveryFlow,
	runGitHubInstallFlow,
	selectGitHubInstallation,
} from "../utils/github-connect.js";

import type { InitOptions } from "../types.js";
import chalk from "chalk";
import { getSetupSnippets } from "../utils/setup-snippets.js";
import { join } from "node:path";
import { config as loadEnv } from "dotenv";
import { resolveGitContext } from "../utils/git-identity.js";
import { selectOrganization } from "../utils/organization.js";
import { startCallbackServer } from "../utils/local-server.js";

loadEnv();

const SUBSCRIPTION_SETTINGS_PATH =
	"/dashboard/workspace/settings?tab=subscription";

async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryOpenBrowser(url: string): Promise<boolean> {
	if (!process.stdout.isTTY || process.env.CI === "true") {
		return false;
	}

	let command: string;
	let args: string[];

	if (process.platform === "darwin") {
		command = "open";
		args = [url];
	} else if (process.platform === "win32") {
		command = "rundll32";
		args = ["url.dll,FileProtocolHandler", url];
	} else {
		command = "xdg-open";
		args = [url];
	}

	return await new Promise<boolean>((resolve) => {
		try {
			const child = spawn(command, args, {
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			});

			let settled = false;
			child.once("spawn", () => {
				if (settled) return;
				settled = true;
				child.unref();
				resolve(true);
			});
			child.once("error", () => {
				if (settled) return;
				settled = true;
				resolve(false);
			});
			setTimeout(() => {
				if (settled) return;
				settled = true;
				resolve(false);
			}, 300);
		} catch {
			resolve(false);
		}
	});
}

function isPlanLimitFailure(message?: string): boolean {
	if (!message) return false;
	return /limit|upgrade/i.test(message);
}

function getSubscriptionSettingsUrl(apiUrl: string): string {
	return new URL(SUBSCRIPTION_SETTINGS_PATH, apiUrl).toString();
}

function printPlanLimitMessage(apiUrl: string, message: string): void {
	p.log.error(`You are over your plan limits.\n   ${message}`);
	p.log.info(`Manage subscription: ${getSubscriptionSettingsUrl(apiUrl)}`);
}

interface ScaffoldParams {
	sourceLocale: string;
	targetBranches: string[];
	appDir?: string;
}

function runScaffold(params: ScaffoldParams): void {
	const { sourceLocale, targetBranches, appDir } = params;

	const detection = detectLocalEcosystem();
	const useTypeScript = detection.isTypeScript;

	if (detection.ecosystem) {
		const frameworkLabel = detection.framework ?? detection.ecosystem;
		const pmLabel = detection.packageManager;
		p.log.info(`Detected:  ${chalk.bold(frameworkLabel)} (${pmLabel})`);
	}

	const { devPackages, runtimePackages } = getPackagesToInstall(detection);
	const allPackages = [...devPackages, ...runtimePackages];
	if (allPackages.length > 0) {
		p.log.info("");
		const installSpinner = p.spinner();
		installSpinner.start(`Installing ${allPackages.join(", ")}...`);

		try {
			if (devPackages.length > 0) {
				execSync(
					buildInstallCommand(detection.packageManager, devPackages, true),
					{ stdio: "pipe", cwd: process.cwd() },
				);
			}
			if (runtimePackages.length > 0) {
				execSync(
					buildInstallCommand(detection.packageManager, runtimePackages, false),
					{ stdio: "pipe", cwd: process.cwd() },
				);
			}
			installSpinner.stop(`Installed ${allPackages.join(", ")}`);
		} catch {
			installSpinner.stop("Package installation failed");
			const cmds = [
				devPackages.length > 0
					? buildInstallCommand(detection.packageManager, devPackages, true)
					: null,
				runtimePackages.length > 0
					? buildInstallCommand(detection.packageManager, runtimePackages, false)
					: null,
			]
				.filter(Boolean)
				.join(" && ");
			p.log.warn(`Run manually: ${highlight(cmds)}`);
		}
	} else if (detection.ecosystem) {
		p.log.info(`Packages:  ${chalk.green("already installed")}`);
	}

	const snippets = getSetupSnippets({
		framework: detection.framework,
		ecosystem: detection.ecosystem,
		sourceLocale,
		targetBranches,
		appDir,
	});

	const steps: Array<{ label: string; hint: string; code: string }> = [];

	if (snippets.pluginStep) {
		steps.push({
			label: snippets.pluginStep.file,
			hint: "register the build plugin so Vocoder can extract your strings",
			code: snippets.pluginStep.code,
		});
	}

	if (snippets.providerStep) {
		steps.push({
			label: snippets.providerStep.file,
			hint: "wrap your app so translations load at runtime",
			code: snippets.providerStep.code,
		});
	}

	steps.push({
		label: "wrap translatable text",
		hint: "mark strings for extraction — Vocoder picks these up on push",
		code: snippets.wrapStep.code,
	});

	p.log.message("");
	p.log.message(chalk.bold("Finish setup in your code"));
	p.log.message("");

	for (let i = 0; i < steps.length; i++) {
		const step = steps[i]!;
		p.log.step(
			`${chalk.bold(step.label)}  ${chalk.dim(`— ${step.hint}`)}`,
		);
		printCodeBlock(step.code);
		if (i < steps.length - 1) p.log.message("");
	}

	// Write vocoder.config.{ts,js} if not already present
	const written = writeVocoderConfig({ targetBranches, useTypeScript });
	if (written) {
		p.log.success(`Created ${highlight(written)}`);
	} else if (!findExistingConfig(process.cwd())) {
		const ext = useTypeScript ? "ts" : "js";
		p.log.warn(
			`Could not write vocoder.config.${ext} — create it manually with your extraction patterns.`,
		);
	}

	p.log.message("");
	const branchList =
		targetBranches.length > 0
			? targetBranches.map((b) => highlight(b)).join(" or ")
			: highlight("your target branch");
	p.log.success(
		`Push to ${branchList} to trigger your first translation run.`,
	);
	p.log.message(info("  Docs: https://vocoder.app/docs/getting-started"));
}


function writeApiKeyToEnv(apiKey: string): boolean {
	const envPath = join(process.cwd(), ".env");
	if (!existsSync(envPath)) return false;

	try {
		const content = readFileSync(envPath, "utf-8");
		const keyLine = `VOCODER_API_KEY=${apiKey}`;
		let updated: string;

		if (/^VOCODER_API_KEY=/m.test(content)) {
			updated = content.replace(/^VOCODER_API_KEY=.*/m, keyLine);
		} else {
			const sep = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
			updated = `${content}${sep}${keyLine}\n`;
		}

		writeFileSync(envPath, updated);
		return true;
	} catch {
		return false;
	}
}

function printApiKey(apiKey: string): void {
	const saved = writeApiKeyToEnv(apiKey);

	p.log.message("");
	p.log.message(chalk.bold("Your API Key"));
	printCodeBlock(`VOCODER_API_KEY=${apiKey}`);
	if (saved) {
		p.log.success(chalk.dim("Saved to .env"));
	} else {
		p.log.message(chalk.dim("  Add the above to your .env file"));
	}
}

// TODO: uncomment when @vocoder/mcp is published and functional
// function printMcpSetup(apiKey: string): void {
// 	const addCommand = `claude mcp add --scope project --transport stdio \\\n  --env VOCODER_API_KEY=${apiKey} \\\n  vocoder -- npx -y @vocoder/mcp`;
//
// 	const teamConfig = JSON.stringify(
// 		{
// 			mcpServers: {
// 				vocoder: {
// 					type: "stdio",
// 					command: "npx",
// 					args: ["-y", "@vocoder/mcp"]
// 				},
// 			},
// 		},
// 		null,
// 		2,
// 	);
//
// 	p.log.message("");
// 	p.log.message(chalk.bold("Use Vocoder with Claude Code"));
// 	p.log.message("");
// 	p.log.message("Run once to register the MCP server (embeds your key locally):");
// 	printCodeBlock(addCommand);
// 	p.log.message("");
// 	p.log.message(
// 		"To share with your team, commit " +
// 			highlight(".mcp.json") +
// 			" with an env var reference —",
// 	);
// 	p.log.message(
// 		"each developer sets " + highlight("VOCODER_API_KEY") + " in their own .env:",
// 	);
// 	printCodeBlock(teamConfig);
// 	p.log.message("");
// 	p.log.message(chalk.gray("Docs: https://vocoder.app/docs/mcp"));
// }

function printCodeBlock(code: string): void {
	const lines = code.split("\n");
	const maxLen = lines.reduce(
		(max: number, line: string) => Math.max(max, line.length),
		0,
	);
	const bar = chalk.gray("│");
	const pad = (s: string) => s + " ".repeat(maxLen - s.length);

	process.stdout.write(`${chalk.gray("│")}\n`);
	process.stdout.write(
		`${chalk.gray("│")}  ${chalk.gray(`┌${"─".repeat(maxLen + 2)}┐`)}\n`,
	);
	for (const line of lines) {
		process.stdout.write(`${chalk.gray("│")}  ${bar} ${pad(line)} ${bar}\n`);
	}
	process.stdout.write(
		`${chalk.gray("│")}  ${chalk.gray(`└${"─".repeat(maxLen + 2)}┘`)}\n`,
	);
}

// ── Auth helpers ─────────────────────────────────────────────────────────────



/**
 * Run the browser authentication flow.
 * Returns `{ token, userInfo, organizationId? }` on success, or null if cancelled.
 * When `organizationId` is set, the GitHub App was installed in the same browser
 * trip — the caller should skip workspace selection and GitHub connect.
 *
 * @param reauth - When true, the user has an expired token and already has a workspace.
 *   Use verificationUrl (auth/cli page) instead of installUrl so we don't create a
 *   duplicate workspace. The direct-to-GitHub install URL is only for first-time setup.
 */
async function runAuthFlow(
	api: VocoderAPI,
	options: InitOptions,
	reauth = false,
	repoCanonical?: string,
): Promise<{
	token: string;
	userId: string;
	email: string;
	name: string | null;
	organizationId?: string;
	discoveryReady?: boolean;
} | null> {
	// Try to start a local callback server for instant token delivery.
	// In --ci mode the browser step is handled externally, so skip the callback
	// server and go straight to polling — simpler and testable.
	let server: Awaited<ReturnType<typeof startCallbackServer>> | null = null;
	if (!options.ci) {
		try {
			server = await startCallbackServer();
		} catch {
			// Port conflict or other issue — fall back to polling
		}
	}

	const session = await api.startCliAuthSession(server?.port, repoCanonical);
	// Re-auth: user already has a workspace — use verificationUrl (auth/cli page)
	// so we don't trigger a new GitHub App install and create a duplicate workspace.
	// First-time: use installUrl to combine Vocoder auth + App install in one trip.
	const browserUrl = reauth
		? session.verificationUrl
		: (session.installUrl ?? session.verificationUrl);
	const expiresAt = new Date(session.expiresAt).getTime();
	p.log.info(browserUrl);

	if (options.ci) {
		// Machine-readable output for automated test harnesses.
		// Parsed by e2e/helpers/cli.ts: /^VOCODER_AUTH_URL: (.+)$/m
		process.stdout.write(`VOCODER_AUTH_URL: ${browserUrl}\n`);
		// Also emit the session ID separately so tests can expire/complete sessions
		process.stdout.write(`VOCODER_SESSION_ID: ${session.sessionId}\n`);
	} else if (
		process.stdin.isTTY &&
		process.stdout.isTTY &&
		process.env.CI !== "true"
	) {
		if (reauth) {
			// Re-auth: token expired, just sign in — no install choice needed
			if (!options.yes) {
				const shouldOpen = await p.confirm({
					message: "Open your browser to sign in again?",
				});
				if (p.isCancel(shouldOpen)) {
					server?.close();
					p.cancel("Setup cancelled.");
					return null;
				}
				if (!shouldOpen) {
					server?.close();
					p.cancel("Setup cancelled.");
					return null;
				} else {
					const opened = await tryOpenBrowser(browserUrl);
					if (!opened) {
						p.note(browserUrl, "Sign In");
						p.log.info("Open the URL above manually to continue.");
					}
				}
			} else {
				await tryOpenBrowser(browserUrl);
			}
		} else {
			// First-time setup: let user choose install vs link existing
			let isLinkFlow = false;
			if (!options.yes) {
				const connectChoice = await p.select<string>({
					message:
						"Vocoder needs to be installed on your GitHub account to get started",
					options: [
						{
							value: "install",
							label: "Install GitHub App",
							hint: "recommended",
						},
						{ value: "link", label: "Already installed? Link your account" },
					],
				});

				if (p.isCancel(connectChoice)) {
					server?.close();
					p.cancel("Setup cancelled.");
					return null;
				}

				isLinkFlow = connectChoice === "link";
			}

			// For "link": get the OAuth-only URL from the server (no install page shown)
			let urlToOpen = browserUrl;
			if (isLinkFlow) {
				try {
					const linkSession = await api.startCliGitHubLinkSession(
						session.sessionId,
						server?.port,
					);
					urlToOpen = linkSession.oauthUrl;
				} catch {
					// Fall back to install URL if link-start fails
					urlToOpen = browserUrl;
				}
			}

			// Open browser immediately — no separate confirm needed
			const opened = await tryOpenBrowser(urlToOpen);
			if (!opened) {
				// Only show URL as a fallback if auto-open fails
				p.log.warn("Could not open your browser automatically.");
				p.note(urlToOpen, "GitHub");
				p.log.info("Open the URL above to continue.");
			}
		}
	}

	const authSpinner = p.spinner();
	authSpinner.start("Waiting for GitHub authorization...");

	let rawToken: string | null = null;
	let callbackOrganizationId: string | undefined;
	let callbackDiscoveryReady = false;

	const deadline = Math.min(expiresAt, Date.now() + 10 * 60 * 1000);
	let stopPolling = false;

	// Local server future — null if no server or on error
	const serverCallback: Promise<Record<string, string> | null> = server
		? server.waitForCallback().catch(() => null)
		: Promise.resolve(null);

	// Polling runs concurrently with the server wait so a missed local-server
	// callback (browser blocked fetch, mixed-content, port conflict) doesn't
	// block for the full server timeout before the CLI gets the token.
	const sessionPoll = (async () => {
		while (!stopPolling && Date.now() < expiresAt) {
			try {
				const result = await api.pollCliAuthSession(session.sessionId);
				if (result.status === "complete" || result.status === "failed") {
					return result;
				}
			} catch {
				// transient network error — keep trying
			}
			if (!stopPolling) await sleep(2000);
		}
		return null;
	})();

	// Three-way race: local server, polling, hard deadline
	const winner = await new Promise<
		| { kind: "server"; params: Record<string, string> }
		| {
				kind: "poll";
				result:
					| { status: "complete"; token: string; organizationId?: string }
					| { status: "failed"; reason: string };
		  }
		| null
	>((resolve) => {
		let done = false;

		serverCallback
			.then((params) => {
				if (done || params === null || typeof params.token !== "string") return;
				done = true;
				resolve({ kind: "server", params });
			})
			.catch(() => {});

		sessionPoll
			.then((result) => {
				if (done || result === null) return;
				if (result.status === "complete" || result.status === "failed") {
					done = true;
					resolve({
						kind: "poll",
						result: result as
							| { status: "complete"; token: string; organizationId?: string }
							| { status: "failed"; reason: string },
					});
				}
			})
			.catch(() => {});

		setTimeout(
			() => {
				if (!done) {
					done = true;
					resolve(null);
				}
			},
			Math.max(0, deadline - Date.now()),
		);
	});

	stopPolling = true;
	server?.close();

	if (winner !== null) {
		if (winner.kind === "server") {
			rawToken = winner.params.token;
			if (
				typeof winner.params.organizationId === "string" &&
				winner.params.organizationId
			) {
				callbackOrganizationId = winner.params.organizationId;
			}
			if (winner.params.discovery_ready === "1") {
				callbackDiscoveryReady = true;
			}
		} else if (winner.result.status === "complete") {
			rawToken = winner.result.token;
			if (winner.result.organizationId) {
				callbackOrganizationId = winner.result.organizationId;
			}
		} else {
			authSpinner.stop();
			p.log.error(winner.result.reason);
			return null;
		}
	}

	if (!rawToken) {
		authSpinner.stop();
		p.log.error("The authentication link expired. Run `vocoder init` again.");
		return null;
	}

	// Validate the token and get user info
	const userInfo = await api.getCliUserInfo(rawToken);
	authSpinner.stop(`Authenticated as ${chalk.bold(userInfo.email)}`);

	return {
		token: rawToken,
		...userInfo,
		organizationId: callbackOrganizationId,
		discoveryReady: callbackDiscoveryReady,
	};
}

// ── Main command ─────────────────────────────────────────────────────────────

export async function init(options: InitOptions = {}): Promise<number> {
	const apiUrl =
		options.apiUrl || process.env.VOCODER_API_URL || "https://vocoder.app";

	p.intro(chalk.bold("Vocoder Setup"));

	try {
		// ── Detect git context ──────────────────────────────────────────────────
		const gitContext = resolveGitContext();
		const identity = gitContext.identity;

		if (gitContext.warnings.length > 0) {
			for (const warning of gitContext.warnings) {
				p.log.warn(warning);
			}
		}

		// ── Fast lookup: does a project already exist for this repo? ────────────
		// No spinner — this is a fast DB read and we don't want an empty ◇ on miss.
		let existingAppsForRepo: Array<{
			appDir: string;
			projectId: string;
			projectName: string;
			organizationName: string;
		}> = [];
		let repoProjectId: string | null = null;
		let repoProjectName: string | null = null;

		if (identity) {
			const anonApi = new VocoderAPI({ apiUrl, apiKey: "" });
			const lookup = await anonApi.lookupAppByRepo({
				repoCanonical: identity.repoCanonical,
				appDir: identity.repoAppDir,
			});

			// Exact match: this scope is already configured.
			if (lookup.exactMatch) {
				const { exactMatch } = lookup;
				p.log.success(`Project: ${chalk.bold(exactMatch.projectName)}`);
				p.log.info(
					`Branches: ${highlight((exactMatch.targetBranches ?? ["main"]).join(", "))}`,
				);

				const needsKey = await p.confirm({
					message: "Need to regenerate your API key?",
				});

				if (!p.isCancel(needsKey) && needsKey) {
					// Auth required — run sign-in flow before generating key
					const anonApi = new VocoderAPI({ apiUrl, apiKey: "" });
					const authResult = await runAuthFlow(
						anonApi,
						options,
						/* reauth */ true,
					);
					if (!authResult) return 1;

					const spinner = p.spinner();
					spinner.start("Generating new API key...");
					try {
						const { apiKey } = await anonApi.regenerateProjectApiKey(
							authResult.token,
							exactMatch.projectId,
						);
						spinner.stop("New API key generated");
						printApiKey(apiKey);
					} catch (err) {
						spinner.stop("Failed to generate key");
						const msg = err instanceof Error ? err.message : String(err);
						p.log.error(`Could not generate API key: ${msg}`);
						p.log.info("Try again or generate one from the dashboard.");
						return 1;
					}
				}

				const isTs = detectLocalEcosystem().isTypeScript;
				const written = writeVocoderConfig({ targetBranches: exactMatch.targetBranches ?? ["main"], useTypeScript: isTs });
				if (written) p.log.success(`Created ${highlight(written)}`);
				p.outro("Vocoder is already set up for this repository.");
				return 0;
			}

			// Whole-repo app exists: covers this repo from any directory — confirm and exit.
			if (lookup.hasWholeRepoApp) {
				const wholeRepo = lookup.existingApps.find((a) => a.appDir === "");
				if (wholeRepo) {
					p.log.success(`Project: ${chalk.bold(wholeRepo.projectName)}`);
					const isTs = detectLocalEcosystem().isTypeScript;
					const written = writeVocoderConfig({ targetBranches: ["main"], useTypeScript: isTs });
					if (written) p.log.success(`Created ${highlight(written)}`);
					p.outro("Vocoder is already set up for this repository.");
					return 0;
				}
			}

			// Other scoped apps exist: this repo has a project but not for this scope.
			// Store for display + validation in the app directory prompt.
			if (lookup.existingApps.length > 0) {
				existingAppsForRepo = lookup.existingApps;
				// All apps belong to the same project (one project per repo)
				repoProjectId = lookup.existingApps[0]?.projectId ?? null;
				repoProjectName = lookup.existingApps[0]?.projectName ?? null;
			}
		}

		// ── Auth: check stored token, prompt if missing ─────────────────────────
		const api = new VocoderAPI({ apiUrl, apiKey: "" });
		let userToken: string;
		let userEmail: string;
		let userName: string | null;

		// organizationId is set when auth+GitHub install completed in one browser trip
		let authOrganizationId: string | undefined;

		const storedAuth = await verifyStoredAuth(api);

			if (storedAuth.status === "valid") {
				p.log.success(`Authenticated as ${chalk.bold(storedAuth.email)}`);
				userToken = storedAuth.token;
				userEmail = storedAuth.email;
				userName = storedAuth.name;
			} else {
				// "gone" = user deleted from DB → full first-time flow (installUrl)
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

		// ── Workspace selection ─────────────────────────────────────────────────────
		let selectedOrganizationId: string;
		let selectedOrganizationName: string;

		if (authOrganizationId) {
			// Install path: auth+install completed in one browser trip, workspace already created.
			const organizationData = await api.listOrganizations(userToken);
			const ws = organizationData.organizations.find(
				(w) => w.id === authOrganizationId,
			);
			selectedOrganizationId = authOrganizationId;
			selectedOrganizationName = ws?.name ?? userEmail;
			p.log.success(
				`Connected as ${chalk.bold(userEmail)} — workspace: ${chalk.bold(selectedOrganizationName)}`,
			);
		} else {
			// Always check for cached discovery results first. The cache expires in
			// 5 minutes so returning users (no recent link flow) fall through cleanly.
			const discoveryResult = await api
				.getCliGitHubDiscovery(userToken)
				.catch(() => null);
			const cachedInstallations = discoveryResult?.installations ?? [];

			if (cachedInstallations.length > 0) {
				// Warn if none of the discovered installations belong to the org that
				// owns the current repo — the binding won't be created even if setup succeeds.
				if (identity?.repoCanonical) {
					const repoOwner = identity.repoCanonical
						.split(":")[1]
						?.split("/")[0]
						?.toLowerCase();
					if (repoOwner) {
						const hasMatchingAccount = cachedInstallations.some(
							(i) => i.accountLogin.toLowerCase() === repoOwner,
						);
						if (!hasMatchingAccount) {
							p.log.warn(
								`None of your GitHub App installations belong to "${repoOwner}", ` +
									`the account that owns this repository.\n` +
									`  The project will be created but translations won't trigger automatically.\n` +
									`  To fix: install the Vocoder GitHub App on "${repoOwner}" instead.`,
							);
						}
					}
				}

				// Auto-select when there's exactly one valid (non-suspended, unclaimed) installation
				const validInstallations = cachedInstallations.filter(
					(i) => !i.isSuspended && !i.conflictLabel,
				);

				let selectedInstallationId: number | string | null = null;

				if (
					validInstallations.length === 1 &&
					cachedInstallations.length === 1
				) {
					// Single installation — claim silently, no prompt needed
					selectedInstallationId = validInstallations[0]!.installationId;
				} else {
					selectedInstallationId = await selectGitHubInstallation(
						cachedInstallations.map((inst) => ({
							installationId: inst.installationId,
							accountLogin: inst.accountLogin,
							accountType: inst.accountType,
							isSuspended: inst.isSuspended,
							conflictLabel: inst.conflictLabel,
						})),
						false,
					);
				}

				if (
					selectedInstallationId === null ||
					selectedInstallationId === "install_new"
				) {
					p.cancel(
						"Setup cancelled. Re-run `vocoder init` and choose Install GitHub App.",
					);
					return 1;
				}

				const claimResult = await api.claimCliGitHubInstallation(userToken, {
					installationId: String(selectedInstallationId),
					organizationId: null,
				});
				selectedOrganizationId = claimResult.organizationId;
				selectedOrganizationName = claimResult.organizationName;
				p.log.success(`Workspace: ${chalk.bold(selectedOrganizationName)}`);
			} else {
				// ── Repo-aware workspace resolution ──────────────────────────────────────
				const organizationData = await api.listOrganizations(userToken, {
					repo: identity?.repoCanonical,
				});

				const repoCanonical = identity?.repoCanonical ?? null;
				// Workspaces whose GitHub installation covers the current repo
				const covering = repoCanonical
					? organizationData.organizations.filter((w) => w.coversRepo === true)
					: [];
				// Workspaces that have any GitHub connection (may not cover this repo)
				const connected = organizationData.organizations.filter(
					(w) => w.hasGitHubConnection,
				);

				if (repoCanonical && covering.length === 1) {
					// ── Scenario 1: exactly one workspace covers this repo — auto-select ──
					const ws = covering[0]!;
					selectedOrganizationId = ws.id;
					selectedOrganizationName = ws.name;
					p.log.success(`Workspace: ${chalk.bold(selectedOrganizationName)}`);
				} else if (repoCanonical && covering.length > 1) {
					// ── Scenario 2: multiple workspaces cover this repo — let user pick ──
					const choice = await p.select<string>({
						message: "Select workspace for this repo",
						options: covering.map((w) => ({
							value: w.id,
							label: `${w.name}  ${chalk.dim(`(${w.projectCount} project${w.projectCount !== 1 ? "s" : ""})`)}`,
						})),
					});
					if (p.isCancel(choice)) {
						p.cancel("Setup cancelled.");
						return 1;
					}
					const ws = covering.find((w) => w.id === choice)!;
					selectedOrganizationId = ws.id;
					selectedOrganizationName = ws.name;
					p.log.success(`Workspace: ${chalk.bold(selectedOrganizationName)}`);
				} else if (
					repoCanonical &&
					covering.length === 0 &&
					connected.length > 0
				) {
					// ── Scenario 3: connected workspaces exist but none cover this repo ──
					const shortRepo = repoCanonical.split(":")[1] ?? repoCanonical;
					p.log.warn(
						`${chalk.bold(shortRepo)} isn't accessible from your Vocoder installation.\n` +
							`  Grant access to this repository or install on the account that owns it.`,
					);

					const fixOptions: Array<{ value: string; label: string }> = [];
					for (const ws of connected) {
						if (ws.installationConfigureUrl) {
							fixOptions.push({
								value: `grant:${ws.id}`,
								label: `Configure ${chalk.bold(ws.connectionLabel ?? ws.name)}'s GitHub App installation`,
							});
						}
					}
					fixOptions.push({
						value: "install_new",
						label: `Install on a different GitHub account ${chalk.dim("(creates a new personal workspace)")}`,
					});
					fixOptions.push({ value: "cancel", label: "Cancel" });

					const fix = await p.select<string>({
						message: "How would you like to fix this?",
						options: fixOptions,
					});

					if (p.isCancel(fix) || fix === "cancel") {
						p.cancel("Setup cancelled.");
						return 1;
					}

					if (fix.startsWith("grant:")) {
						const ws = connected.find((w) => `grant:${w.id}` === fix)!;
						await tryOpenBrowser(ws.installationConfigureUrl!);
						p.cancel(
							`Grant access to ${chalk.bold(shortRepo)} in your browser,\n` +
								`  then re-run ${chalk.bold("vocoder init")}.`,
						);
						return 1;
					}

					// install_new: full install → creates new workspace covering the new account
					const connectResult = await runGitHubInstallFlow({
						api,
						userToken,
						yes: options.yes,
					});
					if (!connectResult) {
						p.log.error(
							"GitHub App installation did not complete. Run `vocoder init` again.",
						);
						return 1;
					}
					selectedOrganizationId = connectResult.organizationId;
					selectedOrganizationName = connectResult.organizationName;
					p.log.success(`Workspace: ${chalk.bold(selectedOrganizationName)}`);
				} else {
					// ── Fallback: no repo context or first-time user — standard select ────
					if (
						organizationData.organizations.length === 1 &&
						!organizationData.canCreateOrganization
					) {
						const ws = organizationData.organizations[0]!;
						selectedOrganizationId = ws.id;
						selectedOrganizationName = ws.name;
						p.log.success(`Workspace: ${chalk.bold(selectedOrganizationName)}`);
					} else {
						const organizationResult = await selectOrganization(organizationData);

						if (organizationResult.action === "cancelled") {
							p.cancel("Setup cancelled.");
							return 1;
						}

						if (organizationResult.action === "use") {
							selectedOrganizationId = organizationResult.organization.id;
							selectedOrganizationName = organizationResult.organization.name;
							p.log.success(`Workspace: ${chalk.bold(selectedOrganizationName)}`);
						} else {
							// ── New workspace: GitHub connect flow ────────────────────────────────
							const connectChoice = await p.select<string>({
								message: "Connect your new workspace to GitHub",
								options: [
									{ value: "install", label: "Install the Vocoder GitHub App" },
									{ value: "link", label: "Link an existing installation" },
								],
							});

							if (p.isCancel(connectChoice)) {
								p.cancel("Setup cancelled.");
								return 1;
							}

							if (connectChoice === "install") {
								const connectResult = await runGitHubInstallFlow({
									api,
									userToken,
									yes: options.yes,
								});
								if (!connectResult) {
									p.log.error(
										"GitHub App installation did not complete. Run `vocoder init` again.",
									);
									return 1;
								}
								selectedOrganizationId = connectResult.organizationId;
								selectedOrganizationName = connectResult.organizationName;
								p.log.success(
									`Workspace: ${chalk.bold(selectedOrganizationName)}`,
								);
							} else {
								const installations = await runGitHubDiscoveryFlow({
									api,
									userToken,
									yes: options.yes,
								});
								if (!installations) return 1;

								if (installations.length === 0) {
									p.log.warn(
										"No GitHub installations found. Install the Vocoder GitHub App first.",
									);
									const installNow = await p.confirm({
										message: "Open GitHub to install the App?",
									});
									if (p.isCancel(installNow) || !installNow) return 1;
									const connectResult = await runGitHubInstallFlow({
										api,
										userToken,
										yes: options.yes,
									});
									if (!connectResult) return 1;
									selectedOrganizationId = connectResult.organizationId;
									selectedOrganizationName = connectResult.organizationName;
								} else {
									const selectedInstallationId = await selectGitHubInstallation(
										installations.map((inst) => ({
											installationId: inst.installationId,
											accountLogin: inst.accountLogin,
											accountType: inst.accountType,
											isSuspended: inst.isSuspended,
											conflictLabel: inst.conflictLabel,
										})),
										true,
									);

									if (selectedInstallationId === null) {
										p.cancel("Setup cancelled.");
										return 1;
									}

									if (selectedInstallationId === "install_new") {
										const connectResult = await runGitHubInstallFlow({
											api,
											userToken,
											yes: options.yes,
										});
										if (!connectResult) return 1;
										selectedOrganizationId = connectResult.organizationId;
										selectedOrganizationName = connectResult.organizationName;
									} else {
										const claimResult = await api.claimCliGitHubInstallation(
											userToken,
											{
												installationId: String(selectedInstallationId),
												organizationId: null,
											},
										);
										selectedOrganizationId = claimResult.organizationId;
										selectedOrganizationName = claimResult.organizationName;
									}
								}
								p.log.success(
									`Workspace: ${chalk.bold(selectedOrganizationName)}`,
								);
							}
						} // closes new workspace else
					} // closes auto-select else
				} // closes main scenario if/else chain
			} // closes cachedInstallations else
		} // closes if (authOrganizationId) else

		// ── Add-app path: repo already has a project with scoped apps ───────────────
		// Skip plan limit check — we're adding an App to an existing project,
		// not creating a new one. Run the project config prompts then call
		// POST /api/cli/project/apps.
		if (repoProjectId && repoProjectName && existingAppsForRepo.length > 0) {
			p.log.info(
				`${chalk.bold(repoProjectName)} is already set up for this repo.\n` +
					`  Configured apps: ${existingAppsForRepo
						.map((a) => highlight(a.appDir || "(entire repo)"))
						.join(", ")}`,
			);

			const appResult = await runAppCreate({
				api,
				userToken,
				projectId: repoProjectId,
				projectName: repoProjectName,
				organizationName: selectedOrganizationName,
				repoCanonical: identity?.repoCanonical,
				defaultAppDir: identity?.repoAppDir,
				existingApps: existingAppsForRepo,
			});

			if (!appResult) {
				p.log.error("App setup failed. Run `vocoder init` again.");
				return 1;
			}

			runScaffold({
				sourceLocale: appResult.sourceLocale,
				targetBranches: appResult.targetBranches,
				appDir: identity?.repoAppDir,
			});
			p.outro("You're all set.");
			return 0;
		}

		// ── Plan limit pre-flight ────────────────────────────────────────────────────
		try {
			const wsCheck = await api.listOrganizations(userToken);
			const ws = wsCheck.workspaces.find((w) => w.id === selectedOrganizationId);
			if (ws && ws.maxProjects !== -1 && ws.projectCount >= ws.maxProjects) {
				p.log.warn(
					`Project limit reached — ${ws.projectCount}/${ws.maxProjects} on your ${chalk.bold(ws.planId)} plan.`,
				);

				// "Connect" only makes sense when this repo already has a project
				// (found by the repo lookup above). Showing all workspace projects
				// would let users bind this repo to an unrelated project — invalid
				// given the 1:1 project↔repo coupling.
				const options: Array<{ value: string; label: string }> = [];
				if (repoProjectId) {
					options.push({
						value: "connect",
						label: `Reconnect this repo to ${chalk.bold(repoProjectName ?? "existing project")}`,
					});
				}
				options.push({ value: "upgrade", label: "Upgrade plan" });
				options.push({ value: "cancel", label: "Cancel" });

				const limitAction = await p.select<string>({
					message: "What would you like to do?",
					options,
				});

				if (p.isCancel(limitAction) || limitAction === "cancel") {
					p.cancel("Setup cancelled.");
					return 1;
				}

				if (limitAction === "upgrade") {
					await tryOpenBrowser(`${apiUrl}${SUBSCRIPTION_SETTINGS_PATH}`);
					p.cancel(
						"Upgrade your plan in the browser, then re-run `vocoder init`.",
					);
					return 1;
				}

				// connect: fetch existing project config and create App binding without
				// prompting — the project already owns sourceLocale/targetBranches.
				const existingProjects = await api.listApps(
					userToken,
					selectedOrganizationId,
				);
				const chosenProject = existingProjects.find(
					(proj) => proj.id === repoProjectId,
				);
				if (!chosenProject) {
					p.log.error("Could not find the project. Try again.");
					return 1;
				}

				try {
					const appResult = await api.createApp(userToken, {
						projectId: chosenProject.id,
						appDir: identity?.repoAppDir ?? "",
						sourceLocale: chosenProject.sourceLocale,
						targetLocales: chosenProject.targetLocales,
						targetBranches: chosenProject.targetBranches,
						repoCanonical: identity?.repoCanonical ?? "",
					});
					p.log.success(`Connected to project: ${chalk.bold(chosenProject.name)}`);
					printApiKey(appResult.apiKey);
					runScaffold({
						sourceLocale: chosenProject.sourceLocale,
						targetBranches: chosenProject.targetBranches,
						appDir: identity?.repoAppDir,
					});
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					p.log.error(`Failed to create app binding: ${msg}`);
					return 1;
				}

				p.outro("You're all set.");
				return 0;
			}
		} catch {
			// Non-fatal
		}

		// ── Project configuration ────────────────────────────────────────────────────
		const projectResult = await runProjectCreate({
			api,
			userToken,
			organizationId: selectedOrganizationId,
			defaultName: identity?.repoCanonical
				? identity.repoCanonical.split("/").pop()
				: undefined,
			defaultSourceLocale: "en",
			repoCanonical: identity?.repoCanonical,
			defaultBranches: ["main"],
			defaultAppDir: identity?.repoAppDir,
		});

		if (!projectResult) {
			p.log.error("Project creation failed. Run `vocoder init` again.");
			return 1;
		}

		// Warn if the current repo isn't accessible to the GitHub App installation.
		// This means translations won't trigger on push until the App is granted access.
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

		// ── Scaffold + API key ───────────────────────────────────────────────────────
		runScaffold({
			sourceLocale: projectResult.sourceLocale,
			targetBranches: projectResult.targetBranches,
			appDir: identity?.repoAppDir,
		});

		printApiKey(projectResult.apiKey);

		p.outro("You're all set.");
		return 0;
	} catch (error) {
		if (error instanceof Error) {
			if (isPlanLimitFailure(error.message)) {
				printPlanLimitMessage(apiUrl, error.message);
				return 1;
			}
			p.log.error(`Error: ${error.message}`);
		} else {
			p.log.error("Unknown setup error");
		}

		return 1;
	}
}
