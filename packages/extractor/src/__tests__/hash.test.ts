import { describe, expect, it } from "vitest";
import { generateMessageHash } from "../index";

describe("generateMessageHash (re-exported from @vocoder/core)", () => {
	it("returns a 7-character base-36 string", () => {
		expect(generateMessageHash("Hello world")).toHaveLength(7);
		expect(generateMessageHash("Hello world")).toMatch(/^[0-9a-z]{7}$/);
	});

	it("is deterministic", () => {
		expect(generateMessageHash("Save")).toBe(generateMessageHash("Save"));
	});

	it("matches output from @vocoder/core directly", async () => {
		const { generateMessageHash: coreHash } = await import("@vocoder/core");
		expect(generateMessageHash("Hello world")).toBe(coreHash("Hello world"));
		expect(generateMessageHash("Edit", "button")).toBe(coreHash("Edit", "button"));
		expect(generateMessageHash("Hello", undefined, "formal")).toBe(
			coreHash("Hello", undefined, "formal"),
		);
	});
});
