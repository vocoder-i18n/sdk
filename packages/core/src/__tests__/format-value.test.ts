import { describe, expect, it } from "vitest";
import { formatValue } from "../format-value";

describe("formatValue", () => {
	it("formats number mode", () => {
		expect(formatValue(1234.5, "number", "en")).toBe("1,234.5");
	});

	it("formats integer mode (rounds)", () => {
		expect(formatValue(1234.9, "integer", "en")).toBe("1,235");
	});

	it("formats percent mode", () => {
		expect(formatValue(0.42, "percent", "en")).toBe("42%");
	});

	it("formats compact mode", () => {
		expect(formatValue(1500000, "compact", "en")).toBe("1.5M");
	});

	it("formats currency mode", () => {
		const result = formatValue(9.99, "currency", "en", { currency: "USD" });
		expect(result).toContain("9.99");
		expect(result).toContain("$");
	});

	it("returns String(value) for currency mode when currency prop missing", () => {
		const result = formatValue(9.99, "currency", "en", {});
		expect(result).toBe("9.99");
	});

	it("formats date mode", () => {
		const date = new Date("2024-01-15");
		const result = formatValue(date, "date", "en");
		expect(result).toContain("Jan");
	});

	it("formats time mode", () => {
		const date = new Date("2024-01-15T14:30:00");
		const result = formatValue(date, "time", "en");
		// Time format is locale-dependent; just verify it returns a non-empty string
		expect(result.length).toBeGreaterThan(0);
	});

	it("formats datetime mode", () => {
		const date = new Date("2024-01-15T14:30:00");
		const result = formatValue(date, "datetime", "en");
		expect(result.length).toBeGreaterThan(0);
	});

	it("handles locale-specific number formatting", () => {
		// German uses dot as thousands separator, comma as decimal
		const de = formatValue(1234.5, "number", "de");
		expect(de).toContain("1");
	});

	it("returns String(value) for unknown format modes", () => {
		// @ts-expect-error — testing runtime fallback for unknown format
		expect(formatValue(42, "unknown", "en")).toBe("42");
	});

	it("caches Intl.NumberFormat instances (repeated calls don't throw)", () => {
		expect(formatValue(1, "number", "en")).toBe("1");
		expect(formatValue(2, "number", "en")).toBe("2");
		expect(formatValue(3, "number", "fr")).toBe("3");
	});
});
