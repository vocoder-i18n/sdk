import IntlMessageFormat from "intl-messageformat";
import {
	isPluralElement,
	isSelectElement,
	isTagElement,
	parse,
	TYPE,
} from "@formatjs/icu-messageformat-parser";
import type {
	LiteralElement,
	MessageFormatElement,
	PluralElement,
} from "@formatjs/icu-messageformat-parser";
import type { OrdinalForms } from "./types";

// ---------------------------------------------------------------------------
// IntlMessageFormat cache — keyed by "locale:text"
// ---------------------------------------------------------------------------

const imfCache = new Map<string, IntlMessageFormat>();

function getIMF(text: string, locale: string): IntlMessageFormat {
	const key = `${locale}:${text}`;
	let msg = imfCache.get(key);
	if (!msg) {
		// ignoreTag: true — component placeholders (<c0>, <c1>) are handled
		// by formatElements, not by IMF. IMF handles only ICU primitives.
		msg = new IntlMessageFormat(text, locale, undefined, { ignoreTag: true });
		imfCache.set(key, msg);
	}
	return msg;
}

/**
 * Format an ICU MessageFormat string with the given values and locale.
 * Returns the raw `text` unchanged if parsing or formatting throws — the
 * caller always gets a string, never an exception.
 */
export function formatICU(
	text: string,
	values: Record<string, any>,
	locale: string = "en",
): string {
	try {
		const result = getIMF(text, locale.toLowerCase()).format(values);
		return typeof result === "string" ? result : (result as unknown[]).join("");
	} catch (error) {
		if (process.env.NODE_ENV !== "production") {
			console.error(
				`[vocoder] ICU formatting error for locale "${locale}":`,
				error,
				"\n  ICU:", text,
				"\n  values:", values,
			);
		}
		return text;
	}
}

// ---------------------------------------------------------------------------
// Embedded selectordinal rewriting — Bug 1 fix
//
// The translation pipeline's ordinal DB fast path (tryBuildOrdinalFromDB)
// only applies when a selectordinal is the SOLE top-level element in the
// ICU string. When it appears embedded inside a larger sentence (e.g.
// "Congrats! your {year, selectordinal, ...} anniversary!"), the pipeline
// falls through to the translation provider, which stores garbage branches
// (e.g. "1el", "1th", "1الـ") in the DB.
//
// This function fixes the stored translation at render time by rewriting
// any selectordinal nodes using the locale's ordinalForms data.
// ---------------------------------------------------------------------------

const CLDR_ORDINAL_ORDER = [
	"zero",
	"one",
	"two",
	"few",
	"many",
	"other",
] as const;

function printICU(elements: MessageFormatElement[]): string {
	return elements.map(printElement).join("");
}

function printElement(el: MessageFormatElement): string {
	switch (el.type) {
		case TYPE.literal:
			return (el as LiteralElement).value;
		case TYPE.argument:
			return `{${el.value}}`;
		case TYPE.pound:
			return "#";
		case TYPE.number: {
			if (!el.style) return `{${el.value}, number}`;
			const style =
				typeof el.style === "string"
					? el.style
					: `::${(el.style as Record<string, any>).parsedOptions ?? ""}`;
			return `{${el.value}, number, ${style}}`;
		}
		case TYPE.date: {
			if (!el.style) return `{${el.value}, date}`;
			const style =
				typeof el.style === "string"
					? el.style
					: `::${(el.style as Record<string, any>).parsedOptions ?? ""}`;
			return `{${el.value}, date, ${style}}`;
		}
		case TYPE.time: {
			if (!el.style) return `{${el.value}, time}`;
			const style =
				typeof el.style === "string"
					? el.style
					: `::${(el.style as Record<string, any>).parsedOptions ?? ""}`;
			return `{${el.value}, time, ${style}}`;
		}
		case TYPE.select: {
			const options = Object.entries(
				(el as Record<string, any>).options as Record<
					string,
					{ value: MessageFormatElement[] }
				>,
			)
				.map(([k, v]) => `${k} {${printICU(v.value)}}`)
				.join(" ");
			return `{${el.value}, select, ${options}}`;
		}
		case TYPE.plural: {
			const pluralEl = el as PluralElement;
			const pluralType =
				pluralEl.pluralType === "ordinal" ? "selectordinal" : "plural";
			const offset =
				pluralEl.offset !== 0 ? `offset:${pluralEl.offset} ` : "";
			const options = Object.entries(pluralEl.options)
				.map(([k, v]) => `${k} {${printICU(v.value)}}`)
				.join(" ");
			return `{${pluralEl.value}, ${pluralType}, ${offset}${options}}`;
		}
		case TYPE.tag: {
			const children = printICU((el as Record<string, any>).children as MessageFormatElement[]);
			return `<${el.value}>${children}</${el.value}>`;
		}
		default:
			return "";
	}
}

