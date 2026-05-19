import type { LocaleManifest, LocaleInfo, LocalesMap } from "./types";

export function manifestToLocalesMap(manifest: LocaleManifest): LocalesMap {
	const result: LocalesMap = {};
	for (const [code, entry] of Object.entries(manifest.locales)) {
		const info: LocaleInfo = { nativeName: entry.nativeName };
		if (entry.currencyCode !== undefined) info.currencyCode = entry.currencyCode;
		if (entry.isRTL) info.dir = "rtl";
		if (entry.ordinalForms !== undefined) info.ordinalForms = entry.ordinalForms;
		result[code] = info;
	}
	return result;
}
