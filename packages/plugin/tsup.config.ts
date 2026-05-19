import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		vite: "src/vite.ts",
		webpack: "src/webpack.ts",
		rollup: "src/rollup.ts",
		esbuild: "src/esbuild.ts",
		next: "src/next.ts",
	},
	format: ["esm", "cjs"],
	// strict: false for DTS only — plugin bundles @vocoder/extractor (noExternal) so
	// extractor's dist/index.d.ts may not exist when building plugin in isolation.
	// TS7016 (noImplicitAny) is suppressed here because extractor types don't appear
	// in plugin's public API; the JS bundle is unaffected by this DTS-only relaxation.
	dts: { compilerOptions: { strict: false } },
	clean: true,
	sourcemap: true,
	target: "node18",
	outDir: "dist",
	// unplugin is intentionally external: its webpack/rspack loaders register absolute
	// paths via __dirname at runtime. Bundling unplugin into plugin's dist shifts
	// __dirname to plugin/dist, breaking those loader paths. Keeping unplugin as a
	// real dependency ensures __dirname resolves inside unplugin's own dist where the
	// loader files actually live.
	noExternal: [
		"@vocoder/extractor",
		"@babel/parser",
		"@babel/traverse",
		"@babel/types",
		"@babel/core",
		"glob",
	],
	esbuildOptions(options, { format }) {
		if (format === "esm") {
			// createRequire shim: bundled CJS deps call require() internally; needs ESM equivalent.
			options.banner = {
				js: `import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);`,
			};
		}
		if (format === "cjs") {
			// Polyfill import.meta.url for any bundled ESM deps that call createRequire(import.meta.url).
			// esbuild replaces import.meta.url with undefined in CJS output; define must reference an identifier.
			options.banner = {
				js: `const __importMetaUrl = require('url').pathToFileURL(__filename).href;`,
			};
			options.define = {
				...options.define,
				"import.meta.url": "__importMetaUrl",
			};
		}
	},
});
