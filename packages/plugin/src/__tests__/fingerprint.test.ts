import { describe, expect, it } from "vitest";
import { computeFingerprint } from "../core";

describe("computeFingerprint", () => {
	it("returns a 12-character lowercase hex string", () => {
		const fp = computeFingerprint("myapp", ["abc", "def"]);
		expect(fp).toHaveLength(12);
		expect(fp).toMatch(/^[0-9a-f]{12}$/);
	});

	it("is deterministic", () => {
		const fp1 = computeFingerprint("myapp", ["key1", "key2"]);
		const fp2 = computeFingerprint("myapp", ["key1", "key2"]);
		expect(fp1).toBe(fp2);
	});

	it("is order-independent (sorts keys internally)", () => {
		const fp1 = computeFingerprint("myapp", ["key1", "key2", "key3"]);
		const fp2 = computeFingerprint("myapp", ["key3", "key1", "key2"]);
		expect(fp1).toBe(fp2);
	});

	it("differs for different appShortCode", () => {
		const fp1 = computeFingerprint("app-a", ["key1"]);
		const fp2 = computeFingerprint("app-b", ["key1"]);
		expect(fp1).not.toBe(fp2);
	});

	it("differs for different key sets", () => {
		const fp1 = computeFingerprint("myapp", ["key1"]);
		const fp2 = computeFingerprint("myapp", ["key1", "key2"]);
		expect(fp1).not.toBe(fp2);
	});

	it("handles empty key list", () => {
		const fp = computeFingerprint("myapp", []);
		expect(fp).toHaveLength(12);
	});

	it("produces known stable output for a fixed input", () => {
		const fp = computeFingerprint("myapp", ["abc123", "def456"]);
		expect(fp).toMatchSnapshot();
	});
});
