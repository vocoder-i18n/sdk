import { vocoder } from "@vocoder/core";
import type { LocalesMap } from "@vocoder/core";

/**
 * Returns locale config from the default VocoderCore singleton.
 * Call after `vocoder.load()` has been called in your app bootstrap.
 *
 * @example Next.js App Router:
 *   import { getConfig, getLocaleDir } from '@vocoder/react/server'
 *   export default async function Layout() {
 *     const { sourceLocale } = getConfig()
 *     ...
 *   }
 */
export function getConfig(): {
	sourceLocale: string;
	targetLocales: string[];
	locales: LocalesMap;
} {
	return {
		sourceLocale: vocoder.defaultLocale,
		targetLocales: vocoder.availableLocales.filter(
			(l) => l !== vocoder.defaultLocale,
		),
		locales: vocoder.locales,
	};
}

/** Returns locale metadata from the default VocoderCore singleton. */
export function getLocales(): LocalesMap {
	return vocoder.locales;
}

/**
 * Returns the text direction for a given locale using locale metadata.
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { cookies } from 'next/headers';
 * import { getLocales, getLocaleDir } from '@vocoder/react/server';
 *
 * export default async function RootLayout({ children }) {
 *   const stored = (await cookies()).get('vocoder_locale')?.value ?? 'en';
 *   const dir = getLocaleDir(stored, getLocales());
 *   return <html lang={stored} dir={dir}>{children}</html>;
 * }
 * ```
 */
export function getLocaleDir(
	locale: string,
	locales?: Record<string, { dir?: string }>,
): "ltr" | "rtl" {
	return (locales?.[locale]?.dir ?? "ltr") as "ltr" | "rtl";
}
