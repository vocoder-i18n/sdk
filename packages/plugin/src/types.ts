export interface VocoderPluginOptions {
	/**
	 * Enable preview mode — SDK is dormant by default in production.
	 * Visitors see source text and no locale selector.
	 * Opt in via `?vocoder_preview=true` (sets a cookie, then redirects).
	 * Opt out via `?vocoder_preview=false`.
	 * @default false
	 */
	preview?: boolean;
}
