import type { AccountAuthOptions } from "../types.js";
import type { CommandSession } from "./command-session.js";
import type { VocoderAPI } from "./api.js";
import type { AuthData } from "./auth-store.js";
import { runAuthFlow } from "./auth-flow.js";
import { verifyStoredAuth, writeAuthData } from "./auth-store.js";

export type EnsureAccountAuthResult =
	| { status: "authenticated"; auth: AuthData; source: "stored" | "fresh" }
	| { status: "cancelled" }
	| { status: "required"; command: string }
	| { status: "unreachable"; stored: AuthData; message: string };

export function canOpenInteractiveAuth(): boolean {
	return Boolean(
		process.stdin.isTTY &&
			process.stdout.isTTY &&
			process.env.CI !== "true",
	);
}

function canStartLogin(
	options: Pick<AccountAuthOptions, "ci">,
	loginIfNeeded: "always" | "interactive" | "never",
): boolean {
	if (loginIfNeeded === "never") return false;
	if (options.ci) return loginIfNeeded === "always";
	return canOpenInteractiveAuth();
}

export async function ensureAccountAuth(params: {
	api: VocoderAPI;
	session: CommandSession;
	options?: AccountAuthOptions;
	repoCanonical?: string;
	loginIfNeeded?: "always" | "interactive" | "never";
	requiredCommand?: string;
}): Promise<EnsureAccountAuthResult> {
	const {
		api,
		session,
		options = {},
		repoCanonical,
		loginIfNeeded = "interactive",
		requiredCommand = "vocoder auth login --ci",
	} = params;

	const storedAuth = await verifyStoredAuth(api);

	if (storedAuth.status === "valid") {
		return {
			status: "authenticated",
			source: "stored",
			auth: {
				token: storedAuth.token,
				userId: storedAuth.userId,
				email: storedAuth.email,
				name: storedAuth.name,
				createdAt: storedAuth.createdAt,
			},
		};
	}

	if (storedAuth.status === "unreachable") {
		return {
			status: "unreachable",
			stored: storedAuth.stored,
			message: storedAuth.message,
		};
	}

	if (!canStartLogin(options, loginIfNeeded)) {
		return { status: "required", command: requiredCommand };
	}

	if (storedAuth.status === "expired") {
		session.warn("Stored credentials expired — signing in again.");
	} else if (storedAuth.status === "gone") {
		session.warn("Stored account no longer exists — signing in again.");
	}

	const authResult = await runAuthFlow(
		api,
		options,
		session,
		storedAuth.status === "expired",
		repoCanonical,
	);
	if (!authResult) {
		return { status: "cancelled" };
	}

	const authData: AuthData = {
		token: authResult.token,
		userId: authResult.userId,
		email: authResult.email,
		name: authResult.name,
		createdAt: new Date().toISOString(),
	};
	writeAuthData(authData);
	return { status: "authenticated", source: "fresh", auth: authData };
}
