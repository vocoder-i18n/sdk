import type { VocoderPluginOptions, VocoderTranslationData } from "./types";
import {
	computeFingerprint,
	detectBranch,
	detectCommitSha,
	extractSourceKeys,
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

const VIRTUAL_PREFIX = "virtual:vocoder/";
const STRIPPED_PREFIX = "vocoder/";
const RESOLVED_PREFIX = "\0virtual:vocoder/";

// Shared across all compiler instances in the same process (Next.js runs server + client + edge).
// Keyed by cwd + apiUrl so different API endpoints stay isolated.
type InitResult = { fingerprint: string; data: VocoderTranslationData };
const _initCache = new Map<string, Promise<InitResult>>();

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
			// True when running under a dev server (not a production build).
			// Used to gate sync-on-startup: we only seed translations in dev mode
			// so production builds are never delayed by a translation job.
			const isDev =
				process.env.NODE_ENV === "development" ||
				process.env.VOCODER_DEV === "1";

			// VOCODER_FINGERPRINT: manual escape hatch for unusual environments.
			if (process.env.VOCODER_FINGERPRINT) {
				const fp = process.env.VOCODER_FINGERPRINT;
				console.log(
					`[vocoder] Using fingerprint from VOCODER_FINGERPRINT env var → ${fp}`,
				);
				const d = await fetchTranslations(fp, apiUrl);
				return { fingerprint: fp, data: d };
			}

			const apiKey = process.env.VOCODER_API_KEY ?? "";
			const shortCode = apiKey.startsWith("vca_")
				? apiKey.slice(4, 14)
				: null;

			if (!shortCode) {
				console.warn(
					"[vocoder] VOCODER_API_KEY missing or not an app key (vca_...). Translations not loaded.",
				);
				return {
					fingerprint: "",
					data: {
						config: { sourceLocale: "", targetLocales: [], locales: {} },
						translations: {},
						updatedAt: null,
					},
				};
			}

			if (verbose) {
				console.log(`[vocoder] Reading vocoder.config.{ts,js,json} for extraction patterns…`);
			}

			const extractStart = Date.now();
			const sourceKeys = await extractSourceKeys(process.cwd());
			if (verbose) {
				console.log(
					`[vocoder] Extraction: ${sourceKeys.length} string(s) in ${Date.now() - extractStart}ms`,
				);
			}

			// Compute fingerprint fully offline — appShortCode is embedded in the vca_ key.
			// No network call needed; formula matches server computeBranchFingerprint().
			const branch = detectBranch();
			const fp = computeFingerprint(shortCode, sourceKeys);
			console.log(`[vocoder] ${sourceKeys.length} string(s) → fingerprint ${fp}`);

			if (verbose) {
				console.log(`[vocoder] Fetching: ${apiUrl}/api/t/${fp}`);
			}

			const fetchStart = Date.now();

			// Poll CDN first — a 200 response guarantees the translation batch is fully
			// complete (the CDN is only populated after compileTranslationBundleForApp).
			// Falls back to the API which has its own server-side wait logic.
			let d: VocoderTranslationData | null = null;
			let fellBackToRuntime = false;
			if (cdnUrl) {
				if (verbose) {
					console.log(`[vocoder] Polling CDN: ${cdnUrl}/${fp}/bundle.json`);
				}
				d = await pollCDNForTranslations(fp, cdnUrl);
				if (d && verbose) {
					console.log(`[vocoder] CDN hit: ${Date.now() - fetchStart}ms`);
				} else if (!d && verbose) {
					console.log(`[vocoder] CDN polling timed out — falling back to API`);
				}
			}
			if (!d) {
				d = await fetchTranslations(fp, apiUrl);
			}

			// If we still have no translations, the build will ship without baked
			// translations and fall back to runtime CDN fetching. Log clearly and
			// report to Vocoder so it surfaces in operator alerting.
			if (!isDev && d && !d.config.sourceLocale) {
				fellBackToRuntime = true;
				const reason = "No translations available after CDN polling and API fallback";
				console.warn(`[vocoder] WARNING: ${reason}. Translations will be fetched from CDN at runtime.`);
				console.warn(`[vocoder] Fingerprint: ${fp} — check your Vocoder dashboard if this persists.`);
				void reportBuildFallback({ apiUrl, apiKey, fingerprint: fp, reason, stringsCount: sourceKeys.length });
			}

			if (verbose) {
				console.log(`[vocoder] Fetch: ${Date.now() - fetchStart}ms`);
			}

			// ── Sync-on-startup ──────────────────────────────────────────────────────────────────
			// If we're in dev mode and fetched empty translations (no bundle exists
			// yet for this fingerprint), trigger a sync now so the developer sees
			// translated UI on first run rather than raw source strings.
			const hasTranslations = d.config.sourceLocale !== "";
			if (isDev && !hasTranslations && fp && sourceKeys.length > 0) {
				const synced = await triggerOnDemandSync({
					fingerprint: fp,
					branch,
					apiUrl,
					apiKey,
					cdnUrl,
				});
				if (synced) d = synced;
			}

			if (d.config.sourceLocale) {
				const localeCount = d.config.targetLocales.length;
				const stringCount = (Object.values(d.translations) as Record<string, string>[]).reduce(
					(sum, t) => sum + Object.keys(t).length,
					0,
				);
				console.log(
					`[vocoder] Loaded ${localeCount} locale(s), ${stringCount} translation(s)`,
				);
			} else {
				console.log(
					"[vocoder] No translations available yet — source text will be shown.",
				);
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
			//
			// Framework expansion notes — add branches here as SDKs are built:
			//   Vue (.vue):    transformVueT(code) — needs @vue/compiler-sfc,
			//                  converts {{ count }} → {count} in extracted template
			//   Svelte (.svelte): transformSvelteT(code) — needs svelte/compiler,
			//                  same {count} syntax as JSX so simpler extraction
			//   Solid (.jsx/.tsx): same Babel parser, different import (@vocoder/solid)
			// All frameworks use the same message+values convention so extraction
			// and runtime lookup are identical regardless of framework.
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

			resolveId(id: string) {
				if (id.startsWith(VIRTUAL_PREFIX)) {
					return RESOLVED_PREFIX + id.slice(VIRTUAL_PREFIX.length);
				}
				if (id.startsWith(STRIPPED_PREFIX)) {
					return RESOLVED_PREFIX + id.slice(STRIPPED_PREFIX.length);
				}
				return null;
			},

			async load(id: string) {
				if (!id.startsWith(RESOLVED_PREFIX)) return null;

				await init();
				if (!data) return null;

				const path = id.slice(RESOLVED_PREFIX.length);

				if (path === "manifest") {
					return generateManifestModule(data);
				}

				if (path.startsWith("translations/")) {
					const locale = path.slice("translations/".length);
					const translations = data.translations[locale] ?? {};
					return `export default ${JSON.stringify(translations)};`;
				}

				return null;
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

function generateManifestModule(data: VocoderTranslationData): string {
	const { config, translations } = data;

	const loaderEntries = Object.keys(translations)
		.map(
			(locale: string) =>
				`  ${JSON.stringify(locale)}: () => import("virtual:vocoder/translations/${locale}")`,
		)
		.join(",\n");

	return [
		`export const config = ${JSON.stringify(config)};`,
		"",
		`export const loaders = {`,
		loaderEntries,
		`};`,
	].join("\n");
}

export default unplugin;
