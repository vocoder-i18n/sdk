import bundle from "./test/fixtures/bundle";
import { defineConfig } from "vitest/config";

export default defineConfig({
	define: {
		__VOCODER_BUNDLE__: JSON.stringify(bundle),
		__VOCODER_FINGERPRINT__: JSON.stringify(""),
	},
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./src/__tests__/setup.ts"],
	},
});
