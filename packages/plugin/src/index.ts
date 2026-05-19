import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { VocoderPluginOptions } from "./types";
import { loadEnvFile } from "./env";
import { createUnplugin } from "unplugin";
import { transformMsgProps } from "@vocoder/extractor";

export type { VocoderPluginOptions };

// The subpath export stub that the plugin overrides with a generated virtual module.
const VIRTUAL_LOCALE_LOADER = "@vocoder/react/locale-loader";
const RESOLVED_LOCALE_LOADER = "\0vocoder-locale-loader";

export const unplugin = createUnplugin(
	(options: VocoderPluginOptions = {}) => {
		loadEnvFile();

		const localesDir = options.localesDir ?? "locales";
		let manifest: unknown = null;

		function loadManifest(): void {
			const manifestPath = resolve(process.cwd(), localesDir, "manifest.json");
			try {
				manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
				if (options.verbose) {
					console.log(`[vocoder] Loaded manifest from ${manifestPath}`);
				}
			} catch {
				manifest = null;
				if (options.verbose) {
					console.warn(
						`[vocoder] manifest.json not found at ${manifestPath} — translations disabled`,
					);
				}
			}
		}

		function getDefineValues(): Record<string, string> {
			return {
				__VOCODER_MANIFEST__: JSON.stringify(manifest ?? null),
				__VOCODER_PREVIEW__: JSON.stringify(options.preview ?? false),
			};
		}

		// Generates a module with a static switch statement so every bundler
		// (Vite, Rollup, esbuild, webpack) can analyze the imports statically and
		// split each locale into its own lazy chunk. Dynamic template literals are
		// NOT rewritten by most bundlers — absolute static strings are.
		function generateLocaleLoader(): string {
			const localesAbsPath = resolve(process.cwd(), localesDir);
			let files: string[] = [];
			try {
				files = readdirSync(localesAbsPath).filter(
					(f) => f.endsWith(".json") && f !== "manifest.json",
				);
			} catch {
				// locales dir doesn't exist yet — emit an empty switch
			}
			const cases = files
				.map((f) => {
					const locale = f.replace(".json", "");
					const absPath = resolve(localesAbsPath, f);
					return `    case ${JSON.stringify(locale)}: return import(${JSON.stringify(absPath)}).then(function(m) { return m.default != null ? m.default : m; });`;
				})
				.join("\n");
			return `export async function loadLocale(locale) {\n  switch (locale) {\n${cases}\n    default: return {};\n  }\n}\n`;
		}

		return {
			name: "vocoder",
			enforce: "pre" as const,

			buildStart() {
				loadManifest();
			},

			resolveId(id: string) {
				if (id === VIRTUAL_LOCALE_LOADER) return RESOLVED_LOCALE_LOADER;
				return null;
			},

			load(id: string) {
				if (id !== RESOLVED_LOCALE_LOADER) return null;
				return generateLocaleLoader();
			},

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
				config() {
					loadManifest();
					return {
						define: getDefineValues(),
						// Exclude only the locale-loader subpath from pre-bundling so esbuild
						// leaves the bare specifier in the @vocoder/react pre-bundled chunk.
						// Vite rewrites it at serve time through the module pipeline, where
						// resolveId/load fire and return the generated locale switch.
						// @vocoder/react itself stays pre-bundled and optimized.
						optimizeDeps: {
							exclude: ["@vocoder/react/locale-loader"],
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
