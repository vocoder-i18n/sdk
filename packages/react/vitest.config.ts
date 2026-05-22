import { defineConfig } from "vitest/config";

export default defineConfig({
	define: {
		__VOCODER_PREVIEW__: JSON.stringify(false),
	},
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./src/__tests__/setup.ts"],
	},
});
