import * as babel from "@babel/core";
import * as t from "@babel/types";
import { generateMessageHash } from "@vocoder/core";
import { ALL_CLDR } from "./icu-builders";

export interface TransformResult {
	code: string;
	changed: boolean;
}

/**
 * Mutable context threaded through extractTextContentFromNodes.
 *
 * elementCount      — tracks which numeric index the next JSX element child gets (<0>, <1>, …).
 * complexCount      — tracks which positional index the next complex expression gets ({0}, {1}, …).
 * namedVars         — all simple identifier names found (e.g. `{count}` → "count").
 * complexExprs      — complex expression AST nodes mapped to their positional key.
 *                     Used by transformMsgProps to build the values prop from the original nodes.
 * bail              — set to true when an unsupported expression is detected (nested <T>,
 *                     conditional/logical inside template literal). Caller must abort extraction.
 * tComponentNames   — names the T component is imported as; used to detect nested <T> elements.
 */
export interface ExtractContext {
	elementCount: number;
	complexCount: number;
	namedVars: Set<string>;
	complexExprs: Array<{ key: number; node: t.Expression }>;
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
export function extractTextContentFromNodes(
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
							ctx.complexExprs.push({ key, node: e as t.Expression });
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
				const key = ctx.complexCount++;
				ctx.complexExprs.push({ key, node: expr as t.Expression });
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
 * that have dynamic identifier children but no explicit message prop.
 *
 * This enables the natural authoring syntax:
 *   <T count={count}>You have {count} items</T>
 * to work correctly at runtime by injecting:
 *   <T count={count} id="abc123" message="You have {count} items">You have {count} items</T>
 *
 * Uses babel.transformAsync() with a Babel plugin visitor so AST mutations are correct
 * and inline source maps are generated automatically.
 *
 * Skips:
 * - Elements that already have message prop
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
export async function transformMsgProps(
	code: string,
	filename?: string,
): Promise<TransformResult> {
	if (!code.includes("@vocoder/react")) return { code, changed: false };

	let changed = false;

	let result: babel.BabelFileResult | null;
	try {
		result = await babel.transformAsync(code, {
			filename,
			configFile: false,
			babelrc: false,
			parserOpts: { plugins: ["jsx", "typescript"] },
			sourceMaps: "inline",
			plugins: [
				(): babel.PluginObj => {
					const tComponentNames = new Set<string>();

					return {
						visitor: {
							ImportDeclaration(path) {
								if (path.node.source.value !== "@vocoder/react") return;
								for (const spec of path.node.specifiers) {
									if (
										t.isImportSpecifier(spec) &&
										t.isIdentifier(spec.imported) &&
										spec.imported.name === "T"
									) {
										tComponentNames.add(spec.local.name);
									}
								}
							},

							JSXElement(path) {
								if (tComponentNames.size === 0) return;

								const opening = path.node.openingElement;
								if (!t.isJSXIdentifier(opening.name)) return;
								const tagName = opening.name.name;
								if (!tComponentNames.has(tagName)) return;

								// Skip if already has message prop
								if (
									opening.attributes.some(
										(attr) =>
											t.isJSXAttribute(attr) &&
											t.isJSXIdentifier(attr.name) &&
											attr.name.name === "message",
									)
								)
									return;

								// Skip if in plural/select mode (has CLDR, _N, or _word props)
								if (
									opening.attributes.some((attr) => {
										if (!t.isJSXAttribute(attr) || !t.isJSXIdentifier(attr.name))
											return false;
										const n = attr.name.name;
										return ALL_CLDR.has(n) || /^_\d+$/.test(n) || /^_[a-zA-Z]/.test(n);
									})
								)
									return;

								// Bail early on conditional/logical direct children — untranslatable as a unit.
								const hasBailingExpr = path.node.children.some(
									(child) =>
										t.isJSXExpressionContainer(child) &&
										(t.isConditionalExpression(child.expression) ||
											t.isLogicalExpression(child.expression)),
								);
								if (hasBailingExpr) {
									const line = path.node.loc?.start.line ?? "?";
									console.warn(
										`[vocoder] Conditional/logical expression in <T> at line ${line} — extract outside: {cond ? <T>A</T> : <T>B</T>}`,
									);
									return;
								}

								// Collect top-level JSX element children for the components prop.
								const jsxElements: t.JSXElement[] = [];
								for (const child of path.node.children) {
									if (t.isJSXElement(child)) jsxElements.push(child);
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
								const template = extractTextContentFromNodes(
									path.node.children,
									ctx,
								).trim();
								if (ctx.bail) {
									const line = path.node.loc?.start.line ?? "?";
									console.warn(
										`[vocoder] Unsupported expression in <T> at line ${line} — could not extract template.`,
									);
									return;
								}
								if (!template) return;

								// Nothing dynamic to inject — skip static-only strings (runtime extractText handles them).
								if (
									ctx.namedVars.size === 0 &&
									jsxElements.length === 0 &&
									ctx.complexExprs.length === 0
								)
									return;

								const hash = generateMessageHash(template);
								const escaped = template.replace(/"/g, "&quot;");

								const newAttrs: t.JSXAttribute[] = [
									t.jsxAttribute(t.jsxIdentifier("id"), t.stringLiteral(hash)),
									t.jsxAttribute(
										t.jsxIdentifier("message"),
										t.stringLiteral(escaped),
									),
								];

								// values={{ name, 0: user.name }}
								if (ctx.namedVars.size > 0 || ctx.complexExprs.length > 0) {
									const props: t.ObjectProperty[] = [
										...[...ctx.namedVars].map((name) =>
											// shorthand property: { name } instead of { name: name }
											t.objectProperty(
												t.identifier(name),
												t.identifier(name),
												false,
												true,
											),
										),
										...ctx.complexExprs.map(({ key, node }) =>
											t.objectProperty(
												t.numericLiteral(key),
												t.cloneNode(node, true),
											),
										),
									];
									newAttrs.push(
										t.jsxAttribute(
											t.jsxIdentifier("values"),
											t.jsxExpressionContainer(t.objectExpression(props)),
										),
									);
								}

								// components={[<Foo />, ...]} — self-closing version of each child JSX element
								if (jsxElements.length > 0) {
									const elements = jsxElements.map((child) =>
										t.jsxElement(
											t.jsxOpeningElement(
												t.cloneNode(child.openingElement.name),
												child.openingElement.attributes.map((a) =>
													t.cloneNode(a, true),
												),
												true,
											),
											null,
											[],
											true,
										),
									);
									newAttrs.push(
										t.jsxAttribute(
											t.jsxIdentifier("components"),
											t.jsxExpressionContainer(t.arrayExpression(elements)),
										),
									);
								}

								opening.attributes.push(...newAttrs);
								changed = true;
							},
						},
					};
				},
			],
		});
	} catch {
		return { code, changed: false };
	}

	return { code: result?.code ?? code, changed };
}
