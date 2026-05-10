import React from "react";
import type { ComponentSlot, TProps } from "./types";
import { ALL_CLDR, DEFAULT_ORDINAL_ICU, PLURAL_CLDR, applyOrdinalForms, buildPluralICU, buildSelectICU, formatICU, formatValue, generateMessageHash, rewriteSelectordinalInICU } from "@vocoder/core";
import { extractText } from "./utils/extractText";
import { formatElements } from "./utils/formatElements";
import { useVocoder } from "./VocoderProvider";

/**
 * Classify a rest prop key for plural/select mode detection.
 * Spread props are NEVER used as interpolation values — use the `values` prop instead.
 *
 * - "zero","one","two","few","many" or _N (digits) → plural category / exact match
 * - "other" → shared fallback (plural or select depending on context)
 * - _word (letters after underscore) → select case
 * - anything else → ignored (not used as interpolation — avoids collisions with reserved names)
 */
function classifyProp(key: string): "plural" | "select" | "other" | "ignore" {
	if (PLURAL_CLDR.has(key) || /^_\d+$/.test(key)) return "plural";
	if (key === "other") return "other";
	if (/^_[a-zA-Z]/.test(key)) return "select";
	return "ignore";
}


/** Translate and format message text in JSX. Supports three modes:
 *
 * **Interpolation** (default):
 * ```tsx
 * <T message="Hello {name}!" values={{ name }} />
 * <T>Hello {name}!</T>                    // natural syntax: build plugin injects message + values
 * <T id="welcome" message="Hello!" />     // key-based lookup
 * ```
 *
 * **Plural** (triggered by one/other/two/few/many props or _N exact matches):
 * ```tsx
 * <T value={count} _0="No items" one="# item" other="# items" />
 * ```
 *
 * **Select** (triggered by _word props without CLDR categories):
 * ```tsx
 * <T value={gender} _male="his" _female="her" other="their" />
 * ```
 */
