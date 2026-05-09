export interface VocoderPluginOptions {
	/**
	 * Enable verbose build-time logging: extraction patterns, timing, fetch URL.
	 * @default false
	 *
	 * Extraction patterns (include/exclude) are configured in vocoder.config.ts
	 * committed to your repository — not here. This ensures the build plugin,
	 * CLI sync, and git webhook all use identical patterns.
	 */
	verbose?: boolean;
	/**
	 * Enable preview mode — SDK is dormant by default in production.
	 * Visitors see source text and no locale selector.
	 * Opt in via `?vocoder_preview=true` (sets a cookie, then redirects).
	 * Opt out via `?vocoder_preview=false`.
	 * @default false
	 */
	preview?: boolean;
}

// VocoderTranslationData is the canonical bundle format shared by plugin and CLI.
// Defined in @vocoder/core — imported and re-exported here so plugin consumers
// can reference it without depending on @vocoder/core directly.
export type { VocoderTranslationData } from "@vocoder/core";
