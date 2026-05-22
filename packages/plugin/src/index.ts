import type { VocoderPluginOptions } from "./types";
import { createUnplugin } from "unplugin";
import { existsSync } from "node:fs";
import { loadEnvFile } from "./env";
import { resolve } from "node:path";
import { transformMsgProps } from "@vocoder/extractor";

export type { VocoderPluginOptions };

// Subpath import IDs that the plugin resolves to real files on disk.
// @vocoder/react exports stubs at these paths as fallback when files are absent.
const VIRTUAL_LOCALE_LOADER = "@vocoder/react/locale-loader";
const VIRTUAL_MANIFEST_LOADER = "@vocoder/react/manifest-loader";

export const unplugin = createUnplugin(
	(options: VocoderPluginOptions = {}) => {
		loadEnvFile();

		const localesDir = options.localesDir ?? "locales";

		function getDefineValues(): Record<string, string> {
			return {
				__VOCODER_PREVIEW__: JSON.stringify(options.preview ?? false),
			};
		}

		return {
			name: "vocoder",
			enforce: "pre" as const,

			// Redirect @vocoder/react subpath imports to real files written by `vocoder translate`.
			// Returns null when files are absent — imports fall through to the stub in @vocoder/react,
			// so source-text rendering still works before any translation has been run.
			resolveId: {
				filter: { id: { include: [/^@vocoder\/react\/(locale-loader|manifest-loader)$/] } },
				handler(id: string, _importer, options) {
					// Skip during Vite's dep-scan phase — let esbuild's own resolver handle it
					// so the scan completes without triggering repeated re-optimization passes.
					// `scan` is Vite-specific and not in unplugin's cross-bundler types.
					if ((options as { isEntry: boolean; scan?: boolean })?.scan) return null;
					if (id === VIRTUAL_LOCALE_LOADER) {
						const p = resolve(process.cwd(), localesDir, "loader.js");
						return existsSync(p) ? p : null;
					}
					if (id === VIRTUAL_MANIFEST_LOADER) {
						const p = resolve(process.cwd(), localesDir, "manifest.json");
						return existsSync(p) ? p : null;
					}
					return null;
				},
			},

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
						// Exclude locale subpath imports from Vite's esbuild pre-bundler.
						// Without this, esbuild resolves them to the @vocoder/react stubs during
						// pre-bundling and caches them — plugin resolveId never fires at serve time.
						// Excluded imports stay external in the @vocoder/react pre-bundle and are
						// resolved through the module pipeline where resolveId can redirect to real files.
						optimizeDeps: {
							exclude: [
								VIRTUAL_LOCALE_LOADER,
								VIRTUAL_MANIFEST_LOADER,
							],
						},
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
