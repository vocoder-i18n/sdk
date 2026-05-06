import type {
	APIAppConfig,
	InitStartResponse,
	InitStatusResponse,
	LimitErrorResponse,
	LocalConfig,
	RepoIdentityPayload,
	RequestedSyncMode,
	SyncPolicyErrorResponse,
	TranslationBatchResponse,
	TranslationSnapshotResponse,
	TranslationStatusResponse,
	TranslationStringEntry,
} from "../types.js";

/**
 * Mirrors StringsHashInput and computeStringsHash in vocoder-app/lib/sync/strings-hash.ts.
 * Both must use the identical type shape and serialization — if you change one, change the other.
 * Uses source keys (not source texts) so that strings with the same text but different
 * formality/context produce different hashes and don't incorrectly short-circuit the pipeline.
 */
type StringsHashInput = {
	keys: string[];
	appIndustry?: string | null;
};

function computeStringsHash(input: StringsHashInput): string {
	const { createHash } = require("node:crypto") as typeof import("node:crypto");
	const sorted = [...input.keys].sort();
	return createHash("sha256")
		.update(JSON.stringify({ strings: sorted, appIndustry: input.appIndustry ?? null }))
		.digest("hex");
}

function isLimitErrorResponse(value: unknown): value is LimitErrorResponse {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Partial<LimitErrorResponse>;
	return (
		typeof candidate.errorCode === "string" &&
		typeof candidate.limitType === "string" &&
		typeof candidate.planId === "string" &&
		typeof candidate.current === "number" &&
		typeof candidate.required === "number" &&
		typeof candidate.upgradeUrl === "string" &&
		typeof candidate.message === "string"
	);
}

function isSyncPolicyErrorResponse(
	value: unknown,
): value is SyncPolicyErrorResponse {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Partial<SyncPolicyErrorResponse>;
	return (
		(candidate.errorCode === "BRANCH_NOT_ALLOWED" ||
			candidate.errorCode === "PROJECT_REPOSITORY_MISMATCH") &&
		typeof candidate.message === "string"
	);
}

function extractErrorMessage(payload: unknown, fallback: string): string {
	if (!payload || typeof payload !== "object") {
		return fallback;
	}

	const candidate = payload as Record<string, unknown>;
	if (typeof candidate.message === "string") {
		return candidate.message;
	}

	if (typeof candidate.error === "string") {
		return candidate.error;
	}

	return fallback;
}

function parsePayload(raw: string): unknown {
	if (raw.length === 0) {
		return null;
	}

	// HTML responses (e.g. Next.js error pages) are never valid API payloads.
	// Wrapping raw HTML as the error message causes it to leak into the TUI.
	const trimmed = raw.trimStart();
	if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
		return {
			message:
				"Unexpected response from server (received HTML). Check your network connection or try again.",
		};
	}

	try {
		return JSON.parse(raw);
	} catch {
		return { message: raw };
	}
}

async function readPayload(response: {
	text?: () => Promise<string>;
	json?: () => Promise<unknown>;
}): Promise<unknown> {
	if (typeof response.text === "function") {
		const raw = await response.text();
		return parsePayload(raw);
	}

	if (typeof response.json === "function") {
		return response.json();
	}

	return null;
}

export class VocoderAPIError extends Error {
	readonly status: number;
	readonly payload: unknown;
	readonly limitError: LimitErrorResponse | null;
	readonly syncPolicyError: SyncPolicyErrorResponse | null;

	constructor(params: {
		message: string;
		status: number;
		payload: unknown;
		limitError?: LimitErrorResponse | null;
		syncPolicyError?: SyncPolicyErrorResponse | null;
	}) {
		super(params.message);
		this.name = "VocoderAPIError";
		this.status = params.status;
		this.payload = params.payload;
		this.limitError = params.limitError ?? null;
		this.syncPolicyError = params.syncPolicyError ?? null;
	}
}

export class VocoderAPI {
	private apiUrl: string;
	private apiKey: string;

	constructor(config: LocalConfig) {
		this.apiUrl = config.apiUrl;
		this.apiKey = config.apiKey;
	}

	private async request<T>(
		path: string,
		init: RequestInit = {},
		errorPrefix?: string,
	): Promise<T> {
		const response = await fetch(`${this.apiUrl}${path}`, {
			...init,
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				...(init.headers ?? {}),
			},
		});

