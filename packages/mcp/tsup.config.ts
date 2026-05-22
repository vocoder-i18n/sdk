import { defineConfig } from "tsup";

export default defineConfig({
	entry: { index: "src/index.ts" },
	format: ["esm"],
	dts: true,
	clean: true,
	sourcemap: true,
	target: "node18",
	outDir: "dist",
	banner: { js: "// @ts-nocheck" },
	external: ["@modelcontextprotocol/sdk"],
});
