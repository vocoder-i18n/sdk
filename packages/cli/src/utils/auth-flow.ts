/**
 * @module auth-flow
 *
 * Browser-based authentication flow for `vocoder init`. Vocoder account auth
 * via Better Auth (no GitHub App / GitHub OAuth in this path). The browser
 * lands on `verificationUrl` (Vocoder-hosted), the user signs in, and the page
 * issues a CLI-scoped token bound to this session.
 *
 * Scenarios:
 *   - First-time / reauth: open the browser to verificationUrl.
 *   - CI mode: emit machine-readable VOCODER_AUTH_URL / VOCODER_SESSION_ID lines.
 *   - No TTY: skip browser prompt, fall back to polling.
 *
 * Three-way race: local callback server (instant) vs session poll (2s intervals)
 * vs hard deadline (min of session expiry, 10 min). First to resolve wins.
 *
 * Exports: runAuthFlow, sleep
 */

import * as p from "@clack/prompts";

import type { AccountAuthOptions } from "../types.js";
import type { VocoderAPI } from "./api.js";
import { type CommandSession, formatLabelValue } from "./command-session.js";
import { highlight } from "./theme.js";
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
}

/**
 * Runs the full browser authentication flow and returns user credentials.
 * Returns null if the user cancelled or the session expired.
 *
 * `reauth` only affects copy ("sign in again" vs "sign in"). Both paths use
 * the same Vocoder-hosted verificationUrl — there's no separate install URL.
 */
export async function runAuthFlow(
	api: VocoderAPI,
	options: AccountAuthOptions,
	commandSession: CommandSession,
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

	const authSession = await api.startCliAuthSession(server?.port, repoCanonical);
	const browserUrl = authSession.verificationUrl;
	const expiresAt = new Date(authSession.expiresAt).getTime();

	if (options.ci) {
		// Machine-readable output parsed by e2e/helpers/cli.ts
		process.stdout.write(`VOCODER_AUTH_URL: ${browserUrl}\n`);
		process.stdout.write(`VOCODER_SESSION_ID: ${authSession.sessionId}\n`);
	} else if (
		process.stdin.isTTY &&
		process.stdout.isTTY &&
		process.env.CI !== "true"
	) {
		if (!options.yes) {
			const shouldOpen = await p.confirm({
				message: reauth
					? "Open your browser to sign in again?"
					: "Open your browser to sign in to Vocoder?",
			});
			if (p.isCancel(shouldOpen) || !shouldOpen) {
				server?.close();
				p.cancel("Setup cancelled.");
				return null;
			}
		}
		const opened = await tryOpenBrowser(browserUrl);
		if (!opened) {
			commandSession.step("Open this URL", highlight(browserUrl), "info");
		}
	}

	const authStep = commandSession.startStep("Waiting for sign-in");

	let rawToken: string | null = null;
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
				const result = await api.pollCliAuthSession(authSession.sessionId);
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
					| { status: "complete"; token: string }
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
							| { status: "complete"; token: string }
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
		} else if (winner.result.status === "complete") {
			rawToken = winner.result.token;
		} else {
			authStep.fail(winner.result.reason);
			return null;
		}
	}

	if (!rawToken) {
		authStep.fail("Authentication link expired.", [
			formatLabelValue("Run", highlight("vocoder init")),
		]);
		return null;
	}

	const userInfo = await api.getCliUserInfo(rawToken);
	authStep.done(formatLabelValue("Authenticated as", highlight(userInfo.email)));

	return {
		token: rawToken,
		...userInfo,
	};
}
