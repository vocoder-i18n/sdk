import type {
	APIAppConfig,
	TranslationBatchResponse,
	TranslationSnapshotResponse,
	TranslationStatusResponse,
} from "@vocoder/cli/lib";

export const NO_API_KEY_MESSAGE =
	"VOCODER_API_KEY is not set. Run `npx @vocoder/cli init` to get an API key, then add it to your MCP server config as VOCODER_API_KEY.";

export interface SyncBody {
	branch: string;
	commitSha?: string;
	stringEntries: Array<{
		key: string;
		text: string;
		context?: string;
		formality?: string;
		uiRole?: string;
	}>;
	targetLocales: string[];
	repoCanonical?: string;
	repoAppDir?: string;
	requestedMode?: "auto" | "required" | "best-effort";
	// sha256 of sorted string keys — server uses for fast UP_TO_DATE detection
	stringsHash?: string;
	force?: boolean;
	requestedMaxWaitMs?: number;
	clientRunId?: string;
	appIndustry?: string;
}

export class VocoderClient {
	constructor(
		private readonly apiKey: string,
		private readonly apiUrl: string,
	) {}

	private headers(): Record<string, string> {
		return {
			Authorization: `Bearer ${this.apiKey}`,
			"Content-Type": "application/json",
			Accept: "application/json",
		};
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown,
	): Promise<T> {
		const response = await fetch(`${this.apiUrl}${path}`, {
			method,
			headers: this.headers(),
			body: body !== undefined ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(30000),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => response.statusText);

			// Surface plan limit errors with the upgrade URL
			if (response.status === 403) {
				let payload: unknown;
				try { payload = JSON.parse(text); } catch { /* not JSON */ }
				if (
					typeof payload === "object" && payload !== null &&
					(payload as Record<string, unknown>).errorCode === "LIMIT_EXCEEDED"
				) {
					const err = payload as { message?: string; upgradeUrl?: string };
					const msg = err.message ?? "Plan limit reached.";
					const upgradeUrl = err.upgradeUrl ?? "https://vocoder.app/settings/billing";
					throw new Error(`${msg} Upgrade your plan: ${upgradeUrl}`);
				}
			}

			throw new Error(`Vocoder API error ${response.status}: ${text}`);
		}

		return response.json() as Promise<T>;
	}

	async getConfig(repoCanonical?: string): Promise<APIAppConfig> {
		const params = repoCanonical
			? `?repoCanonical=${encodeURIComponent(repoCanonical)}`
			: "";
		return this.request<APIAppConfig>("GET", `/api/cli/config${params}`);
	}

	async sync(body: SyncBody): Promise<TranslationBatchResponse> {
		return this.request<TranslationBatchResponse>(
			"POST",
			"/api/cli/sync",
			body,
		);
	}

	async getSyncStatus(batchId: string): Promise<TranslationStatusResponse> {
		return this.request<TranslationStatusResponse>(
			"GET",
			`/api/cli/sync/status/${batchId}`,
		);
	}

	// Matches CLI behavior: each locale is a separate targetLocale param.
	// Pass locales=[] to fetch all configured locales.
	async getSnapshot(
		branch: string,
		locales: string[],
		repoCanonical?: string,
	): Promise<TranslationSnapshotResponse> {
		const params = new URLSearchParams({ branch });
		for (const locale of locales) {
			params.append("targetLocale", locale);
		}
		if (repoCanonical) params.set("repoCanonical", repoCanonical);
		return this.request<TranslationSnapshotResponse>(
			"GET",
			`/api/cli/sync/snapshot?${params}`,
		);
	}

	/**
	 * Add a target locale to the project.
	 * Idempotent: returns the current list unchanged if the locale is already configured.
	 *
	 * @throws On invalid BCP 47 code, unsupported locale, or plan limit exceeded (status 403).
	 */
	async addLocale(
		locale: string,
		repoCanonical?: string,
	): Promise<{ targetLocales: string[] }> {
		return this.request<{ targetLocales: string[] }>(
			"POST",
			"/api/cli/app/locales",
			{ locale, repoCanonical },
		);
	}

	/**
	 * Remove a target locale from the project.
	 * Idempotent: returns the current list unchanged if the locale is not configured.
	 *
	 * @throws On auth or server errors.
	 */
	async removeLocale(
		locale: string,
		repoCanonical?: string,
	): Promise<{ targetLocales: string[] }> {
		return this.request<{ targetLocales: string[] }>(
			"DELETE",
			"/api/cli/app/locales",
			{ locale, repoCanonical },
		);
	}

	async listLocales(): Promise<{
		locales: Array<{ code: string; name: string; nativeName?: string }>;
	}> {
		const result = await this.request<{
			sourceLocales: Array<{ code: string; name: string; nativeName?: string }>;
			targetLocales: Array<{ code: string; name: string; nativeName?: string }>;
		}>("GET", "/api/cli/locales");
		return { locales: result.targetLocales };
	}
}

export function createClient(): VocoderClient | null {
	const apiKey = process.env.VOCODER_API_KEY;
	if (!apiKey) return null;
	const apiUrl = process.env.VOCODER_API_URL || "https://vocoder.app";
	return new VocoderClient(apiKey, apiUrl);
}
