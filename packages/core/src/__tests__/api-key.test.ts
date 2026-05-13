import { describe, expect, it } from "vitest";
import { extractProjectShortIdFromApiKey } from "../api-key";

describe("extractProjectShortIdFromApiKey", () => {
	it("extracts shortId from a valid project key", () => {
		expect(extractProjectShortIdFromApiKey("vcp_aB3xY9Zk_xxxxxxxxxxxxxxxxxxxxxx")).toBe(
			"aB3xY9Zk",
		);
	});

	it("returns null for app-scoped key", () => {
		expect(extractProjectShortIdFromApiKey("vca_xxxxxxxxxxxxxxxxxxxxxx")).toBeNull();
	});

	it("returns null for user-scoped key", () => {
		expect(extractProjectShortIdFromApiKey("vcu_xxxxxxxxxxxxxxxxxxxxxx")).toBeNull();
	});

	it("returns null for key with wrong shortId length (7 chars)", () => {
		expect(extractProjectShortIdFromApiKey("vcp_aB3xY9Z_xxxxxxxxxxxxxxxxxxxxxx")).toBeNull();
	});

	it("returns null for key with wrong shortId length (9 chars)", () => {
		expect(extractProjectShortIdFromApiKey("vcp_aB3xY9Zkk_xxxxxxxxxxxxxxxxxxxxxx")).toBeNull();
	});

	it("returns null for key missing separator before random", () => {
		expect(extractProjectShortIdFromApiKey("vcp_aB3xY9Zkxxxxxxxxxxxxxxxxxxxxxx")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(extractProjectShortIdFromApiKey("")).toBeNull();
	});

	it("returns null for non-key string", () => {
		expect(extractProjectShortIdFromApiKey("not-a-key")).toBeNull();
	});

	it("shortId contains only base62 chars", () => {
		const result = extractProjectShortIdFromApiKey("vcp_aB3xY9Zk_xxxxxxxxxxxxxxxxxxxxxx");
		expect(result).toMatch(/^[A-Za-z0-9]{8}$/);
	});
});
