import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		bin: "src/bin.ts",
		lib: "src/lib.ts",
	},
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	minify: false,
	target: "node18",
	outDir: "dist",
	// Bundle internal vocoder packages and their deps so the CLI is self-contained.
	// Version mismatches between @vocoder/extractor and @vocoder/cli would produce
	// different extracted string sets → different fingerprints → 404 at build time.
	noExternal: [
		"@vocoder/core",
		"@vocoder/extractor",
		"@vocoder/config",
		"@babel/parser",
		"@babel/traverse",
		"@babel/types",
		"@babel/core",
		"glob",
	],
	esbuildOptions(options) {
		// CJS deps bundled into ESM call require() for Node built-ins (tty, os, etc.).
		// This shim makes require() available inside the ESM bundle.
		options.banner = {
			js: `import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);`,
		};
	},
});
