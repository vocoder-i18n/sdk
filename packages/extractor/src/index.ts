import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative as pathRelative } from "node:path";
import { parse } from "@babel/parser";
import babelTraverse from "@babel/traverse";
import { glob } from "glob";
import { generateMessageHash } from "./hash";

export { generateMessageHash } from "./hash";
export { loadVocoderConfig, parseVocoderConfig } from "./config";
export type { VocoderConfig } from "./config";

/**
 * Content-hash fingerprint for a set of source keys.
 *
 * Formula: sha256(appShortCode + ":" + sorted(sourceKeys).join('\0')).slice(0, 12)
 *
 * Input must be source keys (not source texts) so that two strings with the
 * same text but different formality or context produce different fingerprints.
 * Pure function of source content — no git state, no CI env vars.
 * appShortCode isolates fingerprints across apps in the same monorepo.
 */
export function computeFingerprint(
	appShortCode: string,
	sourceKeys: string[],
): string {
	const sorted = [...sourceKeys].sort();
	return createHash("sha256")
		.update(`${appShortCode}:${sorted.join("\0")}`)
		.digest("hex")
		.slice(0, 12);
}

/**
 * Deduplicate extracted strings by key, keeping the first occurrence.
 * Keys are deterministic (same text+context → same hash) so first-wins is stable.
 */
export function deduplicateByKey<T extends { key: string }>(items: T[]): T[] {
	const seen = new Set<string>();
	const unique: T[] = [];
	for (const item of items) {
		if (!seen.has(item.key)) {
			seen.add(item.key);
			unique.push(item);
		}
	}
	return unique;
}

// Handle default export difference between ESM and CommonJS
const traverse = (babelTraverse as any).default || babelTraverse;

// Unambiguous plural CLDR categories. "other" is excluded — it's also the
// required fallback in select mode, so it can't determine mode on its own.
const PLURAL_CLDR = new Set(["zero", "one", "two", "few", "many"]);
// Full set used only by buildPluralICU/buildSelectICU where mode is already known.
const ALL_CLDR = new Set(["zero", "one", "two", "few", "many", "other"]);

export interface ExtractedString {
	key: string;
	/** Source text. null for id-only entries (<T id="key" /> with no message or children). */
	text: string | null;
	file: string;
	line: number;
	context?: string;
	formality?: "formal" | "informal" | "neutral" | "auto";
	/** Detected UI role from JSX parent element or prop. e.g. "button_label", "heading", "input_placeholder" */
	uiRole?: string;
}

export interface TransformResult {
	code: string;
	changed: boolean;
}

/**
 * Default ordinal ICU — locale-neutral structural placeholder used as the extraction
 * key and bundle lookup key for <T value={rank} ordinal /> components.
 *
 * Uses a minimal single-branch form so the stored ICU carries no source-language
 * ordinal suffixes. The actual ordinal form is resolved at runtime:
 *   Tier 1 — ordinalForms.suffixes/words from the compiled bundle (covers 93+ languages)
 *   Tier 2 — this key's bundle translation (provider returns `other {#}` unchanged;
 *             formatICU evaluates it to String(rank), same as Tier 3)
 *   Tier 3 — String(rank) fallback
 *
 * Must stay byte-for-byte identical to DEFAULT_ORDINAL_ICU in @vocoder/react/src/T.tsx.
 */
export const DEFAULT_ORDINAL_ICU = "{count, selectordinal, other {#}}";

