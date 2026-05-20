import { defineConfig } from "tsup";

const external = [
	"react",
	"react/jsx-runtime",
	"react-dom",
	"@vocoder/core",
	"@vocoder/react/locale-loader",
	"@vocoder/react/manifest-loader",
];

export default defineConfig([
	// Client entries — require React hooks/context. 'use client' tells Next.js
	// App Router not to evaluate these in the RSC runtime.
	// treeshake disabled so rollup doesn't rewrite (and strip) the directive.
	// esbuild's native tree-shaking is used instead via the banner esbuildOption.
	{
		entry: {
			index: "src/index.ts",
			"locale-selector": "src/locale-selector.ts",
			"locale-loader": "src/locale-loader.ts",
		},
		format: ["esm", "cjs"] as const,
		dts: true,
		clean: false,
		sourcemap: true,
		target: "es2017" as const,
		platform: "neutral" as const,
		external,
		esbuildOptions(options) {
			options.banner = { js: "'use client';" };
		},
	},
	// Neutral entries — no React, no 'use client', safe to import from both server and client.
	{
		entry: {
			server: "src/server.ts",
			"manifest-loader": "src/manifest-loader.ts",
		},
		format: ["esm", "cjs"] as const,
		dts: true,
		clean: false,
		sourcemap: true,
		target: "es2017" as const,
		platform: "neutral" as const,
		treeshake: true,
		external,
	},
]);
