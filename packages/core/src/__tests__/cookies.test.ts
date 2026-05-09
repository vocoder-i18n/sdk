import { describe, expect, it } from "vitest";
import { getBestMatchingLocale, getCookie } from "../cookies";

describe("getCookie", () => {
	it("returns null for empty cookie string", () => {
		expect(getCookie("locale", "")).toBeNull();
	});

	it("finds a cookie by name", () => {
		expect(getCookie("locale", "locale=en")).toBe("en");
	});

	it("finds a cookie among multiple cookies", () => {
		expect(getCookie("locale", "theme=dark; locale=fr; session=abc")).toBe("fr");
	});

	it("decodes URI-encoded values", () => {
		expect(getCookie("locale", "locale=zh-CN")).toBe("zh-CN");
	});

	it("returns null when cookie not present", () => {
		expect(getCookie("locale", "theme=dark; session=abc")).toBeNull();
	});

	it("does not partially match cookie names", () => {
		expect(getCookie("locale", "mylocale=en; locale=fr")).toBe("fr");
	});

	it("handles cookies with encoded special chars", () => {
		const encoded = `name=${encodeURIComponent("John Doe")}`;
		expect(getCookie("name", encoded)).toBe("John Doe");
	});
});

describe("getBestMatchingLocale", () => {
	const supported = ["en", "fr", "de", "zh-TW", "pt-BR"];

	it("returns exact match when available", () => {
		expect(getBestMatchingLocale("fr", supported, "en")).toBe("fr");
	});

	it("returns language-only match when exact not found", () => {
		expect(getBestMatchingLocale("en-US", supported, "fr")).toBe("en");
	});

	it("returns fallback when no match found", () => {
		expect(getBestMatchingLocale("ja", supported, "en")).toBe("en");
	});

	it("finds regional variant when base lang not supported", () => {
		// pt is not in the list, but pt-BR is — should match pt-BR
		expect(getBestMatchingLocale("pt", supported, "en")).toBe("pt-BR");
	});

	it("prefers exact match over base language match", () => {
		const locales = ["zh", "zh-TW", "zh-CN"];
		expect(getBestMatchingLocale("zh-TW", locales, "en")).toBe("zh-TW");
	});

	it("returns fallback when supported list is empty", () => {
		expect(getBestMatchingLocale("fr", [], "en")).toBe("en");
	});
});