/**
 * Build a plural or ordinal ICU string from plural prop key/value pairs.
 * Exact matches (_0, _1) come before CLDR categories (one, other, etc.).
 * Internal variable name is always "count" for consistent lookup keys.
 * Must stay byte-for-byte identical to buildPluralICU in @vocoder/react/src/T.tsx.
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
 * Must stay byte-for-byte identical to buildSelectICU in @vocoder/react/src/T.tsx.
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
			if (wordCase) {
				cases.push(`${wordCase[1]} {${text}}`);
			}
		}
	}

	if (!hasOther) cases.push("other {other}");

	return `{value, select, ${cases.join(" ")}}`;
}

/**
 * Mutable context threaded through extractTextContentFromNodes.
 *
 * elementCount      — tracks which numeric index the next JSX element child gets (<0>, <1>, …).
 * complexCount      — tracks which positional index the next complex expression gets ({0}, {1}, …).
 * namedVars         — all simple identifier names found (e.g. `{count}` → "count").
 * complexExprs      — source positions of complex expressions mapped to their positional key.
 *                     Used by transformMsgProps to reconstruct the values prop verbatim from source.
 * bail              — set to true when an unsupported expression is detected (nested <T>,
 *                     conditional/logical inside template literal). Caller must abort extraction.
 * tComponentNames   — names the T component is imported as; used to detect nested <T> elements.
 */
interface ExtractContext {
	elementCount: number;
	complexCount: number;
	namedVars: Set<string>;
	complexExprs: Array<{ key: number; start: number; end: number }>;
	bail: boolean;
	tComponentNames: Set<string>;
}

/**
 * Recursively extracts ICU template text from JSX children.
 *
 * - JSXText                  → literal text
 * - {identifier}             → named ICU arg `{name}` (added to ctx.namedVars)
 * - {42} / {3.14}            → inlined as literal string (not a placeholder)
 * - {true} / {false} / {null}→ skipped (render nothing meaningful)
 * - {user.name} / {call()}   → positional arg `{0}` (added to ctx.complexExprs)
 * - {a ? b : c} / {a && b}   → sets ctx.bail = true (caller must abort — use plural/select instead)
 * - "string literal"         → inline literal value
 * - `template ${count}`      → quasis as-is; Identifier expressions named, others positional
 * - <JSXElement>text</JSXElement> → `<N>text</N>` (numeric tag; preprocessor normalises to
 *                               `<cN>` before ICU parse, restores after translation)
 * - <T>...</T>               → sets ctx.bail = true (outer T bails; inner T extracts independently)
 */
function extractTextContentFromNodes(
	children: any[],
	ctx: ExtractContext,
): string {
	let text = "";

	for (const child of children) {
		if (ctx.bail) return text;

		if (child.type === "JSXText") {
			text += child.value;
		} else if (child.type === "JSXExpressionContainer") {
			const expr = child.expression;
			if (expr.type === "Identifier") {
				ctx.namedVars.add(expr.name);
				text += `{${expr.name}}`;
			} else if (expr.type === "StringLiteral") {
				text += expr.value;
			} else if (expr.type === "NumericLiteral") {
				text += String(expr.value);
			} else if (expr.type === "BooleanLiteral" || expr.type === "NullLiteral") {
				// skip — not translation content
			} else if (expr.type === "TemplateLiteral") {
				for (let i = 0; i < expr.quasis.length; i++) {
					text += expr.quasis[i].value.raw;
					if (i < expr.expressions.length) {
						const e = expr.expressions[i];
						if (e.type === "Identifier") {
							ctx.namedVars.add(e.name);
							text += `{${e.name}}`;
						} else if (e.type === "NumericLiteral") {
							text += String(e.value);
						} else if (e.type === "BooleanLiteral" || e.type === "NullLiteral") {
							// skip
						} else if (
							e.type === "ConditionalExpression" ||
							e.type === "LogicalExpression"
						) {
							// Conditional inside template literal — untranslatable.
							ctx.bail = true;
							return text;
						} else {
							// Complex expression inside template literal — positional placeholder.
							const key = ctx.complexCount++;
							ctx.complexExprs.push({ key, start: e.start, end: e.end });
							text += `{${key}}`;
						}
					}
				}
			} else if (
				expr.type === "ConditionalExpression" ||
				expr.type === "LogicalExpression"
			) {
				// Untranslatable — a conditional produces different strings depending on runtime state.
				ctx.bail = true;
				return text;
			} else {
				// Complex expression (MemberExpression, CallExpression, etc.) — positional placeholder.
				// Catalog stays stable if the expression is renamed or refactored.
				const key = ctx.complexCount++;
				ctx.complexExprs.push({ key, start: expr.start, end: expr.end });
				text += `{${key}}`;
			}
		} else if (child.type === "JSXElement") {
			const childTagName =
				child.openingElement.name.type === "JSXIdentifier"
					? child.openingElement.name.name
					: null;
			if (childTagName && ctx.tComponentNames.has(childTagName)) {
				// Nested T — outer T bails; inner T is extracted independently by the traversal.
				ctx.bail = true;
				return text;
			}
			const idx = ctx.elementCount++;
			const isSelfClosing = child.openingElement.selfClosing;
			if (isSelfClosing) {
				text += `<${idx}/>`;
			} else {
				const innerText = extractTextContentFromNodes(child.children, ctx);
				text += `<${idx}>${innerText}</${idx}>`;
			}
		}
	}

	return text;
}

