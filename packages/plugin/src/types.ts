export interface VocoderPluginOptions {
	/**
	 * Enable verbose build-time logging.
	 * @default false
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
	/**
	 * Path to the committed locales directory, relative to process.cwd().
	 * Must contain manifest.json and per-locale JSON files.
	 * @default 'locales'
	 */
	localesDir?: string;
}
