import { extractProjectShortIdFromApiKey } from "@vocoder/core";
import { loadEnvFiles } from "./load-env.js";
import type { LocalConfig } from "../types.js";

// Load .env and .env.local files if present
loadEnvFiles();

export { extractProjectShortIdFromApiKey };

/**
 * Validates the local configuration
 */
export function validateLocalConfig(config: LocalConfig): void {
	if (!config.apiKey || config.apiKey.length === 0) {
		throw new Error("VOCODER_API_KEY is required. Set it in your .env or .env.local file.");
	}

	if (!config.apiKey.startsWith("vcp_")) {
		throw new Error(
			"Invalid API key format. Expected a project API key starting with vcp_.",
		);
	}

	if (!config.apiUrl || !config.apiUrl.startsWith("http")) {
		throw new Error("Invalid API URL");
	}
}
