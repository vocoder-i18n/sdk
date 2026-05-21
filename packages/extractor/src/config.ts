import { existsSync, readFileSync } from "node:fs";

import type { AppConfig, VocoderConfig } from "@vocoder/config";
import babelTraverse from "@babel/traverse";
import { join } from "node:path";
import { parse } from "@babel/parser";

export type { AppConfig, VocoderConfig };

const traverse = (babelTraverse as any).default || babelTraverse;

/**
 * Load vocoder.config.{ts,js,mjs,json} from the given directory.
 * Uses Babel AST parsing so it works for both TypeScript and JavaScript
 * without requiring runtime execution or extra transpilation dependencies.
 *
 * Supports the common patterns:
 *   export default { include: [...], exclude: [...] }
 *   export default defineConfig({ include: [...], exclude: [...] })
 *
 * Returns null if no config file is found or parsing fails.
 */
export function loadVocoderConfig(cwd: string): VocoderConfig | null {
	const candidates = [
		join(cwd, "vocoder.config.ts"),
		join(cwd, "vocoder.config.js"),
		join(cwd, "vocoder.config.mjs"),
		join(cwd, "vocoder.config.cjs"),
	];

	for (const configPath of candidates) {
		if (!existsSync(configPath)) continue;

		try {
			const code = readFileSync(configPath, "utf-8");
			return parseConfigFromSource(code);
		} catch {
			// skip malformed files
		}
	}

	// JSON config as a simple alternative
	const jsonPath = join(cwd, "vocoder.config.json");
	if (existsSync(jsonPath)) {
		try {
			return JSON.parse(readFileSync(jsonPath, "utf-8")) as VocoderConfig;
		} catch {
			return null;
		}
	}

	return null;
}

/**
 * Parse a VocoderConfig from source code string.
 * Use this when you have the file content but not a local path —
 * e.g., fetched from GitHub API in the webhook pipeline.
 */
export function parseVocoderConfig(source: string): VocoderConfig | null {
	return parseConfigFromSource(source);
}

/**
 * Parse include/exclude arrays from config source code via Babel AST.
 * Handles both `export default { ... }` and `export default defineConfig({ ... })`.
 * Does not execute the file — purely static analysis.
 */
function parseConfigFromSource(code: string): VocoderConfig | null {
	let ast: any;
	try {
		ast = parse(code, {
			sourceType: "module",
			plugins: ["typescript", "jsx"],
		});
	} catch {
		return null;
	}

	let config: VocoderConfig | null = null;

	traverse(ast, {
		ExportDefaultDeclaration(path: any) {
			const decl = path.node.declaration;

			if (decl.type === "ObjectExpression") {
				config = extractFromObject(decl);
			} else if (decl.type === "CallExpression") {
				// defineConfig({ ... })
				const arg = decl.arguments[0];
				if (arg?.type === "ObjectExpression") {
					config = extractFromObject(arg);
				}
			}
		},
	});

	return config;
}

function extractFromObject(obj: any): VocoderConfig {
	const config: VocoderConfig = {};

	for (const prop of obj.properties) {
		if (prop.type !== "ObjectProperty") continue;
		const key: string = prop.key.name ?? prop.key.value;

		if (key === "include" || key === "exclude" || key === "targetBranches") {
			if (prop.value.type !== "ArrayExpression") continue;
			const values = prop.value.elements
				.filter((el: any) => el?.type === "StringLiteral")
				.map((el: any) => el.value as string);
			if (key === "include") config.include = values;
			if (key === "exclude") config.exclude = values;
			if (key === "targetBranches") config.targetBranches = values;
		}

		if (key === "localesDir" && prop.value.type === "StringLiteral") {
			config.localesDir = prop.value.value as string;
		}

		if (key === "industry" && prop.value.type === "StringLiteral") {
			config.industry = prop.value.value as VocoderConfig["industry"];
		}

		if (key === "appIndustry" && prop.value.type === "StringLiteral") {
			// Legacy field — mapped to industry for backward compat
			config.industry = prop.value.value as VocoderConfig["industry"];
		}

		if (key === "formality" && prop.value.type === "StringLiteral") {
			config.formality = prop.value.value as VocoderConfig["formality"];
		}

		if (key === "onTranslationFailure" && prop.value.type === "StringLiteral") {
			config.onTranslationFailure = prop.value.value as VocoderConfig["onTranslationFailure"];
		}

		if (key === "apps" && prop.value.type === "ArrayExpression") {
			const apps: AppConfig[] = [];
			for (const element of prop.value.elements) {
				if (element?.type !== "ObjectExpression") continue;
				const app = extractAppConfigFromObject(element);
				if (app) apps.push(app);
			}
			if (apps.length > 0) config.apps = apps;
		}
	}

	return config;
}

function extractAppConfigFromObject(obj: any): AppConfig | null {
	let appDir: string | undefined;
	const overrides: Omit<AppConfig, "appDir"> = {};

	for (const prop of obj.properties) {
		if (prop.type !== "ObjectProperty") continue;
		const key: string = prop.key.name ?? prop.key.value;

		if (key === "appDir" && prop.value.type === "StringLiteral") {
			appDir = prop.value.value as string;
		}

		if (key === "include" || key === "exclude" || key === "targetBranches") {
			if (prop.value.type !== "ArrayExpression") continue;
			const values = prop.value.elements
				.filter((el: any) => el?.type === "StringLiteral")
				.map((el: any) => el.value as string);
			if (key === "include") overrides.include = values;
			if (key === "exclude") overrides.exclude = values;
			if (key === "targetBranches") overrides.targetBranches = values;
		}

		if (key === "localesDir" && prop.value.type === "StringLiteral") {
			overrides.localesDir = prop.value.value as string;
		}

		if (key === "industry" && prop.value.type === "StringLiteral") {
			overrides.industry = prop.value.value as AppConfig["industry"];
		}

		if (key === "formality" && prop.value.type === "StringLiteral") {
			overrides.formality = prop.value.value as AppConfig["formality"];
		}
	}

	if (appDir === undefined) return null;
	return { appDir, ...overrides };
}
