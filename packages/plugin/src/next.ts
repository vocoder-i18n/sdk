import { loadEnvFile } from "./env";
import { unplugin } from "./index";
import type { VocoderPluginOptions } from "./types";

export type { VocoderPluginOptions };

/**
 * Wrap a Next.js config to inject the Vocoder webpack plugin.
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

	const vocoderPlugin = unplugin.webpack(pluginOptions);

	return {
		...nextConfig,
		webpack(
			config: Record<string, unknown>,
			webpackOptions: Record<string, unknown>,
		) {
			const plugins = (config.plugins ?? []) as unknown[];
			plugins.push(vocoderPlugin);
			config.plugins = plugins;

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
