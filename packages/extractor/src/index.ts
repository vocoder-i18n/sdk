import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative as pathRelative } from "node:path";
import { glob } from "glob";
import { extractFromContent as _extractFromContent } from "./parse/react";
import type { ExtractedString } from "./types";

export { generateMessageHash } from "@vocoder/core";
export { loadVocoderConfig, parseVocoderConfig } from "./config";
export type { VocoderConfig } from "./config";
export type { ExtractedString } from "./types";
export type { TransformResult } from "./shared/transform";
export { DEFAULT_ORDINAL_ICU, buildPluralICU, buildSelectICU } from "./shared/icu-builders";
export { transformMsgProps } from "./shared/transform";

/**
 * Content-addressed fingerprint for a translation bundle.
 *
 * Formula: sha256(scope + ":" + sorted(sourceKeys).join('\0')).slice(0, 12)
 *
 * @param scope - Composed identifier isolating this bundle.
 *   Single-app:  `${projectShortId}:`
 *   Monorepo app: `${projectShortId}:${appDir}`
 *   Caller composes scope — formula matches server (computeBundleFingerprint) and CLI.
 * @param sourceKeys - Source string keys (not texts). Sorted internally.
 *   Keys are used (not texts) so two strings with the same text but different
 *   formality or context produce different fingerprints.
 */
export function computeFingerprint(
	scope: string,
	sourceKeys: string[],
): string {
	const sorted = [...sourceKeys].sort();
	return createHash("sha256")
		.update(`${scope}:${sorted.join("\0")}`)
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

function deduplicateStrings(strings: ExtractedString[]): ExtractedString[] {
	// Content-hash keys are deterministic: same text+context → same key everywhere.
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
