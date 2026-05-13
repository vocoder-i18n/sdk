/**
 * Returns the text direction for a given locale using locale metadata.
 * Pass `locales` from getLocales() (imported from @vocoder/react/server)
 * or from the VocoderContext.
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { cookies } from 'next/headers';
 * import { getLocaleDir } from '@vocoder/react/server';
 * import { getConfig, getLocales } from '@vocoder/react';
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
