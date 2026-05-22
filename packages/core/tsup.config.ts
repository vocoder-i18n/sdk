import { defineConfig } from "tsup";

export default defineConfig({
	entry: { index: "src/index.ts" },
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	sourcemap: true,
	// Browser + Node compatible — same target as @vocoder/react
	target: "es2017",
	platform: "neutral",
	outDir: "dist",
	// Prevents consumers with checkJs:true from type-checking the compiled JS.
	// Type information is provided exclusively via the generated .d.ts files.
	banner: { js: "// @ts-nocheck" },
});
