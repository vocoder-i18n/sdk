/**
 * FNV-1a 32-bit hash for generating stable message IDs from source text.
 *
 * Works identically in Node.js and browsers (no platform APIs).
 * Used by the extractor (build time) and the React runtime (browser) — both
 * always produce the same key for the same source text.
 *
 * Output: 7 base-36 chars (~2.2 billion values).
 * Collision probability ≈ 0.002% for 10K strings (birthday problem).
 * Add `context` to disambiguate identical strings with different meanings.
 * Add `formality` ("formal" | "informal") to produce separate keys for
 * register variants — "neutral", "auto", and undefined hash identically.
 *
 * Separators: \x04 (ASCII EOT) for context, \x05 (ASCII ENQ) for formality.
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
