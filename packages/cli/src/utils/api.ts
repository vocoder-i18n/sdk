import { createHash } from "node:crypto";
import type {
	APIAppConfig,
	InitStartResponse,
	InitStatusResponse,
	LimitErrorResponse,
	LocalConfig,
	SyncPolicyErrorResponse,
	TranslateRequestBody,
	TranslateStatusResponse,
	TranslationSnapshotResponse,
} from "../types.js";

type StringsHashInput = {
	keys: string[];
	industry?: string | null;
};

/**
 * Mirrors computeStringsHash in vocoder-app/lib/sync/strings-hash.ts.
 * Both must use the identical type shape and serialization — if you change one, change the other.
 * Uses source keys (not source texts) so that strings with the same text but different
 * formality/context produce different hashes and don't incorrectly short-circuit the pipeline.
 */
export function computeStringsHash(input: StringsHashInput): string {
	const sorted = [...input.keys].sort();
	return createHash("sha256")
		.update(JSON.stringify({ strings: sorted, industry: input.industry ?? null }))
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

function parsePayload(raw: string, context?: { url: string; status: number }): unknown {
	if (raw.length === 0) {
		return null;
	}

	// HTML responses (e.g. Next.js error pages) are never valid API payloads.
	// Wrapping raw HTML as the error message causes it to leak into the TUI.
	const trimmed = raw.trimStart();
	if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) {
		const detail = context ? ` [${context.status} from ${context.url}]` : "";
		return {
			message: `Unexpected response from server (received HTML)${detail}. Check your network connection or try again.`,
		};
	}

	try {
		return JSON.parse(raw);
	} catch {
		return { message: raw };
	}
}

