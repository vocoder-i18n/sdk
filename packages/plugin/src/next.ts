import { resolve } from "node:path";
import { loadEnvFile } from "./env";
import { unplugin } from "./index";
import type { VocoderPluginOptions } from "./types";

export type { VocoderPluginOptions };

/**
 * Wrap a Next.js config to inject the Vocoder webpack plugin and resolve alias.
 * Also configures the Turbopack alias for Next.js 15+ dev mode.
 *
 * Usage:
 * ```ts
 * import { withVocoder } from '@vocoder/plugin/next';
 * export default withVocoder(nextConfig);
 * ```
 */
export function withVocoder(
	nextConfig: Record<string, unknown> = {},
	pluginOptions: VocoderPluginOptions = {},
): Record<string, unknown> {
	loadEnvFile();

	const localesDir = pluginOptions.localesDir ?? "locales";
	const localesAbsPath = resolve(process.cwd(), localesDir);

	const vocoderPlugin = unplugin.webpack(pluginOptions);

	// Merge Turbopack resolveAlias without clobbering existing config.
	// Next.js 15.2+ moved turbopack config from experimental.turbopack to top-level turbopack.
	const existingTurbopack =
		(nextConfig.turbopack as Record<string, unknown> | undefined) ?? {};
	const existingResolveAlias =
		(existingTurbopack.resolveAlias as Record<string, string> | undefined) ?? {};

	return {
		...nextConfig,
		turbopack: {
			...existingTurbopack,
			resolveAlias: {
				...existingResolveAlias,
				"@vocoder/locales": localesAbsPath,
			},
		},
		webpack(
			config: Record<string, unknown>,
			webpackOptions: Record<string, unknown>,
		) {
			const plugins = (config.plugins ?? []) as unknown[];
			plugins.push(vocoderPlugin);
			config.plugins = plugins;

			// Add @vocoder/locales alias
			const resolveConfig = (config.resolve ?? {}) as Record<string, unknown>;
			resolveConfig.alias = {
				...(resolveConfig.alias as Record<string, string | string[]> | undefined),
				"@vocoder/locales": localesAbsPath,
			};
			config.resolve = resolveConfig;

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