function rewriteElements(
	elements: MessageFormatElement[],
	forms: OrdinalForms,
	values: Record<string, any>,
): MessageFormatElement[] {
	return elements.flatMap((el) => {
		if (isPluralElement(el) && el.pluralType === "ordinal") {
			return [rewriteSelectordinalElement(el, forms, values)];
		}
		if (isSelectElement(el)) {
			const options: Record<string, { value: MessageFormatElement[] }> = {};
			for (const [key, opt] of Object.entries(
				el.options as Record<string, { value: MessageFormatElement[] }>,
			)) {
				options[key] = { value: rewriteElements(opt.value, forms, values) };
			}
			return [{ ...el, options } as MessageFormatElement];
		}
		if (isPluralElement(el)) {
			const options: Record<string, { value: MessageFormatElement[] }> = {};
			for (const [key, opt] of Object.entries(el.options)) {
				options[key] = { value: rewriteElements(opt.value, forms, values) };
			}
			return [{ ...el, options } as MessageFormatElement];
		}
		if (isTagElement(el)) {
			return [
				{
					...el,
					children: rewriteElements(
						(el as Record<string, any>).children as MessageFormatElement[],
						forms,
						values,
					),
				} as MessageFormatElement,
			];
		}
		return [el];
	});
}

function rewriteSelectordinalElement(
	el: PluralElement,
	forms: OrdinalForms,
	values: Record<string, any>,
): MessageFormatElement {
	if (forms.type === "suffix") {
		const newOptions: Record<string, { value: MessageFormatElement[] }> = {};
		for (const cat of CLDR_ORDINAL_ORDER) {
			const pattern = forms.suffixes[cat];
			if (pattern === undefined) continue;
			const poundIdx = pattern.indexOf("#");
			const parts: MessageFormatElement[] = [];
			if (poundIdx === -1) {
				parts.push({ type: TYPE.literal, value: pattern } as LiteralElement);
			} else {
				if (poundIdx > 0)
					parts.push({
						type: TYPE.literal,
						value: pattern.slice(0, poundIdx),
					} as LiteralElement);
				parts.push({ type: TYPE.pound });
				if (poundIdx < pattern.length - 1)
					parts.push({
						type: TYPE.literal,
						value: pattern.slice(poundIdx + 1),
					} as LiteralElement);
			}
			newOptions[cat] = { value: parts };
		}
		return { ...el, options: newOptions };
	}

	if (forms.type === "word") {
		const rank = values[el.value];
		if (typeof rank === "number") {
			const genderMap =
				forms.words["masculine"] ?? Object.values(forms.words)[0];
			const word = genderMap?.[rank];
			return {
				type: TYPE.literal,
				value: word ?? String(rank),
			} as LiteralElement;
		}
	}

	return el;
}

/**
 * Rewrite any embedded `selectordinal` nodes in an ICU string using
 * `ordinalForms` from the locale bundle, before passing the string to
 * `formatICU`.
 *
 * Returns `icu` unchanged when:
 * - the string contains no "selectordinal" substring (fast path — most strings)
 * - parsing throws (safe fallback to whatever formatICU receives)
 *
 * @param icu - Translated ICU string (may contain garbage ordinal branches from provider)
 * @param ordinalForms - Locale's ordinalForms from the compiled bundle
 * @param values - Runtime interpolation values (needed for word-based rank lookup)
 */
export function rewriteSelectordinalInICU(
	icu: string,
	ordinalForms: OrdinalForms,
	values: Record<string, any>,
): string {
	if (!icu.includes("selectordinal")) return icu;

	try {
		const ast = parse(icu, { captureLocation: false });
		const rewritten = rewriteElements(ast, ordinalForms, values);
		return printICU(rewritten);
	} catch {
		return icu;
	}
}
