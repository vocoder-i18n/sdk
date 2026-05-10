/**
 * @module auth-flow
 *
 * Browser-based authentication flow for `vocoder init`.
 * Scenarios:
 *   - First-time setup: shows install vs link choice, opens installUrl.
 *   - Re-auth (expired token): skips install choice, uses verificationUrl.
 *   - CI mode: emits machine-readable VOCODER_AUTH_URL / VOCODER_SESSION_ID lines.
 *   - No TTY / CI env: skips browser prompt, falls back to polling only.
 *
 * Three-way race: local callback server (instant) vs session poll (2 s intervals)
 * vs hard deadline (min of session expiry, 10 min). First to resolve wins.
 *
 * Exports: runAuthFlow, sleep
 */

import * as p from "@clack/prompts";

import type { InitOptions } from "../types.js";
import type { VocoderAPI } from "./api.js";
import chalk from "chalk";
import { startCallbackServer } from "./local-server.js";
import { tryOpenBrowser } from "./browser.js";

export async function sleep(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AuthFlowResult {
	token: string;
	userId: string;
	email: string;
	name: string | null;
	/** Set when auth + GitHub App install completed in one browser trip. */
	organizationId?: string;
	/** True when the browser session completed a GitHub OAuth discovery step. */
	discoveryReady?: boolean;
}

/**
 * Runs the full browser authentication flow and returns user credentials.
 * Returns null if the user cancelled or the session expired.
 *
 * @param reauth - When true (expired token), uses verificationUrl instead of
 *   installUrl to avoid creating a duplicate workspace.
 */
export async function runAuthFlow(
	api: VocoderAPI,
	options: InitOptions,
	reauth = false,
	repoCanonical?: string,
): Promise<AuthFlowResult | null> {
	// In CI mode, skip the callback server — the browser step is external and
	// polling is simpler and more testable than a local HTTP server.
	let server: Awaited<ReturnType<typeof startCallbackServer>> | null = null;
	if (!options.ci) {
		try {
			server = await startCallbackServer();
		} catch {
			// Port conflict or other issue — fall back to polling
		}
	}

	const session = await api.startCliAuthSession(server?.port, repoCanonical);
	const browserUrl = reauth
		? session.verificationUrl
		: (session.installUrl ?? session.verificationUrl);
	const expiresAt = new Date(session.expiresAt).getTime();

	if (options.ci) {
		// Machine-readable output parsed by e2e/helpers/cli.ts
		process.stdout.write(`VOCODER_AUTH_URL: ${browserUrl}\n`);
		process.stdout.write(`VOCODER_SESSION_ID: ${session.sessionId}\n`);
	} else if (
		process.stdin.isTTY &&
		process.stdout.isTTY &&
		process.env.CI !== "true"
	) {
		if (reauth) {
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
				}
				const opened = await tryOpenBrowser(browserUrl);
				if (!opened) {
					p.note(browserUrl, "Sign In");
					p.log.info("Open the URL above manually to continue.");
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
							hint: "new user",
						},
						{
							value: "link",
							label: "Already installed? Link your account",
							hint: "returning user",
						},
					],
				});

				if (p.isCancel(connectChoice)) {
					server?.close();
					p.cancel("Setup cancelled.");
					return null;
				}

				isLinkFlow = connectChoice === "link";
			}

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

			const opened = await tryOpenBrowser(urlToOpen);
			if (!opened) {
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

	const serverCallback: Promise<Record<string, string> | null> = server
		? server.waitForCallback().catch(() => null)
		: Promise.resolve(null);

	// Polling runs concurrently with the server wait so a missed local-server
	// callback (browser blocked fetch, mixed-content, port conflict) doesn't
	// stall until the server timeout.
	const sessionPoll = (async () => {
		while (!stopPolling && Date.now() < expiresAt) {
			try {
				const result = await api.pollCliAuthSession(session.sessionId);
				if (result.status === "complete" || result.status === "failed") {
					return result;
				}
			} catch {
				// Transient network error — keep trying
			}
			if (!stopPolling) await sleep(2000);
		}
		return null;
	})();

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

	const userInfo = await api.getCliUserInfo(rawToken);
	authSpinner.stop(`Authenticated as ${chalk.bold(userInfo.email)}`);

	return {
		token: rawToken,
		...userInfo,
		organizationId: callbackOrganizationId,
		discoveryReady: callbackDiscoveryReady,
	};
}
