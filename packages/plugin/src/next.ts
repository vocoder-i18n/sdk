import { loadEnvFile } from "./core";
import { unplugin } from "./index";
import type { VocoderPluginOptions } from "./types";

export type { VocoderPluginOptions };

/**
 * Wrap a Next.js config to inject the Vocoder webpack plugin.
 * Also injects API URL via Next.js `env` config so the value is available
 * in both webpack and Turbopack builds on server and client.
 *
 * Usage:
 * ```js
 * const { withVocoder } = require('@vocoder/plugin/next');
 * module.exports = withVocoder(nextConfig);
 * ```
 */
export function withVocoder(
	nextConfig: Record<string, unknown> = {},
	pluginOptions: VocoderPluginOptions = {},
): Record<string, unknown> {
	loadEnvFile();

	const apiUrl = process.env.VOCODER_API_URL ?? "https://vocoder.app";
	const cdnUrl = process.env.VOCODER_CDN_URL ?? "https://t.vocoder.app";

	// Fingerprint is computed asynchronously in the webpack plugin's buildStart hook.
	// If VOCODER_FINGERPRINT is set (manual override), pass it through to env for Turbopack.
	const fingerprintOverride = process.env.VOCODER_FINGERPRINT;

	const vocoderPlugin = unplugin.webpack(pluginOptions);

	return {
		...nextConfig,
		env: {
			...(nextConfig.env as Record<string, string> | undefined),
			VOCODER_API_URL: apiUrl,
			VOCODER_CDN_URL: cdnUrl,
			VOCODER_BUILD_TS: String(Date.now()),
			...(fingerprintOverride
				? { VOCODER_FINGERPRINT: fingerprintOverride }
				: {}),
		},
		webpack(
			config: Record<string, unknown>,
			webpackOptions: Record<string, unknown>,
		) {
			const plugins = (config.plugins ?? []) as unknown[];
			plugins.push(vocoderPlugin);

			// Webpack doesn't support the virtual: URI scheme natively.
			// Use NormalModuleReplacementPlugin to strip the "virtual:" prefix
			// so unplugin's resolveId/load hooks can intercept the requests.
			try {
				const webpack = require("webpack");
				plugins.push(
					new webpack.NormalModuleReplacementPlugin(
						/^virtual:vocoder\//,
						(resource: { request: string }) => {
							resource.request = resource.request.replace(/^virtual:/, "");
						},
					),
				);
			} catch {
				// webpack not available
			}

			config.plugins = plugins;

			// tsup ESM builds emit a __require shim that webpack flags as a critical
			// dependency (dynamic require expression). It's a false positive — the shim
			// only falls back to require() in CJS contexts. Suppress via both
			// exprContextCritical (older webpack) and ignoreWarnings (webpack 5+).
			const moduleConfig = config.module as Record<string, unknown> | undefined;
			if (moduleConfig) moduleConfig.exprContextCritical = false;

			const ignoreWarnings = (config.ignoreWarnings ?? []) as unknown[];
			ignoreWarnings.push(/Critical dependency: require function is used/);
			config.ignoreWarnings = ignoreWarnings;

			const userWebpack = nextConfig.webpack as
				| ((
						c: Record<string, unknown>,
						o: Record<string, unknown>,
				  ) => Record<string, unknown>)
				| undefined;
			if (typeof userWebpack === "function") {
				return userWebpack(config, webpackOptions);
			}

			return config;
		},
	};
}
