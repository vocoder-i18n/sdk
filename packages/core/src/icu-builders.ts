// Unambiguous plural CLDR categories. "other" is excluded — it's also the
// required fallback in select mode, so it can't determine mode on its own.
export const PLURAL_CLDR = new Set(["zero", "one", "two", "few", "many"]);
// Full set used only by buildPluralICU/buildSelectICU where mode is already known.
export const ALL_CLDR = new Set(["zero", "one", "two", "few", "many", "other"]);

/**
 * Default ordinal ICU — locale-neutral structural placeholder used as the extraction
 * key and bundle lookup key for `<T value={rank} ordinal />` components.
 *
 * Uses a minimal single-branch form so the stored ICU carries no source-language
 * ordinal suffixes. The actual ordinal form is resolved at runtime:
 *   Tier 1 — ordinalForms.suffixes/words from the compiled bundle (covers 93+ languages)
 *   Tier 2 — this key's bundle translation (provider returns `other {#}` unchanged;
 *             formatICU evaluates it to String(rank), same as Tier 3)
 *   Tier 3 — String(rank) fallback
 */
export const DEFAULT_ORDINAL_ICU = "{count, selectordinal, other {#}}";

/**
 * Build a plural or ordinal ICU string from plural prop key/value pairs.
 * Exact matches (_0, _1) come before CLDR categories (one, other, etc.).
 * Internal variable name is always "count" for consistent lookup keys.
 */
export function buildPluralICU(props: Record<string, string>, ordinal = false): string {
	const type = ordinal ? "selectordinal" : "plural";
	const exactParts: string[] = [];
	const cldrParts: string[] = [];

	for (const [key, text] of Object.entries(props)) {
		const exactMatch = key.match(/^_(\d+)$/);
		if (exactMatch) {
			exactParts.push(`=${exactMatch[1]} {${text}}`);
		} else if (ALL_CLDR.has(key)) {
			cldrParts.push(`${key} {${text}}`);
		}
	}

	return `{count, ${type}, ${[...exactParts, ...cldrParts].join(" ")}}`;
}

/**
 * Build a select ICU string from select prop key/value pairs.
 * Internal variable name is always "value" for consistent lookup keys.
 */
export function buildSelectICU(props: Record<string, string>): string {
	const cases: string[] = [];
	let hasOther = false;

	for (const [key, text] of Object.entries(props)) {
		if (key === "other") {
			hasOther = true;
			cases.push(`other {${text}}`);
		} else {
			const wordCase = key.match(/^_([a-zA-Z].*)$/);
			if (wordCase) cases.push(`${wordCase[1]} {${text}}`);
		}
	}

	if (!hasOther) cases.push("other {other}");
	return `{value, select, ${cases.join(" ")}}`;
}