		const payload = await readPayload(response);

		if (!response.ok) {
			const limitError = isLimitErrorResponse(payload) ? payload : null;
			const syncPolicyError = isSyncPolicyErrorResponse(payload)
				? payload
				: null;
			const baseMessage = extractErrorMessage(
				payload,
				`Request failed with status ${response.status}`,
			);
			throw new VocoderAPIError({
				message: errorPrefix ? `${errorPrefix}: ${baseMessage}` : baseMessage,
				status: response.status,
				payload,
				limitError,
				syncPolicyError,
			});
		}

		return payload as T;
	}

	/**
	 * Fetch project configuration from API
	 * Project is determined from the API key
	 */
	async getAppConfig(): Promise<APIAppConfig> {
		const data = await this.request<{
			projectName: string;
			organizationName: string;
			sourceLocale: string;
			targetLocales: string[];
			targetBranches: string[];
			primaryBranch?: string;
			syncPolicy?: {
				blockingBranches?: string[];
				blockingMode?: "required" | "best-effort";
				nonBlockingMode?: "required" | "best-effort";
				defaultMaxWaitMs?: number;
			};
		}>("/api/cli/config", {}, "Failed to fetch project config");

		return {
			projectName: data.projectName,
			organizationName: data.organizationName,
			sourceLocale: data.sourceLocale,
			targetLocales: data.targetLocales,
			targetBranches: data.targetBranches ?? ["main"],
			primaryBranch: data.primaryBranch,
			syncPolicy: {
				blockingBranches: data.syncPolicy?.blockingBranches ?? [
					"main",
					"master",
				],
				blockingMode: data.syncPolicy?.blockingMode ?? "required",
				nonBlockingMode: data.syncPolicy?.nonBlockingMode ?? "best-effort",
				defaultMaxWaitMs: data.syncPolicy?.defaultMaxWaitMs ?? 60_000,
			},
		};
	}

	/**
	 * Submit strings for translation
	 * Project is determined from the API key
	 */
	private stableTextKey(text: string): string {
		// FNV-1a 32-bit hash for deterministic fallback IDs
		let hash = 0x811c9dc5;
		for (let i = 0; i < text.length; i++) {
			hash ^= text.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193);
		}
		return `SK_TEXT_${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
	}

	private normalizeStringEntries(
		entries: string[] | TranslationStringEntry[],
	): TranslationStringEntry[] {
		if (entries.length === 0) {
			return [];
		}

		const first = entries[0];
		if (typeof first === "string") {
			return (entries as string[]).map((text) => ({
				key: this.stableTextKey(text),
				text,
			}));
		}

		return (entries as TranslationStringEntry[]).map((entry, index) => ({
			// Fall back to stableTextKey only when text is present — id-only entries always have a key.
			key: entry.key || (entry.text ? this.stableTextKey(`${entry.text}:${index}`) : `_idonly_${index}`),
			text: entry.text,
			...(entry.context ? { context: entry.context } : {}),
			...(entry.formality ? { formality: entry.formality } : {}),
			...(entry.uiRole ? { uiRole: entry.uiRole } : {}),
		}));
	}

	async submitTranslation(
		branch: string,
		entries: string[] | TranslationStringEntry[],
		targetLocales: string[],
		options?: {
			requestedMode?: RequestedSyncMode;
			requestedMaxWaitMs?: number;
			clientRunId?: string;
			force?: boolean;
			/** From vocoder.config.ts — synced to App on every push */
			appIndustry?: string;
		},
		repoIdentity?: RepoIdentityPayload,
	): Promise<TranslationBatchResponse> {
		const allEntries = this.normalizeStringEntries(entries);
		// id-only entries (text: null) can't be translated without a localesPath source file.
		// Filter them out for API submission; they still count toward the fingerprint.
		const stringEntries = allEntries.filter((e): e is TranslationStringEntry & { text: string } => e.text != null);

		const stringsHash = computeStringsHash({ keys: allEntries.map((e) => e.key), appIndustry: options?.appIndustry ?? null });

		return this.request<TranslationBatchResponse>(
			"/api/cli/sync",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					branch,
					stringEntries,
					targetLocales,
					...(options?.force ? {} : { stringsHash }),
					...(options?.requestedMode
						? { requestedMode: options.requestedMode }
						: {}),
					...(typeof options?.requestedMaxWaitMs === "number"
						? { requestedMaxWaitMs: options.requestedMaxWaitMs }
						: {}),
					...(options?.clientRunId ? { clientRunId: options.clientRunId } : {}),
					...(repoIdentity?.repoCanonical
						? { repoCanonical: repoIdentity.repoCanonical }
						: {}),
					...(repoIdentity?.repoAppDir !== undefined
						? { repoAppDir: repoIdentity.repoAppDir }
						: {}),
					...(repoIdentity?.commitSha
						? { commitSha: repoIdentity.commitSha }
						: {}),
					...(options?.appIndustry ? { appIndustry: options.appIndustry } : {}),
				}),
			},
			"Translation submission failed",
		);
	}

	/**
	 * Check translation status
	 */
	async getTranslationStatus(
		batchId: string,
	): Promise<TranslationStatusResponse> {
		return this.request<TranslationStatusResponse>(
			`/api/cli/sync/status/${batchId}`,
			{},
			"Failed to check translation status",
		);
	}

	async getTranslationSnapshot(params: {
		branch: string;
		targetLocales: string[];
	}): Promise<TranslationSnapshotResponse> {
		const search = new URLSearchParams();
		search.set("branch", params.branch);
		for (const locale of params.targetLocales) {
			search.append("targetLocale", locale);
		}

		return this.request<TranslationSnapshotResponse>(
			`/api/cli/sync/snapshot?${search.toString()}`,
			{},
			"Failed to fetch translation snapshot",
		);
	}

	/**
	 * Wait for translation to complete with polling
	 */
	async waitForCompletion(
		batchId: string,
		timeout: number = 60000,
		onProgress?: (progress: number) => void,
	): Promise<{
		translations: Record<string, Record<string, string>>;
		localeMetadata?: Record<string, { nativeName: string; dir?: "rtl" }>;
	}> {
		const startTime = Date.now();
		const pollInterval = 1000; // Poll every second

		while (Date.now() - startTime < timeout) {
			const status = await this.getTranslationStatus(batchId);

			// Call progress callback
			if (onProgress) {
				onProgress(status.progress);
			}

			if (status.status === "COMPLETED") {
				if (!status.translations) {
					throw new Error("Translation completed but no translations returned");
				}
				return {
					translations: status.translations,
					localeMetadata: status.localeMetadata,
				};
			}

			if (status.status === "FAILED") {
				throw new Error(
					`Translation failed: ${status.errorMessage || "Unknown error"}`,
				);
			}

			// Wait before polling again
			await new Promise((resolve) => setTimeout(resolve, pollInterval));
		}

		throw new Error(`Translation timeout after ${timeout}ms`);
	}

	async startInitSession(input: {
		projectName?: string;
		sourceLocale?: string;
		targetLocales?: string[];
		repoCanonical?: string;
		repoAppDir?: string;
	}): Promise<InitStartResponse> {
		const response = await fetch(`${this.apiUrl}/api/cli/init/start`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(input),
		});

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to start init session (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		return payload as InitStartResponse;
	}

	async getInitSessionStatus(params: {
		sessionId: string;
		pollToken: string;
	}): Promise<InitStatusResponse> {
		const response = await fetch(
			`${this.apiUrl}/api/cli/init/status/${params.sessionId}`,
			{
				headers: {
					Authorization: `Bearer ${params.pollToken}`,
				},
			},
		);

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to get init status (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		return payload as InitStatusResponse;
	}

	// ── CLI Auth endpoints (no project API key needed) ──────────────────────────

	/**
	 * Start a CLI auth session. Returns `{ sessionId, verificationUrl, expiresAt }`.
	 * `sessionId` is the raw poll token — keep it secret, used for polling.
	 */
	async startCliAuthSession(
		callbackPort?: number,
		repoCanonical?: string,
	): Promise<{
		sessionId: string;
		verificationUrl: string;
		installUrl?: string;
		expiresAt: string;
	}> {
		const response = await fetch(`${this.apiUrl}/api/cli/auth/start`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...(callbackPort != null ? { callbackPort } : {}),
				...(repoCanonical ? { repoCanonical } : {}),
			}),
		});

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to start auth session (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		return payload as {
			sessionId: string;
			verificationUrl: string;
			installUrl?: string;
			expiresAt: string;
		};
	}

	/**
	 * Poll for CLI auth session completion.
	 * Returns `{ token }` on success, throws on failure/expiry.
	 * The server returns HTTP 202 while still pending.
	 */
	async pollCliAuthSession(
		pollToken: string,
	): Promise<
		| { status: "pending" }
		| { status: "complete"; token: string; organizationId?: string }
		| { status: "failed"; reason: string }
	> {
		const response = await fetch(
			`${this.apiUrl}/api/cli/auth/session?session=${encodeURIComponent(pollToken)}`,
		);

		const payload = await readPayload(response);

		if (response.status === 202) {
			return { status: "pending" };
		}

		if (response.status === 410) {
			return {
				status: "failed",
				reason: extractErrorMessage(payload, "Auth session expired or failed"),
			};
		}

		if (!response.ok) {
			return {
				status: "failed",
				reason: extractErrorMessage(
					payload,
					`Auth session error (${response.status})`,
				),
			};
		}

		const result = payload as { token?: string; organizationId?: string };
		if (!result.token) {
			return { status: "failed", reason: "No token in response" };
		}

		return {
			status: "complete",
			token: result.token,
			...(result.organizationId
				? { organizationId: result.organizationId }
				: {}),
		};
	}

	/**
	 * Validate a CLI user token and return the authenticated user's info.
	 * Used by the CLI to verify stored credentials on startup.
	 */
	async getCliUserInfo(userToken: string): Promise<{
		userId: string;
		email: string;
		name: string | null;
	}> {
		const response = await fetch(`${this.apiUrl}/api/cli/auth/me`, {
			headers: { Authorization: `Bearer ${userToken}` },
		});

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Token validation failed (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		return payload as { userId: string; email: string; name: string | null };
	}

	/**
	 * Revoke the given CLI user token server-side.
	 */
	async revokeCliToken(userToken: string): Promise<void> {
		const response = await fetch(`${this.apiUrl}/api/cli/auth/token`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${userToken}` },
		});

		if (!response.ok) {
			const payload = await readPayload(response);
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Token revocation failed (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}
	}

	// ── Workspaces ────────────────────────────────────────────────────────────────

	async listWorkspaces(
		userToken: string,
		params?: { repo?: string },
	): Promise<{
		workspaces: Array<{
			id: string;
			name: string;
			planId: string;
			maxProjects: number;
			projectCount: number;
			hasGitHubConnection: boolean;
			connectionLabel: string | null;
			/** null when no `repo` param was provided */
			coversRepo: boolean | null;
			installationConfigureUrl: string | null;
		}>;
		canCreateWorkspace: boolean;
	}> {
		const url = new URL(`${this.apiUrl}/api/cli/workspaces`);
		if (params?.repo) url.searchParams.set("repo", params.repo);

		const response = await fetch(url.toString(), {
			headers: { Authorization: `Bearer ${userToken}` },
		});

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to list workspaces (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		return payload as {
			workspaces: Array<{
				id: string;
				name: string;
				planId: string;
				maxProjects: number;
				projectCount: number;
				hasGitHubConnection: boolean;
				connectionLabel: string | null;
				coversRepo: boolean | null;
				installationConfigureUrl: string | null;
			}>;
			canCreateWorkspace: boolean;
		};
	}

	async listApps(
		userToken: string,
		organizationId: string,
	): Promise<
		Array<{
			id: string;
			name: string;
			sourceLocale: string;
			targetLocales: string[];
			targetBranches: string[];
		}>
	> {
		const url = new URL(`${this.apiUrl}/api/cli/projects`);
		url.searchParams.set("organizationId", organizationId);

		const response = await fetch(url.toString(), {
			headers: { Authorization: `Bearer ${userToken}` },
		});

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to list projects (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		const result = payload as {
			projects: Array<{
				id: string;
				name: string;
				sourceLocale: string;
				targetLocales: string[];
				targetBranches: string[];
			}>;
		};
		return result.projects;
	}

	async regenerateProjectApiKey(
		userToken: string,
		projectId: string,
	): Promise<{ apiKey: string }> {
		const response = await fetch(
			`${this.apiUrl}/api/cli/project/regenerate-key`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${userToken}`,
				},
				body: JSON.stringify({ projectId }),
			},
		);

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to regenerate API key (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		return payload as { apiKey: string };
	}

	// ── CLI GitHub endpoints ──────────────────────────────────────────────────────

	async startCliGitHubInstall(
		userToken: string,
		params: { organizationId?: string; callbackPort?: number },
	): Promise<{ installUrl: string }> {
		const response = await fetch(
			`${this.apiUrl}/api/cli/github/install/start`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${userToken}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(params),
			},
		);

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to start GitHub install (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		return payload as { installUrl: string };
	}

	/**
	 * Start the "link existing installation" discovery flow.
	 * Unlike startCliGitHubOAuth, this requires no bearer token — the Vocoder
	 * account is created from the OAuth code in the callback.
	 */
	async startCliGitHubLinkSession(
		sessionId: string,
		callbackPort?: number,
	): Promise<{ oauthUrl: string }> {
		const response = await fetch(
			`${this.apiUrl}/api/cli/github/oauth/link-start`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sessionId,
					...(callbackPort != null ? { callbackPort } : {}),
				}),
			},
		);

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to start GitHub link session (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		return payload as { oauthUrl: string };
	}

	async startCliGitHubOAuth(
		userToken: string,
		params: { organizationId?: string; callbackPort?: number },
	): Promise<{ oauthUrl: string }> {
		const response = await fetch(`${this.apiUrl}/api/cli/github/oauth/start`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${userToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(params),
		});

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to start GitHub OAuth (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		return payload as { oauthUrl: string };
	}

	async getCliGitHubDiscovery(userToken: string): Promise<{
		installations: Array<{
			installationId: number;
			accountLogin: string;
			accountType: string;
			isSuspended: boolean;
			conflictLabel: string | null;
		}>;
	}> {
		const response = await fetch(`${this.apiUrl}/api/cli/github/discovery`, {
			headers: { Authorization: `Bearer ${userToken}` },
		});

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to fetch GitHub discovery (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		return payload as {
			installations: Array<{
				installationId: number;
				accountLogin: string;
				accountType: string;
				isSuspended: boolean;
				conflictLabel: string | null;
			}>;
		};
	}

	async claimCliGitHubInstallation(
		userToken: string,
		params: { installationId: string; organizationId: string | null },
	): Promise<{
		organizationId: string;
		organizationName: string;
		connectionLabel: string;
		repoCount: number;
	}> {
		const response = await fetch(`${this.apiUrl}/api/cli/github/claim`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${userToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(params),
		});

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to claim GitHub installation (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		return payload as {
			organizationId: string;
			organizationName: string;
			connectionLabel: string;
			repoCount: number;
		};
	}

	// ── Locales ───────────────────────────────────────────────────────────────────

	/**
	 * Add a target locale to the project.
	 * Idempotent: returns the current list unchanged if the locale is already configured.
	 * Project determined from API key.
	 *
	 * @throws {VocoderAPIError} status 422 for invalid/unsupported locale code
	 * @throws {VocoderAPIError} status 403 with limitError.limitType "target_locales" when plan limit reached
	 */
	async addLocale(
		locale: string,
		repoCanonical?: string,
	): Promise<{ targetLocales: string[] }> {
		return this.request<{ targetLocales: string[] }>(
			"/api/cli/project/locales",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					locale,
					...(repoCanonical ? { repoCanonical } : {}),
				}),
			},
			"Failed to add locale",
		);
	}

	/**
	 * Remove a target locale from the project.
	 * Idempotent: returns the current list unchanged if the locale is not configured.
	 * Project determined from API key.
	 *
	 * @throws {VocoderAPIError} on auth or server errors
	 */
	async removeLocale(
		locale: string,
		repoCanonical?: string,
	): Promise<{ targetLocales: string[] }> {
		return this.request<{ targetLocales: string[] }>(
			"/api/cli/project/locales",
			{
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					locale,
					...(repoCanonical ? { repoCanonical } : {}),
				}),
			},
			"Failed to remove locale",
		);
	}

	async listLocales(userToken: string): Promise<{
		sourceLocales: Array<{ code: string; name: string; nativeName?: string }>;
		targetLocales: Array<{ code: string; name: string; nativeName?: string }>;
	}> {
		const response = await fetch(`${this.apiUrl}/api/cli/locales`, {
			headers: { Authorization: `Bearer ${userToken}` },
		});

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to list locales (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		const result = payload as {
			sourceLocales: Array<{ code: string; name: string; nativeName?: string }>;
			targetLocales: Array<{ code: string; name: string; nativeName?: string }>;
		};
		return result;
	}

	async listCompatibleLocales(
		userToken: string,
		sourceLocale: string,
	): Promise<Array<{ code: string; name: string; nativeName?: string }>> {
		const url = `${this.apiUrl}/api/cli/locales/compatible?source=${encodeURIComponent(sourceLocale)}`;
		const response = await fetch(url, {
			headers: { Authorization: `Bearer ${userToken}` },
		});

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to list compatible locales (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		const result = payload as {
			locales: Array<{ code: string; name: string; nativeName?: string }>;
		};
		return result.locales;
	}

	// ── Project creation ──────────────────────────────────────────────────────────

	async createProject(
		userToken: string,
		params: {
			organizationId: string;
			name: string;
			sourceLocale: string;
			targetLocales: string[];
			targetBranches: string[];
			appDirs: string[];
			repoCanonical?: string;
		},
	): Promise<{
		projectId: string;
		projectName: string;
		apiKey: string;
		sourceLocale: string;
		targetLocales: string[];
		targetBranches: string[];
		repositoryBound: boolean;
		configureUrl?: string;
	}> {
		const response = await fetch(`${this.apiUrl}/api/cli/projects`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${userToken}`,
			},
			body: JSON.stringify(params),
		});

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to create project (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		return payload as {
			projectId: string;
			projectName: string;
			apiKey: string;
			sourceLocale: string;
			targetLocales: string[];
			targetBranches: string[];
			repositoryBound: boolean;
			configureUrl?: string;
		};
	}

	// ── Project lookup ────────────────────────────────────────────────────────────

	/**
	 * Look up all project apps for a given repo. Returns info about exact matches,
	 * existing apps in other scopes, and whether a whole-repo app exists.
	 * No auth required.
	 */
	async lookupAppByRepo(params: {
		repoCanonical: string;
		appDir: string;
	}): Promise<{
		exactMatch: {
			projectId: string;
			projectName: string;
			organizationName: string;
			sourceLocale?: string;
			targetBranches?: string[];
		} | null;
		existingApps: Array<{
			appDir: string;
			projectId: string;
			projectName: string;
			organizationName: string;
		}>;
		hasWholeRepoApp: boolean;
	}> {
		try {
			const response = await fetch(`${this.apiUrl}/api/cli/init/lookup`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					repo: params.repoCanonical,
					appDir: params.appDir,
				}),
			});

			if (!response.ok) {
				return { exactMatch: null, existingApps: [], hasWholeRepoApp: false };
			}

			const data = (await response.json()) as {
				exactMatch?: {
					projectId: string;
					projectName: string;
					organizationName: string;
					sourceLocale?: string;
					targetBranches?: string[];
				} | null;
				existingApps?: Array<{
					appDir: string;
					projectId: string;
					projectName: string;
					organizationName: string;
				}>;
				hasWholeRepoApp?: boolean;
			};
			return {
				exactMatch: data.exactMatch ?? null,
				existingApps: data.existingApps ?? [],
				hasWholeRepoApp: data.hasWholeRepoApp ?? false,
			};
		} catch {
			return { exactMatch: null, existingApps: [], hasWholeRepoApp: false };
		}
	}

	/**
	 * Add a new App to an existing project (monorepo: new app directory).
	 * Does not check plan limits — no new project is created.
	 */
	async createApp(
		userToken: string,
		params: {
			projectId: string;
			appDir: string;
			sourceLocale: string;
			targetLocales: string[];
			targetBranches: string[];
			repoCanonical: string;
		},
	): Promise<{
		appId: string;
		projectId: string;
		projectName: string;
		apiKey: string;
		appDir: string;
	}> {
		const response = await fetch(`${this.apiUrl}/api/cli/project/apps`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${userToken}`,
			},
			body: JSON.stringify(params),
		});

		const payload = await readPayload(response);

		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					`Failed to create app (${response.status})`,
				),
				status: response.status,
				payload,
			});
		}

		return payload as {
			appId: string;
			projectId: string;
			projectName: string;
			apiKey: string;
			appDir: string;
		};
	}
}
