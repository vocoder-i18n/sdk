import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { VocoderPluginOptions } from "./types";
import { loadEnvFile } from "./env";
import { createUnplugin } from "unplugin";
import { transformMsgProps } from "@vocoder/extractor";

export type { VocoderPluginOptions };

// Subpath export stubs that the plugin overrides with generated virtual modules.
const VIRTUAL_LOCALE_LOADER = "@vocoder/react/locale-loader";
const RESOLVED_LOCALE_LOADER = "\0vocoder-locale-loader";
const VIRTUAL_MANIFEST_LOADER = "@vocoder/react/manifest-loader";
const RESOLVED_MANIFEST_LOADER = "\0vocoder-manifest-loader";

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
				if (id === VIRTUAL_MANIFEST_LOADER) return RESOLVED_MANIFEST_LOADER;
				return null;
			},

			// Restricts unplugin's webpack load rule to only the virtual modules.
			// Without this, unplugin sets type:"javascript/auto" on every file (including
			// locale JSON), making webpack reject valid JSON as malformed JavaScript.
			loadInclude(id: string) {
				return id === RESOLVED_LOCALE_LOADER || id === RESOLVED_MANIFEST_LOADER;
			},

			load(id: string) {
				if (id === RESOLVED_LOCALE_LOADER) return generateLocaleLoader();
				if (id === RESOLVED_MANIFEST_LOADER) return `export default ${JSON.stringify(manifest ?? null)};`;
				return null;
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
						// Exclude virtual subpath modules from pre-bundling so esbuild
						// leaves the bare specifiers in @vocoder/react's pre-bundled chunk.
						// Vite rewrites them at serve time through the module pipeline,
						// where resolveId/load fire and return the generated modules.
						optimizeDeps: {
							exclude: [
								"@vocoder/react/locale-loader",
								"@vocoder/react/manifest-loader",
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
