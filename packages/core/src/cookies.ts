export function getCookie(name: string, cookieString?: string): string | null {
	const cookies =
		cookieString || (typeof document !== "undefined" ? document.cookie : "");

	if (!cookies) {
		return null;
	}

	const value = cookies
		.split("; ")
		.find((row: string) => row.startsWith(`${name}=`))
		?.split("=")[1];

	return value ? decodeURIComponent(value) : null;
}

export function setCookie(
	name: string,
	value: string,
	options: {
		maxAge?: number;
		path?: string;
		domain?: string;
		sameSite?: "Strict" | "Lax" | "None";
		secure?: boolean;
	} = {},
): void {
	if (typeof document === "undefined") {
		return;
	}

	const {
		maxAge = 365 * 24 * 60 * 60,
		path = "/",
		sameSite = "Lax",
		secure = typeof window !== "undefined" &&
			window.location.protocol === "https:",
	} = options;

	let cookieString = `${name}=${encodeURIComponent(value)}`;

	if (maxAge) {
		cookieString += `; Max-Age=${maxAge}`;
	}

	if (path) {
		cookieString += `; Path=${path}`;
	}

	if (options.domain) {
		cookieString += `; Domain=${options.domain}`;
	}

	if (sameSite) {
		cookieString += `; SameSite=${sameSite}`;
	}

	if (secure) {
		cookieString += "; Secure";
	}

	document.cookie = cookieString;
}

/**
 * Find the best matching locale from available options.
 * Handles language codes and regional variants (e.g., 'en-US' -> 'en').
 */
export function getBestMatchingLocale(
	preferredLocale: string,
	supportedLocales: string[],
	fallback: string,
): string {
	if (supportedLocales.includes(preferredLocale)) {
		return preferredLocale;
	}

	const languageCode = preferredLocale.split("-")[0];
	if (languageCode && supportedLocales.includes(languageCode)) {
		return languageCode;
	}

	const similarLocale = supportedLocales.find((locale: string) =>
		locale.startsWith(`${languageCode}-`),
	);
	if (similarLocale) {
		return similarLocale;
	}

	return fallback;
}
