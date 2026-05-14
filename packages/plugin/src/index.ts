import type { VocoderPluginOptions, VocoderTranslationData } from "./types";
import {
	computeFingerprint,
	detectAppDir,
	detectBranch,
	detectCommitSha,
	extractProjectShortIdFromApiKey,
	extractSourceData,
	fetchTranslations,
	loadEnvFile,
	pollCDNForTranslations,
	reportBuildFallback,
	triggerOnDemandSync,
} from "./core";

import { createUnplugin } from "unplugin";
import { transformMsgProps } from "@vocoder/extractor";

export type { VocoderPluginOptions, VocoderTranslationData };
export {
	computeFingerprint,
	detectBranch,
	detectCommitSha,
	detectRepoIdentity,
} from "./core";

// Shared across all compiler instances in the same process (Next.js runs server + client + edge).
// Keyed by cwd + apiUrl so different API endpoints stay isolated.
type InitResult = { fingerprint: string; data: VocoderTranslationData };
const _initCache = new Map<string, Promise<InitResult>>();

function emptyData(): VocoderTranslationData {
	return { config: { sourceLocale: "", targetLocales: [], locales: {} }, translations: {}, updatedAt: null };
}

export const unplugin = createUnplugin(
	(options: VocoderPluginOptions | undefined = {}) => {
		// Load .env before reading env vars — build plugins run before bundler's own .env loading
		loadEnvFile();

		const apiUrl = process.env.VOCODER_API_URL ?? "https://vocoder.app";
		const cdnUrl = process.env.VOCODER_CDN_URL ?? "https://t.vocoder.app";
		const cacheKey = [process.cwd(), apiUrl].join("|");

		let fingerprint: string;
		let data: VocoderTranslationData | null = null;

		async function init(): Promise<void> {
			if (!_initCache.has(cacheKey)) {
				_initCache.set(cacheKey, runInit());
			}
			const result = await _initCache.get(cacheKey)!;
			fingerprint = result.fingerprint;
			data = result.data;
		}

		async function runInit(): Promise<InitResult> {
			const verbose = options.verbose ?? false;
			const isDev =
				process.env.NODE_ENV === "development" ||
				process.env.VOCODER_DEV === "1";

			// VOCODER_FINGERPRINT: manual escape hatch for unusual environments.
			if (process.env.VOCODER_FINGERPRINT) {
				const fp = process.env.VOCODER_FINGERPRINT;
				console.log(`[vocoder] Using fingerprint from VOCODER_FINGERPRINT env var → ${fp}`);
				const d = await fetchTranslations(fp, apiUrl);
				return { fingerprint: fp, data: d };
			}

			const apiKey = options.apiKey ?? process.env.VOCODER_API_KEY ?? "";
			const projectShortId = extractProjectShortIdFromApiKey(apiKey);

			if (!projectShortId) {
				console.warn(
					"[vocoder] VOCODER_API_KEY missing or not a project key (vcp_...). Translations not loaded.",
				);
				return { fingerprint: "", data: emptyData() };
			}

			if (verbose) {
				console.log(`[vocoder] Reading vocoder.config.{ts,js,json} for extraction patterns…`);
			}

			const extractStart = Date.now();
			const appDir = detectAppDir(process.cwd());
			const { keys: sourceKeys, entries: sourceEntries } = await extractSourceData(process.cwd());

			if (verbose) {
				console.log(
					`[vocoder] Extraction: ${sourceKeys.length} string(s) in ${Date.now() - extractStart}ms`,
				);
				if (appDir) console.log(`[vocoder] App directory: ${appDir}`);
			}

			// Fingerprint = hash(projectShortId + ":" + appDir + ":" + sortedKeys)
			// Matches server computeBundleFingerprint — monorepo-safe, content-addressed.
			const branch = detectBranch();
			const scope = `${projectShortId}:${appDir}`;
			const fp = computeFingerprint(scope, sourceKeys);
			console.log(`[vocoder] ${sourceKeys.length} string(s) → fingerprint ${fp}`);

			if (verbose) {
				console.log(`[vocoder] Fetching: ${apiUrl}/api/t/${fp}`);
			}

			const fetchStart = Date.now();

			let d: VocoderTranslationData | null = null;
			let fellBackToRuntime = false;
			if (cdnUrl) {
				if (verbose) {
					console.log(`[vocoder] Polling CDN: ${cdnUrl}/${projectShortId}/${fp}/bundle.json`);
				}
				d = await pollCDNForTranslations(fp, cdnUrl, projectShortId);
				if (d && verbose) {
					console.log(`[vocoder] CDN hit: ${Date.now() - fetchStart}ms`);
				} else if (!d && verbose) {
					console.log(`[vocoder] CDN polling timed out — falling back to API`);
				}
			}
			if (!d) {
				d = await fetchTranslations(fp, apiUrl);
			}

			if (!isDev && d && !d.config.sourceLocale) {
				fellBackToRuntime = true;
				const reason = "No translations available after CDN polling and API fallback";
				console.warn(`[vocoder] WARNING: ${reason}. Translations will be fetched from CDN at runtime.`);
				console.warn(`[vocoder] Fingerprint: ${fp} — check your Vocoder dashboard if this persists.`);
				void reportBuildFallback({ apiUrl, apiKey, fingerprint: fp, reason, sourceEntriesCount: sourceKeys.length });
			}

			if (verbose) {
				console.log(`[vocoder] Fetch: ${Date.now() - fetchStart}ms`);
			}

			// Dev mode: if no bundle exists yet, trigger a translate job so the developer
			// sees translated UI on first run rather than raw source strings.
			const hasTranslations = d.config.sourceLocale !== "";
			if (isDev && !hasTranslations && fp && sourceKeys.length > 0) {
				const synced = await triggerOnDemandSync({
					fingerprint: fp,
					branch,
					appDir,
					apiUrl,
					apiKey,
					cdnUrl,
					projectShortId,
					sourceEntries,
				});
				if (synced) d = synced;
			}

			if (d.config.sourceLocale) {
				const localeCount = d.config.targetLocales.length;
				const stringCount = (Object.values(d.translations) as Record<string, string>[]).reduce(
					(sum, t) => sum + Object.keys(t).length,
					0,
				);
				console.log(`[vocoder] Loaded ${localeCount} locale(s), ${stringCount} translation(s)`);
			} else {
				console.log("[vocoder] No translations available yet — source text will be shown.");
			}

			return { fingerprint: fp, data: d };
		}

		function getDefineValues(): Record<string, string> {
			return {
				__VOCODER_FINGERPRINT__: JSON.stringify(fingerprint ?? ""),
				__VOCODER_API_URL__: JSON.stringify(apiUrl),
				__VOCODER_CDN_URL__: JSON.stringify(cdnUrl ?? ""),
				__VOCODER_BUILD_TS__: JSON.stringify(Date.now()),
				__VOCODER_PREVIEW__: JSON.stringify(options?.preview ?? false),
				// Inline the full translation bundle so the client is self-contained.
				// No runtime fetch, no per-locale code splitting — accepted tradeoff for simplicity.
				__VOCODER_BUNDLE__: JSON.stringify(data ?? null),
			};
		}

		return {
			name: "vocoder",
			enforce: "pre" as const,

			async buildStart() {
				await init();
			},

			// Transform <T> JSX elements with dynamic identifier children to inject
			// the message prop at build time, enabling the natural authoring syntax:
			//   <T count={count}>You have {count} items</T>
			transformInclude(id: string) {
				return /\.[jt]sx?$/.test(id) && !id.includes("node_modules");
			},

			transform(code: string) {
				if (!code.includes("@vocoder/react")) return null;
				try {
					const result = transformMsgProps(code);
					return result.changed ? { code: result.code } : null;
				} catch {
					return null;
				}
			},

			vite: {
				async config() {
					await init();
					return { define: getDefineValues() };
				},
			},

			webpack(compiler) {
				try {
					const wp = require("webpack");
					new wp.DefinePlugin(getDefineValues()).apply(compiler);
				} catch {
					// Not in a webpack environment — skip
				}
			},
		};
	},
);

export default unplugin;
