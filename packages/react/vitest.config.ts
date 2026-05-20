import manifest from "./test/fixtures/manifest";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@vocoder/locales": resolve(__dirname, "test/fixtures/locales"),
			"@vocoder/react/locale-loader": resolve(__dirname, "test/fixtures/locale-loader.ts"),
			"@vocoder/react/manifest-loader": resolve(__dirname, "test/fixtures/manifest.ts"),
		},
	},
	define: {
		__VOCODER_MANIFEST__: JSON.stringify(manifest),
	},
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./src/__tests__/setup.ts"],
	},
});
