import type { VocoderPluginOptions } from "./types";
import { createUnplugin } from "unplugin";
import { extractProjectShortIdFromApiKey } from "@vocoder/core";
import { loadEnvFile } from "./env";
import { transformMsgProps } from "@vocoder/extractor";

export type { VocoderPluginOptions };

export const unplugin = createUnplugin(
	(options: VocoderPluginOptions = {}) => {
		loadEnvFile();

		// Capture once at plugin init — accurate "build started at" timestamp.
		const buildTs = Date.now();

		function getDefineValues(): Record<string, string> {
			const cdnUrl = process.env.VOCODER_CDN_URL;
			const apiUrl = process.env.VOCODER_API_URL;
			const apiKey = process.env.VOCODER_API_KEY;
			const projectShortId = apiKey ? extractProjectShortIdFromApiKey(apiKey) : null;
			return {
				__VOCODER_PREVIEW__: JSON.stringify(options.preview ?? false),
				// Inject "undefined" (not undefined) when unset so the typeof guard in
				// cdn-refresh.ts resolves to false and falls through to production defaults.
				__VOCODER_CDN_URL__: cdnUrl ? JSON.stringify(cdnUrl) : "undefined",
				__VOCODER_API_URL__: apiUrl ? JSON.stringify(apiUrl) : "undefined",
				__VOCODER_BUILD_TS__: String(buildTs),
				// Safe to expose — public project identifier, not a secret.
				__VOCODER_PROJECT_SHORT_ID__: projectShortId ? JSON.stringify(projectShortId) : "undefined",
			};
		}

		return {
			name: "vocoder",
			enforce: "pre" as const,

			buildStart() {
				const apiKey = process.env.VOCODER_API_KEY;
				const projectShortId = apiKey ? extractProjectShortIdFromApiKey(apiKey) : null;
				if (!projectShortId) {
					const reason = apiKey
						? "VOCODER_API_KEY format is invalid — could not extract project ID."
						: "VOCODER_API_KEY is not set.";
					// Use console.warn rather than this.warn() for cross-bundler compatibility.
					console.warn(`[vocoder] ${reason} Live translation updates via CDN are disabled.`);
				}
			},

			transformInclude(id: string) {
				return /\.[jt]sx?$/.test(id) && !id.includes("node_modules");
			},

			// Injects id, message, values, and components props on <T> elements
			// that have dynamic children — required for ergonomic authoring without
			// explicit message and values props on every dynamic <T>.
			async transform(code: string, id: string) {
				if (!code.includes("@vocoder/react")) return null;
				try {
					const result = await transformMsgProps(code, id);
					return result.changed ? { code: result.code } : null;
				} catch {
					return null;
				}
			},

			vite: {
				config() {
					return {
						define: getDefineValues(),
					};
				},
			},

			webpack(compiler) {
				try {
					// eslint-disable-next-line @typescript-eslint/no-require-imports
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
