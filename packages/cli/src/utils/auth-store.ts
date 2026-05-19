import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { VocoderAPI, VocoderAPIError } from "./api.js";

export interface AuthData {
	token: string;
	userId: string;
	email: string;
	name: string | null;
	createdAt: string;
}

function getAuthFilePath(): string {
	return join(homedir(), ".vocoder", "auth.json");
}

export function readAuthData(): AuthData | null {
	const filePath = getAuthFilePath();
	try {
		const raw = readFileSync(filePath, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return null;
		const data = parsed as Partial<AuthData>;
		if (
			typeof data.token !== "string" ||
			typeof data.userId !== "string" ||
			typeof data.email !== "string" ||
			typeof data.createdAt !== "string"
		) {
			return null;
		}
		return {
			token: data.token,
			userId: data.userId,
			email: data.email,
			name: typeof data.name === "string" ? data.name : null,
			createdAt: data.createdAt,
		};
	} catch {
		return null;
	}
}

export function writeAuthData(data: AuthData): void {
	const filePath = getAuthFilePath();
	const dir = dirname(filePath);
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	writeFileSync(filePath, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function clearAuthData(): void {
	const filePath = getAuthFilePath();
	try {
		unlinkSync(filePath);
	} catch {
		// Already gone — that's fine
	}
}

// ── Stored token verification ────────────────────────────────────────────────

/**
 * Result of checking a stored CLI auth token against the API:
 * - "valid"   — token is good; user info is returned
 * - "expired" — token rejected (non-404); user record still exists → reauth,
 *               do NOT run the GitHub App install flow again
 * - "gone"    — 404; user record deleted → treat as first-time setup
 * - "none"    — no token on disk
 */
export type StoredAuthStatus =
	| {
			status: "valid";
			token: string;
			userId: string;
			email: string;
			name: string | null;
			createdAt: string;
	  }
	| { status: "expired"; stored: AuthData }
	| { status: "gone"; stored: AuthData }
	| { status: "unreachable"; stored: AuthData; message: string }
	| { status: "none" };

/**
 * Verify the stored CLI auth token. Clears it only when the server confirms it
 * is invalid or the account no longer exists.
 * Shared by the CLI (`commands/init.ts`) and the MCP (`tools/project-init.ts`)
 * so reauth detection stays in sync.
 */
export async function verifyStoredAuth(
	api: VocoderAPI,
): Promise<StoredAuthStatus> {
	const stored = readAuthData();
	if (!stored) return { status: "none" };

	try {
		const userInfo = await api.getCliUserInfo(stored.token);
		return {
			status: "valid",
			token: stored.token,
			createdAt: stored.createdAt,
			...userInfo,
		};
	} catch (err) {
		if (err instanceof VocoderAPIError) {
			if (err.status === 401 || err.status === 403) {
				clearAuthData();
				return { status: "expired", stored };
			}
			if (err.status === 404) {
				clearAuthData();
				return { status: "gone", stored };
			}
			return { status: "unreachable", stored, message: err.message };
		}
		return {
			status: "unreachable",
			stored,
			message: err instanceof Error ? err.message : "Could not verify stored credentials.",
		};
	}
}
