/**
 * Map a JSX prop name to a uiRole enum value.
 * Called when <T> (or t()) is used as the value of a JSX attribute.
 */
export function propNameToUiRole(propName: string): string {
	switch (propName) {
		case "placeholder": return "input_placeholder";
		case "aria-label":
		case "aria-description":
		case "label": return "input_label";
		case "alt": return "image_alt";
		case "title": return "tooltip";
		default: return "unknown";
	}
}

/**
 * Map a native HTML element or custom component name to a uiRole.
 * Handles native elements exactly, and falls back to name heuristics for
 * custom components.
 */
export function elementNameToUiRole(name: string): string {
	if (!name) return "unknown";
	switch (name.toLowerCase()) {
		case "button": return "button_label";
		case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return "heading";
		case "label": return "input_label";
		case "th": return "table_header";
		case "option": return "option_label";
		case "title": return "page_title";
		case "p": case "li": case "dd": return "body_text";
		default: {
			const lower = name.toLowerCase();
			if (/button|btn|submit|cta/.test(lower)) return "button_label";
			if (/heading|headline/.test(lower)) return "heading";
			if (/label/.test(lower)) return "input_label";
			if (/tooltip|hint|popover/.test(lower)) return "tooltip";
			if (/badge|chip|tag|pill/.test(lower)) return "badge";
			if (/toast|snackbar|notification/.test(lower)) return "toast";
			if (/navitem|menuitem/.test(lower)) return "nav_item";
			return "unknown";
		}
	}
}

/**
 * Detect the uiRole for a <T> JSXElement or t() CallExpression from its
 * position in the JSX tree.
 *
 * Detection tiers (in priority order):
 *  1. Prop context  — T is the value of a JSX attribute (placeholder, alt, etc.)
 *  2. Native parent — T is a child of a known HTML element
 *  3. Component heuristics — parent is a custom component with a recognisable name
 *  4. unknown — fallback
 */
export function detectUiRole(path: any): string {
	const parent = path.parent;
	if (!parent) return "unknown";

	// Tier 1: prop context — <input placeholder={<T>…</T>} />
	if (parent.type === "JSXExpressionContainer") {
		const attrNode = path.parentPath?.parent;
		if (attrNode?.type === "JSXAttribute") {
			const propName: string =
				attrNode.name?.type === "JSXNamespacedName"
					? `${attrNode.name.namespace.name}-${attrNode.name.name.name}`
					: (attrNode.name?.name ?? "");
			return propNameToUiRole(propName);
		}
	}

	// Tier 2 & 3: parent JSX element
	if (parent.type === "JSXElement") {
		const opening = parent.openingElement;
		const tagName: string =
			opening?.name?.type === "JSXMemberExpression"
				? "unknown"
				: (opening?.name?.name ?? "");
		return elementNameToUiRole(tagName);
	}

	return "unknown";
}
