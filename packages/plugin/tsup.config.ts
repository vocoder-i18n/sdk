import { defineConfig } from "tsup";

// @babel/core's config-file detector probes for @babel/preset-typescript to determine whether
// .ts config files need TS parsing. Dead code with configFile:false, but esbuild statically
// resolves all require() calls — stub it to prevent bundle failure.
const stubUnreachableBabelProbes = {
	name: "stub-unreachable-babel-probes",
	setup(build: any) {
		build.onResolve(
			{ filter: /^@babel\/preset-typescript\/package\.json$/ },
			() => ({ path: "@babel/preset-typescript/package.json", namespace: "babel-probe-stub" }),
		);
		build.onLoad({ filter: /.*/, namespace: "babel-probe-stub" }, () => ({
			contents: "module.exports = {}",
			loader: "js",
		}));
	},
};

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
	dts: { compilerOptions: { strict: false, lib: ["ES2022", "DOM"] } },
	clean: true,
	sourcemap: true,
	target: "node18",
	outDir: "dist",
	// @vocoder/extractor and its Babel deps are noExternal so the plugin is
	// self-contained — consumers don't install Babel. unplugin stays external because
	// its webpack/rspack loaders register absolute paths via __dirname at runtime;
	// bundling it would shift __dirname to plugin/dist, breaking those loader paths.
	noExternal: [
		"@vocoder/extractor",
		"@babel/parser",
		"@babel/traverse",
		"@babel/types",
		"@babel/core",
		"glob",
	],
	esbuildPlugins: [stubUnreachableBabelProbes],
	esbuildOptions(options, { format }) {
		if (format === "esm") {
			// createRequire shim: bundled CJS deps call require() internally; needs ESM equivalent.
			options.banner = {
				js: `// @ts-nocheck\nimport { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);`,
			};
		}
		if (format === "cjs") {
			// Polyfill import.meta.url for any bundled ESM deps that call createRequire(import.meta.url).
			// esbuild replaces import.meta.url with undefined in CJS output; define must reference an identifier.
			options.banner = {
				js: `// @ts-nocheck\nconst __importMetaUrl = require('url').pathToFileURL(__filename).href;`,
			};
			options.define = {
				...options.define,
				"import.meta.url": "__importMetaUrl",
			};
		}
	},
});