async function readPayload(
	response: { text?: () => Promise<string>; json?: () => Promise<unknown> },
	context?: { url: string; status: number },
	debug = false,
): Promise<unknown> {
	if (typeof response.text === "function") {
		const raw = await response.text();
		if (debug && context && context.status >= 400 && raw.length > 0) {
			const preview = raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
			process.stderr.write(`[vocoder] ↳ ${preview}\n`);
		}
		return parsePayload(raw, context);
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
	private debug: boolean;

	constructor(config: LocalConfig & { debug?: boolean }) {
		this.apiUrl = config.apiUrl;
		this.apiKey = config.apiKey;
		this.debug = config.debug ?? false;
	}

	private log(method: string, url: string, status?: number): void {
		if (!this.debug) return;
		const statusPart = status != null ? ` → ${status}` : "";
		process.stderr.write(`[vocoder] ${method} ${url}${statusPart}\n`);
	}

	private async fetchRaw(url: string, init: RequestInit = {}): Promise<Response> {
		this.log(init.method ?? "GET", url);
		const response = await fetch(url, init);
		this.log(init.method ?? "GET", url, response.status);
		return response;
	}

	private async userRequest<T>(
		userToken: string,
		url: string,
		init: RequestInit = {},
		errorMessage?: string,
	): Promise<T> {
		const response = await this.fetchRaw(url, {
			...init,
			headers: {
				Authorization: `Bearer ${userToken}`,
				...(init.headers as Record<string, string> | undefined ?? {}),
			},
		});
		const payload = await readPayload(response, { url, status: response.status }, this.debug);
		if (!response.ok) {
			throw new VocoderAPIError({
				message: extractErrorMessage(
					payload,
					errorMessage ?? `Request failed with status ${response.status}`,
				),
				status: response.status,
				payload,
			});
		}
		return payload as T;
	}

	private async request<T>(
		path: string,
		init: RequestInit = {},
		errorPrefix?: string,
	): Promise<T> {
		const url = `${this.apiUrl}${path}`;
		this.log(init.method ?? "GET", url);

		const response = await fetch(url, {
			...init,
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				...(init.headers ?? {}),
			},
		});

		this.log(init.method ?? "GET", url, response.status);

		const payload = await readPayload(response, { url, status: response.status }, this.debug);

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

	async submitTranslate(
		body: TranslateRequestBody,
	): Promise<{ jobId: string; status?: "complete"; fingerprint?: string }> {
		return this.request<{ jobId: string; status?: "complete"; fingerprint?: string }>(
			"/api/cli/translate",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Translation submission failed",
		);
	}

	async pollTranslateStatus(jobId: string): Promise<TranslateStatusResponse> {
		return this.request<TranslateStatusResponse>(
			`/api/cli/translate/${encodeURIComponent(jobId)}/status`,
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

	async startInitSession(input: {
		projectName?: string;
		sourceLocale?: string;
		targetLocales?: string[];
		repoCanonical?: string;
		repoAppDir?: string;
	}): Promise<InitStartResponse> {
		const url = `${this.apiUrl}/api/cli/init/start`;
		const response = await this.fetchRaw(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(input),
		});

		const payload = await readPayload(response, { url, status: response.status }, this.debug);

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
		const url = `${this.apiUrl}/api/cli/init/status/${params.sessionId}`;
		const response = await this.fetchRaw(url, {
			headers: { Authorization: `Bearer ${params.pollToken}` },
		});

		const payload = await readPayload(response, { url, status: response.status }, this.debug);

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
		expiresAt: string;
	}> {
		const url = `${this.apiUrl}/api/cli/auth/start`;
		const response = await this.fetchRaw(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...(callbackPort != null ? { callbackPort } : {}),
				...(repoCanonical ? { repoCanonical } : {}),
			}),
		});

		const payload = await readPayload(response, { url, status: response.status }, this.debug);

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
		const url = `${this.apiUrl}/api/cli/auth/session?session=${encodeURIComponent(pollToken)}`;
		const response = await this.fetchRaw(url);

		const payload = await readPayload(response, { url, status: response.status }, this.debug);

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
		return this.userRequest<{ userId: string; email: string; name: string | null }>(
			userToken,
			`${this.apiUrl}/api/cli/auth/me`,
			{},
			`Token validation failed`,
		);
	}

	/**
	 * Revoke the given CLI user token server-side.
	 */
	async revokeCliToken(userToken: string): Promise<void> {
		await this.userRequest<unknown>(
			userToken,
			`${this.apiUrl}/api/cli/auth/token`,
			{ method: "DELETE" },
			`Token revocation failed`,
		);
	}

	// ── Organizations ─────────────────────────────────────────────────────────────

	async listOrganizations(
		userToken: string,
		params?: { repo?: string },
	): Promise<{
		organizations: Array<{
			id: string;
			name: string;
			planId: string;
			/** Plan limit on total apps across all projects (-1 = unlimited). */
			maxApps: number;
			/** Current total app count across all projects in this organization. */
			appCount: number;
			hasGitHubConnection: boolean;
			connectionLabel: string | null;
			/** null when no `repo` param was provided */
			coversRepo: boolean | null;
			installationConfigureUrl: string | null;
		}>;
		canCreateOrganization: boolean;
	}> {
		const url = new URL(`${this.apiUrl}/api/cli/organizations`);
		if (params?.repo) url.searchParams.set("repo", params.repo);
		return this.userRequest<{
			organizations: Array<{
				id: string;
				name: string;
				planId: string;
				maxApps: number;
				appCount: number;
				hasGitHubConnection: boolean;
				connectionLabel: string | null;
				coversRepo: boolean | null;
				installationConfigureUrl: string | null;
			}>;
			canCreateOrganization: boolean;
		}>(userToken, url.toString(), {}, "Failed to list organizations");
	}

	async listApps(
		userToken: string,
		organizationId: string,
	): Promise<
		Array<{
			appId: string;
			projectId: string;
			name: string;
			appDir: string;
			sourceLocale: string;
			targetLocales: string[];
			targetBranches: string[];
		}>
	> {
		const url = new URL(`${this.apiUrl}/api/cli/apps`);
		url.searchParams.set("organizationId", organizationId);
		const result = await this.userRequest<{
			apps: Array<{
				appId: string;
				projectId: string;
				name: string;
				appDir: string;
				sourceLocale: string;
				targetLocales: string[];
				targetBranches: string[];
			}>;
		}>(userToken, url.toString(), {}, "Failed to list apps");
		return result.apps;
	}

	async regenerateProjectApiKey(
		userToken: string,
		projectId: string,
	): Promise<{ apiKey: string }> {
		return this.userRequest<{ apiKey: string }>(
			userToken,
			`${this.apiUrl}/api/cli/project/regenerate-key`,
			{ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) },
			"Failed to regenerate API key",
		);
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
		appId?: string,
	): Promise<{ targetLocales: string[] }> {
		return this.request<{ targetLocales: string[] }>(
			"/api/cli/app/locales",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					locale,
					...(repoCanonical ? { repoCanonical } : {}),
					...(appId ? { appId } : {}),
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
		appId?: string,
	): Promise<{ targetLocales: string[] }> {
		return this.request<{ targetLocales: string[] }>(
			"/api/cli/app/locales",
			{
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					locale,
					...(repoCanonical ? { repoCanonical } : {}),
					...(appId ? { appId } : {}),
				}),
			},
			"Failed to remove locale",
		);
	}

	async listLocales(userToken: string): Promise<{
		sourceLocales: Array<{ code: string; name: string; nativeName?: string }>;
		targetLocales: Array<{ code: string; name: string; nativeName?: string }>;
	}> {
		return this.userRequest<{
			sourceLocales: Array<{ code: string; name: string; nativeName?: string }>;
			targetLocales: Array<{ code: string; name: string; nativeName?: string }>;
		}>(userToken, `${this.apiUrl}/api/cli/locales`, {}, "Failed to list locales");
	}

	async listCompatibleLocales(
		userToken: string,
		sourceLocale: string,
	): Promise<Array<{ code: string; name: string; nativeName?: string }>> {
		const url = `${this.apiUrl}/api/cli/locales/compatible?source=${encodeURIComponent(sourceLocale)}`;
		const result = await this.userRequest<{
			locales: Array<{ code: string; name: string; nativeName?: string }>;
		}>(userToken, url, {}, "Failed to list compatible locales");
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
		apps: Array<{ appDir: string; appId: string }>;
	}> {
		return this.userRequest<{
			projectId: string;
			projectName: string;
			apiKey: string;
			sourceLocale: string;
			targetLocales: string[];
			targetBranches: string[];
			repositoryBound: boolean;
			configureUrl?: string;
			apps: Array<{ appDir: string; appId: string }>;
		}>(
			userToken,
			`${this.apiUrl}/api/cli/apps`,
			{ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) },
			"Failed to create project",
		);
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
			appId: string;
			projectId: string;
			projectName: string;
			organizationName: string;
			sourceLocale?: string;
			targetBranches?: string[];
		} | null;
		existingApps: Array<{
			appDir: string;
			/** Unique identifier for this app — written to vocoder.config.ts. */
			appId: string;
			projectId: string;
			projectName: string;
			organizationName: string;
		}>;
		hasWholeRepoApp: boolean;
		/** Present when this repo is linked to a Vocoder organization (with or without a project). */
		organizationContext: { organizationId: string; organizationName: string } | null;
	}> {
		try {
			const url = `${this.apiUrl}/api/cli/init/lookup`;
			const response = await this.fetchRaw(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					repo: params.repoCanonical,
					appDir: params.appDir,
				}),
			});

			if (!response.ok) {
				return { exactMatch: null, existingApps: [], hasWholeRepoApp: false, organizationContext: null };
			}

			const data = (await response.json()) as {
				exactMatch?: {
					appId: string;
					projectId: string;
					projectName: string;
					organizationName: string;
					sourceLocale?: string;
					targetBranches?: string[];
				} | null;
				existingApps?: Array<{
					appDir: string;
					appId: string;
					projectId: string;
					projectName: string;
					organizationName: string;
				}>;
				hasWholeRepoApp?: boolean;
				organizationContext?: { organizationId: string; organizationName: string } | null;
			};
			return {
				exactMatch: data.exactMatch ?? null,
				existingApps: data.existingApps ?? [],
				hasWholeRepoApp: data.hasWholeRepoApp ?? false,
				organizationContext: data.organizationContext ?? null,
			};
		} catch {
			return { exactMatch: null, existingApps: [], hasWholeRepoApp: false, organizationContext: null };
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
		appDir: string;
	}> {
		return this.userRequest<{
			appId: string;
			projectId: string;
			projectName: string;
			appDir: string;
		}>(
			userToken,
			`${this.apiUrl}/api/cli/apps`,
			{ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) },
			"Failed to create app",
		);
	}
}
