/**
 * Background CDN refresh for live translation updates.
 *
 * Reads build-time constants optionally injected by @vocoder/plugin:
 * - __VOCODER_CDN_URL__  (defaults to https://t.vocoder.app)
 * - __VOCODER_API_URL__  (defaults to https://vocoder.app)
 * - __VOCODER_BUILD_TS__ (used for If-Modified-Since conditional requests)
 *
 * Fingerprint is NOT a build-time constant — it comes from manifest.fingerprint
 * at runtime. Its presence signals the org is on a plan that includes live
 * translation updates (Pro+). When absent, refresh is silently disabled.
 *
 * Delivery strategy:
 *   1. Fetch directly from CDN: {cdnUrl}/{fingerprint}/{locale}.json with
 *      If-Modified-Since so Cloudflare R2 can return 304 when unchanged.
 *   2. Fall back to the Vocoder API (/api/t/:fingerprint/:locale) if CDN fails.
 */

declare const __VOCODER_CDN_URL__: string | undefined;
declare const __VOCODER_API_URL__: string | undefined;
declare const __VOCODER_BUILD_TS__: number | undefined;
declare const __VOCODER_PROJECT_SHORT_ID__: string | undefined;

// Fall back to process.env.* for Next.js Turbopack which doesn't apply DefinePlugin.
// Use || null so empty string (DefinePlugin default before buildStart) falls through.
const cdnUrl: string | null =
	(typeof __VOCODER_CDN_URL__ !== "undefined"
		? __VOCODER_CDN_URL__ || null
		: null) ??
	(typeof process !== "undefined" ? process.env.VOCODER_CDN_URL || null : null) ??
	"https://t.vocoder.app";

const apiUrl: string | null =
	(typeof __VOCODER_API_URL__ !== "undefined"
		? __VOCODER_API_URL__ || null
		: null) ??
	(typeof process !== "undefined" ? process.env.VOCODER_API_URL || null : null) ??
	"https://vocoder.app";

const buildTs: number | null =
	(typeof __VOCODER_BUILD_TS__ !== "undefined"
		? __VOCODER_BUILD_TS__ || null
		: null) ??
	(typeof process !== "undefined" && process.env.VOCODER_BUILD_TS
		? Number(process.env.VOCODER_BUILD_TS)
		: null);

const projectShortId: string | null =
	(typeof __VOCODER_PROJECT_SHORT_ID__ !== "undefined"
		? __VOCODER_PROJECT_SHORT_ID__ || null
		: null) ??
	(typeof process !== "undefined" ? process.env.VOCODER_PROJECT_SHORT_ID || null : null);

// Caches keyed by `${fingerprint}:${locale}` to avoid stale hits across builds.
const refreshCache = new Map<string, Record<string, string>>();
const checkedLocales = new Set<string>(); // confirmed up-to-date (304)
const inflightRequests = new Map<string, Promise<Record<string, string> | null>>();

/** @internal For testing only. Resets all in-memory caches. */
export function _resetCachesForTesting(): void {
	refreshCache.clear();
	checkedLocales.clear();
	inflightRequests.clear();
}

function cacheKey(fingerprint: string, locale: string): string {
	return `${fingerprint}:${locale}`;
}

/**
 * Returns true when a fingerprint and project short ID are present and at least
 * one delivery URL is configured. Both are required to construct the bundle path.
 */
export function isRefreshAvailable(fingerprint: string | undefined): boolean {
	return Boolean(fingerprint) && Boolean(projectShortId) && (cdnUrl !== null || apiUrl !== null);
}

/**
 * Check for updated translations for a specific locale.
 * Returns fresh translations if newer than build time, or null if unchanged.
 * Client-only — returns null immediately in SSR (typeof window === "undefined").
 *
 * Deduplicates concurrent calls via inflightRequests and caches results so only
 * one network request is made per fingerprint+locale per browser session.
 */
export async function checkForUpdates(
	locale: string,
	fingerprint: string,
): Promise<Record<string, string> | null> {
	if (!isRefreshAvailable(fingerprint) || typeof window === "undefined")
		return null;

	const key = cacheKey(fingerprint, locale);

	if (refreshCache.has(key)) return refreshCache.get(key) ?? null;
	if (checkedLocales.has(key)) return null;

	const inflight = inflightRequests.get(key);
	if (inflight) return inflight;

	const promise = (async () => {
		try {
			if (cdnUrl) {
				const result = await fetchFromCDN(locale, fingerprint, key);
				if (result !== undefined) return result;
			}
			return await fetchFromAPI(locale, fingerprint, key);
		} finally {
			inflightRequests.delete(key);
		}
	})();

	inflightRequests.set(key, promise);
	return promise;
}

async function fetchFromCDN(
	locale: string,
	fingerprint: string,
	key: string,
): Promise<Record<string, string> | null | undefined> {
	if (!cdnUrl) return undefined;

	try {
		const url = `${cdnUrl}/${projectShortId}/${fingerprint}/${locale}.json`;
		const headers: Record<string, string> = { Accept: "application/json" };

		if (buildTs) {
			headers["If-Modified-Since"] = new Date(buildTs).toUTCString();
		}

		const response = await fetch(url, { headers });

		if (response.status === 304) {
			checkedLocales.add(key);
			return null;
		}
		if (response.status === 404) return undefined; // fall back to API
		if (!response.ok) return undefined; // fall back to API

		const translations = (await response.json()) as Record<string, string>;
		refreshCache.set(key, translations);
		return translations;
	} catch {
		return undefined; // fall back to API
	}
}

async function fetchFromAPI(
	locale: string,
	fingerprint: string,
	key: string,
): Promise<Record<string, string> | null> {
	if (!apiUrl) return null;

	try {
		const sinceParam = buildTs ? `?since=${buildTs}` : "";
		const url = `${apiUrl}/api/t/${fingerprint}/${locale}${sinceParam}`;

		const response = await fetch(url, {
			headers: { Accept: "application/json" },
		});

		if (response.status === 304) {
			checkedLocales.add(key);
			return null;
		}
		if (!response.ok) return null;

		const translations = (await response.json()) as Record<string, string>;
		refreshCache.set(key, translations);
		return translations;
	} catch {
		return null;
	}
}
