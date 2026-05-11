import { loadEnvFiles } from "./load-env.js";
import type { LocalConfig } from "../types.js";

// Load .env and .env.local files if present
loadEnvFiles();

/**
 * Extracts the app short code embedded in the API key token.
 * Key format: vca_{shortCode(10)}_{random(22)}
 * Safe to call offline — no network required.
 */
export function extractShortCodeFromApiKey(apiKey: string): string {
	return apiKey.slice(4, 14);
}

/**
 * Validates the local configuration
 */
export function validateLocalConfig(config: LocalConfig): void {
	if (!config.apiKey || config.apiKey.length === 0) {
		throw new Error("VOCODER_API_KEY is required. Set it in your .env or .env.local file.");
	}

	if (!config.apiKey.startsWith("vca_")) {
		throw new Error(
			"Invalid API key format. Expected an app API key starting with vca_.",
		);
	}

	if (!config.apiUrl || !config.apiUrl.startsWith("http")) {
		throw new Error("Invalid API URL");
	}
}