export const T: React.FC<TProps> = ({
	id,
	children,
	message,
	context: _context,
	formality: _formality,
	components,
	values: valuesObj,
	value,
	ordinal,
	gender,
	format,
	currency,
	dateStyle,
	timeStyle,
	...rest
}) => {
	const { t, locale, locales, hasTranslation } = useVocoder();

	try {
		// Format mode: pure Intl formatting, no translation lookup
		if (format !== undefined && value !== undefined) {
			return <>{formatValue(value, format, locale, { currency, dateStyle, timeStyle })}</>;
		}

		// Collect plural/select mode props from rest.
		// Spread props are NOT used as interpolation values — use the `values` prop instead.
		// "other" is ambiguous: the required fallback in both plural and select modes.
		const pluralProps: Record<string, string> = {};
		const selectProps: Record<string, string> = {};
		let otherValue: string | undefined;

		for (const [key, val] of Object.entries(rest)) {
			const kind = classifyProp(key);
			if (kind === "plural" && typeof val === "string") {
				pluralProps[key] = val;
			} else if (kind === "select" && typeof val === "string") {
				selectProps[key] = val;
			} else if (kind === "other" && typeof val === "string") {
				otherValue = val;
			}
			// "ignore" — intentionally dropped. Use values={{ key: val }} for interpolation.
		}

		const hasPluralMode = Object.keys(pluralProps).length > 0;
		const hasSelectMode = !hasPluralMode && Object.keys(selectProps).length > 0;

		if (otherValue !== undefined) {
			if (hasPluralMode) pluralProps.other = otherValue;
			else if (hasSelectMode) selectProps.other = otherValue;
		}

		// Ordinal path — no suffix props needed.
		// Tier 1a: suffix-based ordinal forms (CLDR-based, guaranteed correct for 93+ languages).
		// Tier 1b: word-based ordinal forms (Arabic, Hebrew — ranks 1-100 from ordinalForms.words).
		// Tier 2:  translated ICU from bundle (probe-expanded selectordinal for uncovered locales).
		// Tier 3:  bare number fallback.
		if (ordinal && value !== undefined) {
			const rank = Number(value);
			const forms = locales?.[locale]?.ordinalForms;

			if (forms) {
				const result = applyOrdinalForms(rank, locale, forms, gender);
				if (result !== null) return <>{result}</>;
			}

			// Tier 2: ICU bundle lookup (locales without ordinalForms in the manifest)
			const ordinalValues = { count: value, ...(valuesObj ?? {}) };
			const lookupKey = id ?? generateMessageHash(DEFAULT_ORDINAL_ICU, _context);
			if (hasTranslation(lookupKey)) {
				return <>{formatICU(t(DEFAULT_ORDINAL_ICU, undefined, { id: lookupKey }), ordinalValues, locale)}</>;
			}
			return <>{String(value)}</>;
		}

		let sourceText: string;
		let formatValues: Record<string, any>;

		if (hasPluralMode && value !== undefined) {
			sourceText = buildPluralICU(pluralProps);
			formatValues = { count: value, ...(valuesObj ?? {}) };
		} else if (hasSelectMode && value !== undefined) {
			// Select mode: build ICU from _word props, value = value
			sourceText = buildSelectICU(selectProps);
			formatValues = { value, ...(valuesObj ?? {}) };
		} else {
			// Interpolation mode: values come exclusively from the `values` prop
			sourceText = message ?? extractText(children);
			formatValues = { ...(valuesObj ?? {}) };
		}

		// Lookup key: explicit id > content hash of sourceText.
		// Build transform injects id="hash" automatically for <T> with children.
		// For plural/select ICU built from props, we hash the ICU string.
		// Using hash keys keeps the wire payload small (7 chars vs full source string).
		// When a custom id is paired with formality, bake formality into the key so the
		// same id with different formality resolves to different bundle entries.
		const lookupKey = id
			? id + (_formality === "formal" || _formality === "informal" ? `\x05${_formality}` : "")
			: generateMessageHash(sourceText, _context, _formality);

		// Get translated text or fall back to source
		const rawText = hasTranslation(lookupKey) ? t(sourceText, undefined, { id: lookupKey }) : sourceText;

		// Rewrite any embedded selectordinal nodes using ordinalForms (Bug 1 fix).
		// The pipeline's ordinal DB fast path only applies to pure standalone
		// selectordinal strings; when selectordinal is embedded inside a larger
		// sentence the pipeline stored whatever the provider returned, which is
		// often wrong ("1el", "1th", "1الـ"). Rewrite before handing to formatICU.
		const ordinalForms = locales?.[locale]?.ordinalForms;
		const textToFormat =
			ordinalForms && rawText?.includes("selectordinal")
				? rewriteSelectordinalInICU(rawText, ordinalForms, formatValues)
				: rawText;

		// Nothing to format (id-only with no translation and no message)
		if (!textToFormat) {
			if (process.env.NODE_ENV === "development" && id) {
				console.warn(`[vocoder] Missing translation for key "${id}"`);
			}
			return <>{id ?? children ?? null}</>;
		}

		// Hoist React elements out of formatValues into component slots.
		// Allows <T message="Click {icon} here" values={{ icon: <Icon /> }} /> to
		// render correctly — {icon} is replaced with a <N/> placeholder so it
		// passes through formatICU as literal text and lands in formatElements.
		let activeText = textToFormat;
		let activeValues = formatValues;
		let activeComponents: ComponentSlot[] | Record<number, ComponentSlot> | undefined =
			components;

		const reactElementKeys = Object.keys(formatValues).filter((k) =>
			React.isValidElement(formatValues[k]),
		);
		if (reactElementKeys.length > 0) {
			const baseIdx = activeComponents == null
				? 0
				: Array.isArray(activeComponents)
					? activeComponents.length
					: Object.keys(activeComponents).length === 0
						? 0
						: Math.max(...Object.keys(activeComponents).map(Number)) + 1;
			const extra: Record<number, ComponentSlot> = {};
			activeValues = { ...formatValues };
			for (let i = 0; i < reactElementKeys.length; i++) {
				const key = reactElementKeys[i]!;
				const slotIdx = baseIdx + i;
				extra[slotIdx] = formatValues[key] as ComponentSlot;
				delete activeValues[key];
				// Replace {key} in the translated text with a self-closing component placeholder.
				activeText = activeText.replace(
					new RegExp(`\\{${key}\\}`, "g"),
					`<${slotIdx}/>`,
				);
			}
			activeComponents = { ...(activeComponents ?? {}), ...extra };
		}

		// ICU formatting: variables, plural, select, number, date
		const icuFormatted = formatICU(activeText, activeValues, locale);

		// Component rendering: <N> placeholders → React elements
		const hasComponents =
			activeComponents != null &&
			(Array.isArray(activeComponents)
				? activeComponents.length > 0
				: Object.keys(activeComponents).length > 0);
		if (hasComponents) {
			return <>{formatElements(icuFormatted, activeComponents!)}</>;
		}

		return <>{icuFormatted}</>;
	} catch (err) {
		console.error("Vocoder formatting error:", err);
		return <>{children}</>;
	}
};

T.displayName = "Vocoder.T";
