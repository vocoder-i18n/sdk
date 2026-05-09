import { parse } from "@babel/parser";
import babelTraverse from "@babel/traverse";
import { generateMessageHash } from "@vocoder/core";
import {
	DEFAULT_ORDINAL_ICU,
	PLURAL_CLDR,
	buildPluralICU,
	buildSelectICU,
} from "../shared/icu-builders";
import { detectUiRole } from "../shared/roles";
import { type ExtractContext, extractTextContentFromNodes } from "../shared/transform";
import type { ExtractedString } from "../types";

const traverse = (babelTraverse as any).default || babelTraverse;

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
		if (expr.type === "TemplateLiteral") return extractTemplateText(expr);
		if (expr.type === "StringLiteral") return expr.value;
	}
	return undefined;
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

		if (name === "ordinal") { isOrdinal = true; continue; }
		if (name === "gender") { hasGender = true; continue; }

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

	if (isOrdinal) {
		const ordinalICU = DEFAULT_ORDINAL_ICU;
		if (hasGender) {
			// Wrap in gender select: runtime selects word form based on dynamic gender value.
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

/**
 * Extract translatable strings from source content using the Babel AST parser.
 *
 * Handles:
 *   - <T message="…"> JSX components (and ICU plural/select/ordinal props)
 *   - t(text, values, options) function calls (options at argument[2])
 *   - useVocoder() destructured t function
 */
export function extractFromContent(
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
				if (path.node.source.value !== "@vocoder/react") return;
				path.node.specifiers.forEach((spec: any) => {
					if (spec.type === "ImportSpecifier") {
						const imported =
							spec.imported.type === "Identifier" ? spec.imported.name : null;
						const local = spec.local.name;
						if (imported === "T") vocoderImports.set(local, "T");
						if (imported === "t") tFunctionNames.add(local);
					}
				});
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
							if (prop.key.name === "context" && prop.value.type === "StringLiteral") {
								context = prop.value.value;
							}
							if (prop.key.name === "formality" && prop.value.type === "StringLiteral") {
								formality = prop.value.value as "formal" | "informal" | "neutral" | "auto";
							}
							if (prop.key.name === "id" && prop.value.type === "StringLiteral") {
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

				const msgAttribute = getStringAttribute(opening.attributes, "message");

				let text: string | null = null;
				if (msgAttribute) {
					text = msgAttribute;
				} else {
					const pluralSelectICU = extractPluralSelectICU(opening.attributes);
					if (pluralSelectICU) {
						text = pluralSelectICU;
					} else {
						const extractCtx: ExtractContext = {
							elementCount: 0,
							complexCount: 0,
							namedVars: new Set<string>(),
							complexExprs: [],
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

				if (!trimmedText && !trimmedId) return;

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
