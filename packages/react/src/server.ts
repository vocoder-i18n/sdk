// getConfig and getLocales read from __VOCODER_MANIFEST__ (a build-time define constant).
// They live here (server entry, no 'use client') so Next.js Server Components can call them.
export { getConfig, getLocales } from "./runtime";

/**
 * Returns the text direction for a given locale using locale metadata.
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { cookies } from 'next/headers';
 * import { getConfig, getLocales, getLocaleDir } from '@vocoder/react/server';
 *
 * export default async function RootLayout({ children }) {
 *   const { sourceLocale } = getConfig();
 *   const stored = (await cookies()).get('vocoder_locale')?.value ?? sourceLocale;
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
