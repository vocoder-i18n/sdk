import { getCookie, setCookie } from "@vocoder/core";

declare const __VOCODER_PREVIEW__: boolean;

const COOKIE_KEY = "vocoder_preview";

export const PREVIEW_MODE: boolean = (() => {
	try {
		return typeof __VOCODER_PREVIEW__ !== "undefined" && !!__VOCODER_PREVIEW__;
	} catch {
		return false;
	}
})();

/** True if user has opted in via the vocoder_preview=true cookie. Pass cookieString for server-side calls. */
export function isPreviewEnabled(cookieString?: string): boolean {
	return getCookie(COOKIE_KEY, cookieString) === "true";
}

/**
 * True when the SDK should be active (either not in preview mode, or preview mode with opt-in).
 * Pass the `preview` boolean from `VocoderProvider` props on server.
 * Falls back to document.cookie check on the client.
 */
export function isVocoderEnabled(preview?: boolean): boolean {
	if (!PREVIEW_MODE) return true;
	if (preview !== undefined) return preview;
	return isPreviewEnabled();
}

/**
 * Reads ?vocoder=true|false from the URL, syncs to cookie, then redirects to strip the param.
 * Call this once from a useEffect — never during render.
 */
export function syncPreviewQueryParam(): void {
	if (typeof window === "undefined") return;
	try {
		const url = new URL(window.location.href);
		const param = url.searchParams.get(COOKIE_KEY);
		if (param === "true" || param === "false") {
			setCookie(COOKIE_KEY, param);
			url.searchParams.delete(COOKIE_KEY);
			window.location.replace(url.toString());
		}
	} catch {
		// URL parse failed — ignore
	}
}
