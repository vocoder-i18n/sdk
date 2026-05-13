import type { ExtractedString, TranslationStringEntry } from "../types.js";

function mergeContext(current?: string, incoming?: string): string | undefined {
	if (!incoming) return current;
	if (!current) return incoming;
	if (current === incoming) return current;
	const parts = new Set(
		[...current.split(" | "), ...incoming.split(" | ")].map((s) => s.trim()).filter(Boolean),
	);
	return Array.from(parts).join(" | ");
}

export function buildStringEntries(extractedStrings: ExtractedString[]): TranslationStringEntry[] {
	const byKey = new Map<string, TranslationStringEntry>();
	for (const str of extractedStrings) {
		const existing = byKey.get(str.key);
		if (!existing) {
			byKey.set(str.key, {
				key: str.key,
				text: str.text,
				...(str.context ? { context: str.context } : {}),
				...(str.formality ? { formality: str.formality } : {}),
				...(str.uiRole ? { uiRole: str.uiRole } : {}),
			});
			continue;
		}
		existing.context = mergeContext(existing.context, str.context);
		if (!existing.formality && str.formality) {
			existing.formality = str.formality;
		} else if (existing.formality && str.formality && existing.formality !== str.formality) {
			existing.formality = "auto";
		}
	}
	return Array.from(byKey.values());
}
