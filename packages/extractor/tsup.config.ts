import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
	},
	format: ["esm", "cjs"],
	dts: {
		compilerOptions: {
			baseUrl: ".",
			paths: {
				"@vocoder/config": ["../config/src/index.ts"],
				"@vocoder/core": ["../core/src/index.ts"],
			},
			rootDir: "..",
		},
	},
	clean: true,
	sourcemap: true,
	target: "node18",
	outDir: "dist",
	banner: { js: "// @ts-nocheck" },
	external: [
		"@babel/core",
		"@babel/parser",
		"@babel/traverse",
		"@babel/types",
		"glob",
	],
});
