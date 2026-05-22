import React from "react";
import type { ComponentSlot } from "../types";

// Matches <0>content</0> (paired) or <0/> (self-closing).
// Backreference \1 ensures the closing digit matches the opening digit.
const TAG_RE = /<(\d+)>([\s\S]*?)<\/\1>|<(\d+)\/>/g;

/**
 * Replaces numeric component placeholders in a translated message with React elements.
 *
 * Slots are looked up by numeric index: `components[idx]`. Both array and sparse
 * object forms work because JavaScript coerces numeric object keys identically.
 *
 * Slot rendering:
 * - ReactElement slot: children are injected via React.cloneElement.
 * - Function slot: receives translated inner content as ReactNode, returns ReactNode.
 *   Useful when the wrapper element needs dynamic props derived from the content.
 *
 * Unknown indices (no matching slot) are rendered as literal tag text.
 * Nested placeholders are resolved recursively, so `<0><1>text</1></0>` works.
 *
 * @param message  ICU-formatted string containing `<N>` / `<N/>` placeholders.
 * @param components  Slot array or sparse object keyed by placeholder index.
 */
export function formatElements(
	message: string,
	components: ComponentSlot[] | Record<number, ComponentSlot>,
): React.ReactNode[] {
	const result: React.ReactNode[] = [];
	const re = new RegExp(TAG_RE.source, "g");
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	// biome-ignore lint/suspicious/noAssignInExpressions: standard RegExp exec loop — assignment in condition is idiomatic here
	while ((match = re.exec(message)) !== null) {
		if (match.index > lastIndex) {
			result.push(message.slice(lastIndex, match.index));
		}

		const pairedIndex = match[1];
		const innerContent = match[2];
		const selfClosingIndex = match[3];
		const idx = parseInt((pairedIndex ?? selfClosingIndex)!, 10);
		const slot = (components as Record<number, ComponentSlot>)[idx];

		if (!slot) {
			// No matching slot — render placeholder text literally so content is not lost.
			result.push(match[0]);
		} else if (typeof slot === "function") {
			const inner = innerContent ? formatElements(innerContent, components) : [];
			const children: React.ReactNode =
				inner.length === 0
					? undefined
					: inner.length === 1
						? inner[0]
						: React.createElement(React.Fragment, null, ...inner);
			result.push(
				React.createElement(React.Fragment, { key: idx }, slot(children)),
			);
		} else if (selfClosingIndex !== undefined) {
			result.push(React.cloneElement(slot, { key: idx }));
		} else {
			const inner = innerContent ? formatElements(innerContent, components) : [];
			result.push(React.cloneElement(slot, { key: idx }, ...inner));
		}

		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < message.length) {
		result.push(message.slice(lastIndex));
	}

	return result;
}
