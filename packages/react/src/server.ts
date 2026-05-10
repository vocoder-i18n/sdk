/**
 * Returns the text direction for a given locale using the locale metadata
 * from the Vocoder manifest. Pass `config.locales` from the virtual manifest:
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { config } from 'virtual:vocoder/manifest';
 * import { cookies } from 'next/headers';
 * import { getLocaleDir } from '@vocoder/react/server';
 *
 * export default async function RootLayout({ children }) {
 *   const stored = (await cookies()).get('vocoder_locale')?.value ?? config.sourceLocale;
 *   const dir = getLocaleDir(stored, config.locales);
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
