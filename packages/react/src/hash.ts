/**
 * FNV-1a 32-bit hash — browser-compatible runtime version.
 * Identical algorithm to @vocoder/extractor/src/hash.ts.
 * Duplicated intentionally: extractor is a build-only dep, not bundled at runtime.
 */
export function generateMessageHash(
	text: string,
	context?: string,
	formality?: string,
): string {
	let input = context ? `${text}\x04${context}` : text;
	if (formality === "formal" || formality === "informal") {
		input += `\x05${formality}`;
	}
	let h = 2166136261 >>> 0;
	for (let i = 0; i < input.length; i++) {
		h = Math.imul(h ^ input.charCodeAt(i), 16777619) >>> 0;
	}
	return h.toString(36).padStart(7, "0");
}
