import { describe, expect, it } from "vitest";
import { isPreviewEnabled, isVocoderEnabled } from "../preview";

// PREVIEW_MODE is false in tests (no build plugin to inject __VOCODER_PREVIEW__).
// We test via cookie-based logic exclusively.

describe("isPreviewEnabled", () => {
	it("returns false for empty cookie string", () => {
		expect(isPreviewEnabled("")).toBe(false);
	});

	it("returns true when vocoder_preview=true cookie present", () => {
		expect(isPreviewEnabled("vocoder_preview=true")).toBe(true);
	});

	it("returns false when vocoder_preview=false", () => {
		expect(isPreviewEnabled("vocoder_preview=false")).toBe(false);
	});

	it("returns false when cookie is absent", () => {
		expect(isPreviewEnabled("theme=dark; session=abc")).toBe(false);
	});

	it("finds preview cookie among multiple cookies", () => {
		expect(isPreviewEnabled("theme=dark; vocoder_preview=true; session=abc")).toBe(true);
	});
});

describe("isVocoderEnabled", () => {
	// PREVIEW_MODE=false in test env, so isVocoderEnabled always returns true
	// regardless of preview cookie (since `!PREVIEW_MODE` short-circuits).
	it("returns true when PREVIEW_MODE is false (normal mode)", () => {
		expect(isVocoderEnabled("")).toBe(true);
		expect(isVocoderEnabled("vocoder_preview=false")).toBe(true);
	});

	it("returns true when preview cookie is true in normal mode", () => {
		expect(isVocoderEnabled("vocoder_preview=true")).toBe(true);
	});
});
