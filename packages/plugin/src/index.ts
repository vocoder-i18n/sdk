import type { VocoderPluginOptions } from "./types";
import { createUnplugin } from "unplugin";
import { loadEnvFile } from "./env";
import { transformMsgProps } from "@vocoder/extractor";

export type { VocoderPluginOptions };

export const unplugin = createUnplugin(
	(options: VocoderPluginOptions = {}) => {
		loadEnvFile();

		function getDefineValues(): Record<string, string> {
			return {
				__VOCODER_PREVIEW__: JSON.stringify(options.preview ?? false),
			};
		}

		return {
			name: "vocoder",
			enforce: "pre" as const,

			transformInclude(id: string) {
				return /\.[jt]sx?$/.test(id) && !id.includes("node_modules");
			},

			// Injects id, message, values, and components props on <T> elements
			// that have dynamic children — required for ergonomic authoring without
			// explicit message and values props on every dynamic <T>.
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