/**
 * Transform JSX source files to inject `message` props on <T> components
 * that have dynamic identifier children but no explicit message/msg prop.
 *
 * This enables the natural authoring syntax:
 *   <T count={count}>You have {count} items</T>
 * to work correctly at runtime by injecting:
 *   <T count={count} message="You have {count} items">You have {count} items</T>
 *
 * Uses targeted string insertion (no code regeneration) so original formatting
 * is fully preserved and source maps remain accurate.
 *
 * Skips:
 * - Elements that already have message or msg prop
 * - Elements in plural/select mode (one/other/_0/_male props)
 * - Elements with no JSX expression identifier children (static text, ICU strings, ternaries)
 * - Files that don't import T from @vocoder/react
 *
 * Future framework expansion:
 * - Vue (.vue): add transformVueT() branch — needs @vue/compiler-sfc parser,
 *   converts {{ count }} template syntax to {count} placeholders
 * - Svelte (.svelte): add transformSvelteT() branch — svelte uses {count} natively,
 *   needs svelte/compiler parser for SFC structure
 * - Solid (.jsx/.tsx): same Babel parser, different import source (@vocoder/solid)
 * All frameworks share the same lookup-key convention (message prop + values object)
 * so extraction and runtime are identical regardless of framework.
 */
export function transformMsgProps(code: string): TransformResult {
	if (!code.includes("@vocoder/react")) return { code, changed: false };

	let ast: any;
	try {
		ast = parse(code, {
			sourceType: "module",
			plugins: ["jsx", "typescript"],
		});
	} catch {
		return { code, changed: false };
	}

	const tComponentNames = new Set<string>();

	traverse(ast, {
		ImportDeclaration(path: any) {
			if (path.node.source.value !== "@vocoder/react") return;
			for (const spec of path.node.specifiers) {
				if (
					spec.type === "ImportSpecifier" &&
					spec.imported.type === "Identifier" &&
					spec.imported.name === "T"
				) {
					tComponentNames.add(spec.local.name);
				}
			}
		},
	});

	if (tComponentNames.size === 0) return { code, changed: false };

	interface Insertion {
		position: number;
		text: string;
	}
	const insertions: Insertion[] = [];

	traverse(ast, {
		JSXElement(path: any) {
			const opening = path.node.openingElement;
			const tagName =
				opening.name.type === "JSXIdentifier" ? opening.name.name : null;
			if (!tagName || !tComponentNames.has(tagName)) return;

			// Skip if already has message prop
			const hasMessageProp = opening.attributes.some(
				(attr: any) =>
					attr.type === "JSXAttribute" && attr.name.name === "message",
			);
			if (hasMessageProp) return;

			// Skip if in plural/select mode (has CLDR, _N, or _word props)
			const hasPluralSelectProps = opening.attributes.some((attr: any) => {
				if (attr.type !== "JSXAttribute") return false;
				const n = attr.name.name;
				return ALL_CLDR.has(n) || /^_\d+$/.test(n) || /^_[a-zA-Z]/.test(n);
			});
			if (hasPluralSelectProps) return;

			// Bail early on conditional/logical direct children — untranslatable as a unit.
			const hasBailingExpr = path.node.children.some(
				(child: any) =>
					child.type === "JSXExpressionContainer" &&
					(child.expression.type === "ConditionalExpression" ||
						child.expression.type === "LogicalExpression"),
			);
			if (hasBailingExpr) {
				const line = path.node.loc?.start.line ?? "?";
				console.warn(
					`[vocoder] Conditional/logical expression in <T> at line ${line} — extract outside: {cond ? <T>A</T> : <T>B</T>}`,
				);
				return;
			}

			// Collect top-level JSX element positions for the components prop.
			// Only top-level children are included — nested elements inside a parent
			// JSX element are bundled inside the parent's rendered output.
			interface ElementInfo {
				openingStart: number;
				openingEnd: number;
				selfClosing: boolean;
			}
			const jsxElements: ElementInfo[] = [];
			for (const child of path.node.children) {
				if (child.type === "JSXElement") {
					jsxElements.push({
						openingStart: child.openingElement.start,
						openingEnd: child.openingElement.end,
						selfClosing: child.openingElement.selfClosing,
					});
				}
			}

			// Extract template text and collect named/complex variable metadata.
			const ctx: ExtractContext = {
				elementCount: 0,
				complexCount: 0,
				namedVars: new Set(),
				complexExprs: [],
				bail: false,
				tComponentNames,
			};
			const template = extractTextContentFromNodes(path.node.children, ctx).trim();
			if (ctx.bail) {
				const line = path.node.loc?.start.line ?? "?";
				console.warn(
					`[vocoder] Unsupported expression in <T> at line ${line} — could not extract template.`,
				);
				return;
			}
			if (!template) return;

			// Nothing dynamic to inject — skip static-only strings (runtime extractText handles them).
			if (ctx.namedVars.size === 0 && jsxElements.length === 0 && ctx.complexExprs.length === 0) return;

			const escaped = template.replace(/"/g, "&quot;");
			const hash = generateMessageHash(template);

			// Build insertion text: id, message, optional values, optional components
			let insertText = ` id="${hash}" message="${escaped}"`;

			// Named vars use shorthand { count, name }; complex exprs use positional { 0: user.name }.
			const valuesParts: string[] = [
				...[...ctx.namedVars],
				...ctx.complexExprs.map(
					({ key, start, end }) => `${key}: ${code.slice(start, end)}`,
				),
			];
			if (valuesParts.length > 0) {
				insertText += ` values={{ ${valuesParts.join(", ")} }}`;
			}

			if (jsxElements.length > 0) {
				// Reconstruct each JSX element as self-closing using source positions
				const componentParts = jsxElements.map(
					({ openingStart, openingEnd, selfClosing }) => {
						const openingTag = code.slice(openingStart, openingEnd);
						if (selfClosing) return openingTag;
						// Strip trailing > and make self-closing
						return openingTag.slice(0, -1).trimEnd() + " />";
					},
				);
				insertText += ` components={[${componentParts.join(", ")}]}`;
			}

			const insertPos = opening.end - 1;
			insertions.push({ position: insertPos, text: insertText });
		},
	});

	if (insertions.length === 0) return { code, changed: false };

	// Apply in reverse order so earlier positions aren't shifted
	insertions.sort((a, b) => b.position - a.position);
	let result = code;
	for (const { position, text } of insertions) {
		result = result.slice(0, position) + text + result.slice(position);
	}

	return { code: result, changed: true };
}

/**
 * Extract translatable strings from a single file given its filename and content.
 * Pure function — no filesystem access. Use this when content is already in memory
 * (e.g. fetched from GitHub API in a webhook pipeline).
 *
 * Handles:
 *   - <T message="…"> JSX components (and ICU plural/select/ordinal props)
 *   - t(text, values, options) function calls (options at argument[2])
 *   - useVocoder() destructured t function
 * Keys are content-hash based (generateMessageHash) — stable across files and machines.
 */
export function extractFromContent(
	filename: string,
	content: string,
): ExtractedString[] {
	return _extractFromContent(filename, content);
}

export class StringExtractor {
	async extractFromProject(
		pattern: string | string[],
		projectRoot: string = process.cwd(),
		excludePattern?: string | string[],
	): Promise<ExtractedString[]> {
		const includePatterns = Array.isArray(pattern) ? pattern : [pattern];

		const defaultIgnore = [
			"**/node_modules/**",
			"**/.next/**",
			"**/dist/**",
			"**/build/**",
		];

		const ignorePatterns = excludePattern
			? [
					...defaultIgnore,
					...(Array.isArray(excludePattern)
						? excludePattern
						: [excludePattern]),
				]
			: defaultIgnore;

		const allFiles = new Set<string>();

		for (const includePattern of includePatterns) {
			const files = await glob(includePattern, {
				cwd: projectRoot,
				absolute: true,
				ignore: ignorePatterns,
			});

			for (const file of files) allFiles.add(file);
		}

		const allStrings: ExtractedString[] = [];
		const sortedFiles = Array.from(allFiles).sort();

		for (const file of sortedFiles) {
			try {
				const code = readFileSync(file, "utf-8");
				const relPath = pathRelative(projectRoot, file).split("\\").join("/");
				const strings = _extractFromContent(relPath, code);
				allStrings.push(...strings);
			} catch (error) {
				console.warn(`Warning: Failed to extract from ${file}:`, error);
			}
		}

		return deduplicateStrings(allStrings);
	}
}

// ---------------------------------------------------------------------------
// uiRole detection
// ---------------------------------------------------------------------------

/**
 * Map a JSX prop name to a uiRole enum value.
 * Called when <T> (or t()) is used as the value of a JSX attribute.
 */
function propNameToUiRole(propName: string): string {
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
function elementNameToUiRole(name: string): string {
	if (!name) return "unknown";
	switch (name.toLowerCase()) {
		case "button": return "button_label";
		case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": return "heading";
		case "label": return "input_label";
		case "th": return "table_header";
		case "option": return "option_label";
		case "title": return "page_title";
		case "p": case "li": case "dd": return "body_text";
		// Custom component name heuristics
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
function detectUiRole(path: any): string {
	const parent = path.parent;
	if (!parent) return "unknown";

	// Tier 1: prop context — <input placeholder={<T>…</T>} />
	// <T> JSXElement is wrapped in a JSXExpressionContainer which is a JSXAttribute
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

// ---------------------------------------------------------------------------
// Module-level implementation — shared by extractFromContent() and StringExtractor
// ---------------------------------------------------------------------------

function _extractFromContent(
	filePath: string,
	content: string,
): ExtractedString[] {
		const strings: ExtractedString[] = [];

		try {
			const ast = parse(content, {
				sourceType: "module",
				plugins: ["jsx", "typescript"],
			});

			const vocoderImports = new Map<string, string>();
			const tFunctionNames = new Set<string>();

			traverse(ast, {
				ImportDeclaration: (path: any) => {
					const source = path.node.source.value;

					if (source === "@vocoder/react") {
						path.node.specifiers.forEach((spec: any) => {
							if (spec.type === "ImportSpecifier") {
								const imported =
									spec.imported.type === "Identifier"
										? spec.imported.name
										: null;
								const local = spec.local.name;

								if (imported === "T") {
									vocoderImports.set(local, "T");
								}
								if (imported === "t") {
									tFunctionNames.add(local);
								}
							}
						});
					}
				},

				VariableDeclarator: (path: any) => {
					const init = path.node.init;

					if (
						init &&
						init.type === "CallExpression" &&
						init.callee.type === "Identifier" &&
						init.callee.name === "useVocoder" &&
						path.node.id.type === "ObjectPattern"
					) {
						path.node.id.properties.forEach((prop: any) => {
							if (
								prop.type === "ObjectProperty" &&
								prop.key.type === "Identifier" &&
								prop.key.name === "t"
							) {
								const localName =
									prop.value.type === "Identifier" ? prop.value.name : "t";
								tFunctionNames.add(localName);
							}
						});
					}
				},

				CallExpression: (path: any) => {
					const callee = path.node.callee;

					const isTFunction =
						callee.type === "Identifier" && tFunctionNames.has(callee.name);

					if (!isTFunction) return;

					const firstArg = path.node.arguments[0];
					if (!firstArg) return;

					let text: string | null = null;

					if (firstArg.type === "StringLiteral") {
						text = firstArg.value;
					} else if (firstArg.type === "TemplateLiteral") {
						text = extractTemplateText(firstArg);
					}

					if (!text || text.trim().length === 0) return;

					// arguments[1] = values, arguments[2] = options { context, formality, id }
					const optionsArg = path.node.arguments[2];
					let context: string | undefined;
					let formality:
						| "formal"
						| "informal"
						| "neutral"
						| "auto"
						| undefined;
					let explicitKey: string | undefined;

					if (optionsArg && optionsArg.type === "ObjectExpression") {
						optionsArg.properties.forEach((prop: any) => {
							if (
								prop.type === "ObjectProperty" &&
								prop.key.type === "Identifier"
							) {
								if (
									prop.key.name === "context" &&
									prop.value.type === "StringLiteral"
								) {
									context = prop.value.value;
								}
								if (
									prop.key.name === "formality" &&
									prop.value.type === "StringLiteral"
								) {
									formality = prop.value.value as
										| "formal"
										| "informal"
										| "neutral"
										| "auto";
								}
								if (
									prop.key.name === "id" &&
									prop.value.type === "StringLiteral"
								) {
									explicitKey = prop.value.value.trim();
								}
							}
						});
					}

					const line = path.node.loc?.start.line || 0;
					// When a custom id is paired with formality, bake formality into the key
					// so the same id with different formality resolves to different translations.
					const key =
						explicitKey && explicitKey.length > 0
							? explicitKey + (formality === "formal" || formality === "informal" ? `\x05${formality}` : "")
							: generateMessageHash(text.trim(), context, formality);
					const uiRole = detectUiRole(path);

					strings.push({
						key,
						text: text.trim(),
						file: filePath,
						line,
						context,
						formality,
						uiRole: uiRole !== "unknown" ? uiRole : undefined,
					});
				},

				JSXElement: (path: any) => {
					const opening = path.node.openingElement;
					const tagName =
						opening.name.type === "JSXIdentifier" ? opening.name.name : null;

					if (!tagName) return;

					const isTranslationComponent = vocoderImports.has(tagName);
					if (!isTranslationComponent) return;

					const msgAttribute =
						getStringAttribute(opening.attributes, "message");

					let text: string | null = null;

					if (msgAttribute) {
						text = msgAttribute;
					} else {
						// Check for plural/select mode props
						const pluralSelectICU = extractPluralSelectICU(opening.attributes);
						if (pluralSelectICU) {
							text = pluralSelectICU;
						} else {
							const extractCtx = {
								elementCount: 0,
								complexCount: 0,
								namedVars: new Set<string>(),
								complexExprs: [] as Array<{ key: number; start: number; end: number }>,
								bail: false,
								tComponentNames: new Set(vocoderImports.keys()),
							};
							text = extractTextContentFromNodes(path.node.children, extractCtx);
							if (extractCtx.bail) return;
						}
					}

					const id = getStringAttribute(opening.attributes, "id");
					const context = getStringAttribute(opening.attributes, "context");
					const formality = getStringAttribute(
						opening.attributes,
						"formality",
					) as "formal" | "informal" | "neutral" | "auto" | undefined;

					const trimmedId = id?.trim() || undefined;
					const trimmedText = text?.trim() || undefined;

					// Require either text content or an explicit id. id-only entries (<T id="x" />)
					// are valid — their source text comes from a localesPath file at translation time.
					if (!trimmedText && !trimmedId) return;

					// When a custom id is paired with formality, bake formality into the key
					// so the same id with different formality resolves to different translations.
					const line = path.node.loc?.start.line || 0;
					const key = trimmedId
						? trimmedId + (formality === "formal" || formality === "informal" ? `\x05${formality}` : "")
						: generateMessageHash(trimmedText!, context, formality);
					const uiRole = detectUiRole(path);

					strings.push({
						key,
						text: trimmedText ?? null,
						file: filePath,
						line,
						context,
						formality,
						uiRole: uiRole !== "unknown" ? uiRole : undefined,
					});
				},
			});
		} catch (error) {
			throw new Error(
				`Failed to parse ${filePath}: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		}

		return strings;
}

function extractPluralSelectICU(attributes: any[]): string | null {
		const pluralProps: Record<string, string> = {};
		const selectProps: Record<string, string> = {};
		let otherValue: string | undefined;
		let hasPlural = false;
		let hasSelect = false;
		let isOrdinal = false;
		let hasGender = false;

		for (const attr of attributes) {
			if (attr.type !== "JSXAttribute") continue;
			const name = attr.name.name as string;

			// Boolean `ordinal` prop — no value means true
			if (name === "ordinal") {
				isOrdinal = true;
				continue;
			}

			// `gender` prop — marks ordinal as gender-aware (dynamic value, not a string literal)
			if (name === "gender") {
				hasGender = true;
				continue;
			}

			const value =
				attr.value?.type === "StringLiteral" ? attr.value.value : null;
			if (!value) continue;

			if (PLURAL_CLDR.has(name) || /^_\d+$/.test(name)) {
				pluralProps[name] = value;
				hasPlural = true;
			} else if (name === "other") {
				otherValue = value;
			} else if (/^_[a-zA-Z]/.test(name)) {
				selectProps[name] = value;
				hasSelect = true;
			}
		}

		// Ordinal prop: generate default English ICU — developer writes nothing, pipeline handles locale patterns.
		// When gender prop present, wrap in gender select so the hash reflects gender-aware usage.
		if (isOrdinal) {
			const ordinalICU = "{count, selectordinal, other {#}}"; // locale-neutral; ordinal form resolved at runtime via ordinalForms
			if (hasGender) {
				// Wrap in gender select: runtime selects word form based on dynamic gender value.
				// Masculine/feminine/other all carry same English ordinal ICU (used only as Tier 2 fallback).
				return `{gender, select, masculine {${ordinalICU}} feminine {${ordinalICU}} other {${ordinalICU}}}`;
			}
			return ordinalICU;
		}

		if (!hasPlural && !hasSelect) return null;

		if (hasPlural) {
			if (otherValue !== undefined) pluralProps.other = otherValue;
			return buildPluralICU(pluralProps, false);
		}
		if (hasSelect) {
			if (otherValue !== undefined) selectProps.other = otherValue;
			return buildSelectICU(selectProps);
		}
		return null;
	}

function extractTemplateText(node: any): string {
	let text = "";

	for (let i = 0; i < node.quasis.length; i++) {
		const quasi = node.quasis[i];
		text += quasi.value.raw;

		if (i < node.expressions.length) {
			const expr = node.expressions[i];
			if (expr.type === "Identifier") {
				text += `{${expr.name}}`;
			} else {
				text += "{value}";
			}
		}
	}

	return text;
}

function getStringAttribute(
	attributes: any[],
	name: string,
): string | undefined {
	const attr = attributes.find(
		(a: any) => a.type === "JSXAttribute" && a.name.name === name,
	);

	if (!attr || !attr.value) return undefined;

	if (attr.value.type === "StringLiteral") {
		return attr.value.value;
	}

	if (attr.value.type === "JSXExpressionContainer") {
		const expr = attr.value.expression;

		if (expr.type === "TemplateLiteral") {
			return extractTemplateText(expr);
		}

		if (expr.type === "StringLiteral") {
			return expr.value;
		}
	}

	return undefined;
}

function deduplicateStrings(strings: ExtractedString[]): ExtractedString[] {
	// Content-hash keys are deterministic: same text+context → same key everywhere.
	// Dedup by key — keeps the first occurrence.
	const seen = new Set<string>();
	const unique: ExtractedString[] = [];
	for (const str of strings) {
		if (!seen.has(str.key)) {
			seen.add(str.key);
			unique.push(str);
		}
	}
	return unique;
}
