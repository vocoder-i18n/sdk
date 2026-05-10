import * as p from "@clack/prompts";

import type { VocoderAPI } from "./api.js";
import chalk from "chalk";
import { startCallbackServer } from "./local-server.js";
import { tryOpenBrowser } from "./browser.js";

export interface GitHubConnectResult {
	organizationId: string;
	organizationName: string;
	connectionLabel: string;
}

/**
 * Run the full GitHub App install flow for a new workspace.
 * Opens the browser to the GitHub App install page and waits for completion.
 *
 * Returns `null` if the user cancelled or an error occurred.
 */
export async function runGitHubInstallFlow(params: {
	api: VocoderAPI;
	userToken: string;
	organizationId?: string;
	yes?: boolean;
}): Promise<GitHubConnectResult | null> {
	// Try to start a local callback server for instant notification
	let server: Awaited<ReturnType<typeof startCallbackServer>> | null = null;
	try {
		server = await startCallbackServer();
	} catch {
		// Fall through — the user can re-run if something goes wrong
	}

	const { installUrl } = await params.api.startCliGitHubInstall(
		params.userToken,
		{
			organizationId: params.organizationId,
			callbackPort: server?.port,
		},
	);

	p.log.info("Opening GitHub to install the Vocoder App...");

	if (
		process.stdin.isTTY &&
		process.stdout.isTTY &&
		process.env.CI !== "true"
	) {
		const shouldOpen = params.yes
			? true
			: await p.confirm({ message: "Open in your browser?" });

		if (p.isCancel(shouldOpen)) {
			server?.close();
			return null;
		}

		if (shouldOpen) {
			const opened = await tryOpenBrowser(installUrl);
			if (!opened) {
				p.log.info(
					"Could not open a browser automatically. Use the URL above.",
				);
			}
		}
	}

	const connectSpinner = p.spinner();
	connectSpinner.start("Waiting for GitHub App installation...");

	if (server) {
		try {
			const params_timeout = 15 * 60 * 1000; // 15 minutes
			const callbackParams = await Promise.race([
				server.waitForCallback(),
				new Promise<null>((resolve) =>
					setTimeout(() => resolve(null), params_timeout),
				),
			]);

			server.close();

			if (!callbackParams) {
				connectSpinner.stop("GitHub App installation timed out");
				p.log.error(
					"The installation flow timed out. Run `vocoder init` again.",
				);
				return null;
			}

			if (callbackParams.error) {
				connectSpinner.stop("GitHub App installation failed");
				p.log.error(callbackParams.error);
				return null;
			}

			const { organizationId, connectionLabel, workspace_created } =
				callbackParams;

			if (!organizationId || !connectionLabel) {
				connectSpinner.stop("GitHub App installation incomplete");
				p.log.error("Missing organization or connection data from callback.");
				return null;
			}

			connectSpinner.stop(
				`Connected to GitHub as ${chalk.bold(connectionLabel)}`,
			);

			// Fetch the org name
			const orgName = workspace_created ? connectionLabel : organizationId;
			return {
				organizationId,
				organizationName: orgName,
				connectionLabel,
			};
		} catch {
			server.close();
			connectSpinner.stop("GitHub App installation failed");
			return null;
		}
	}

	// No local server — there's no polling fallback for install; just wait
	connectSpinner.stop("Could not detect GitHub App installation automatically");
	p.log.warn(
		"Complete the installation in your browser, then run `vocoder init` again.",
	);
	return null;
}

/**
 * Run the GitHub OAuth discovery flow to find existing installations.
 * Returns the list of installations with conflict labels, or null on cancellation/error.
 */
export async function runGitHubDiscoveryFlow(params: {
	api: VocoderAPI;
	userToken: string;
	organizationId?: string;
	yes?: boolean;
}): Promise<Array<{
	installationId: number;
	accountLogin: string;
	accountType: string;
	isSuspended: boolean;
	conflictLabel: string | null;
}> | null> {
	// Try local callback server
	let server: Awaited<ReturnType<typeof startCallbackServer>> | null = null;
	try {
		server = await startCallbackServer();
	} catch {
		// Fall through
	}

	const { oauthUrl } = await params.api.startCliGitHubOAuth(params.userToken, {
		organizationId: params.organizationId,
		callbackPort: server?.port,
	});

	p.log.info("Opening GitHub to authorize your account...");

	if (
		process.stdin.isTTY &&
		process.stdout.isTTY &&
		process.env.CI !== "true"
	) {
		const shouldOpen = params.yes
			? true
			: await p.confirm({ message: "Open in your browser?" });

		if (p.isCancel(shouldOpen)) {
			server?.close();
			return null;
		}

		if (shouldOpen) {
			const opened = await tryOpenBrowser(oauthUrl);
			if (!opened) {
				p.log.info(`Could not open browser automatically. Visit: ${oauthUrl}`);
			}
		}
	}

	const oauthSpinner = p.spinner();
	oauthSpinner.start("Waiting for GitHub authorization...");

	if (server) {
		try {
			const timeoutMs = 10 * 60 * 1000;
			const callbackParams = await Promise.race([
				server.waitForCallback(),
				new Promise<null>((resolve) =>
					setTimeout(() => resolve(null), timeoutMs),
				),
			]);

			server.close();

			if (!callbackParams) {
				oauthSpinner.stop("GitHub authorization timed out");
				return null;
			}

			if (callbackParams.error) {
				oauthSpinner.stop("GitHub authorization failed");
				p.log.error(callbackParams.error);
				return null;
			}
		} catch {
			server.close();
			oauthSpinner.stop("GitHub authorization failed");
			return null;
		}
	}

	oauthSpinner.stop("GitHub account authorized");

	// Fetch discovery results
	const discoveryResult = await params.api.getCliGitHubDiscovery(
		params.userToken,
	);
	return discoveryResult.installations;
}

type DiscoveredInstallation = {
	installationId: number;
	accountLogin: string;
	accountType: string;
	isSuspended: boolean;
	conflictLabel: string | null;
};

/**
 * Prompt the user to select a GitHub installation from discovery results.
 * Returns the selected installation ID, 'install_new' to trigger install flow,
 * or null on cancellation.
 */
export async function selectGitHubInstallation(
	installations: DiscoveredInstallation[],
	canInstallNew: boolean,
): Promise<number | "install_new" | null> {
	type SelectValue = string;

	const options: Array<{ value: SelectValue; label: string; hint?: string }> =
		installations.map((inst) => ({
			value: String(inst.installationId),
			label: inst.accountLogin,
			hint:
				[
					inst.accountType === "Organization" ? "GitHub org" : "personal account",
					inst.conflictLabel ? `connected to ${inst.conflictLabel}` : "",
					inst.isSuspended ? "suspended" : "",
				]
					.filter(Boolean)
					.join(" · ") || undefined,
		}));

	if (canInstallNew) {
		options.push({
			value: "install_new",
			label: `Install on a new account ${chalk.dim("(creates a new workspace)")}`,
		});
	}

	const selected = await p.select<SelectValue>({
		message: "Which GitHub account should this workspace connect to?",
		options,
	});

	if (p.isCancel(selected)) return null;
	if (selected === "install_new") return "install_new";

	return Number(selected);
}
