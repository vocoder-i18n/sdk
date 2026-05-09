import { describe, expect, it } from "vitest";
import { generateMessageHash } from "../hash";

describe("generateMessageHash", () => {
	it("returns a 7-character base-36 string", () => {
		const hash = generateMessageHash("Hello world");
		expect(hash).toHaveLength(7);
		expect(hash).toMatch(/^[0-9a-z]{7}$/);
	});

	it("is deterministic — same input always produces same output", () => {
		expect(generateMessageHash("Hello world")).toBe(generateMessageHash("Hello world"));
		expect(generateMessageHash("Save changes")).toBe(generateMessageHash("Save changes"));
	});

	it("produces different hashes for different texts", () => {
		expect(generateMessageHash("Hello")).not.toBe(generateMessageHash("World"));
		expect(generateMessageHash("Save")).not.toBe(generateMessageHash("Cancel"));
	});

	it("context separates same text with different meanings", () => {
		const noCtx = generateMessageHash("Edit");
		const buttonCtx = generateMessageHash("Edit", "button");
		const menuCtx = generateMessageHash("Edit", "menu");
		expect(noCtx).not.toBe(buttonCtx);
		expect(noCtx).not.toBe(menuCtx);
		expect(buttonCtx).not.toBe(menuCtx);
	});

	it("formality=formal produces different hash", () => {
		const neutral = generateMessageHash("Hello");
		const formal = generateMessageHash("Hello", undefined, "formal");
		const informal = generateMessageHash("Hello", undefined, "informal");
		expect(neutral).not.toBe(formal);
		expect(neutral).not.toBe(informal);
		expect(formal).not.toBe(informal);
	});

	it("formality=auto hashes identically to no formality", () => {
		expect(generateMessageHash("Hello", undefined, "auto")).toBe(
			generateMessageHash("Hello", undefined, undefined),
		);
	});

	it("formality=neutral hashes identically to no formality", () => {
		expect(generateMessageHash("Hello", undefined, "neutral")).toBe(
			generateMessageHash("Hello", undefined, undefined),
		);
	});

	it("combines context and formality correctly", () => {
		const a = generateMessageHash("Delete", "button", "formal");
		const b = generateMessageHash("Delete", "button", "informal");
		const c = generateMessageHash("Delete", "menu", "formal");
		expect(a).not.toBe(b);
		expect(a).not.toBe(c);
		expect(b).not.toBe(c);
	});

	it("handles empty string", () => {
		const hash = generateMessageHash("");
		expect(hash).toHaveLength(7);
	});

	it("handles unicode", () => {
		const hash = generateMessageHash("日本語テスト");
		expect(hash).toHaveLength(7);
		expect(hash).toMatch(/^[0-9a-z]{7}$/);
	});

	it("handles ICU strings", () => {
		const icu = "{count, plural, one {# item} other {# items}}";
		const hash = generateMessageHash(icu);
		expect(hash).toHaveLength(7);
		expect(hash).not.toBe(generateMessageHash("something else"));
	});

	it("produces known stable hash for a fixed input", () => {
		// This test pins the algorithm output — if it fails, the hash algorithm changed
		// and all existing translation bundles would be invalidated.
		const hash = generateMessageHash("Hello world");
		expect(hash).toMatchSnapshot();
	});
});
