import { describe, expect, it } from "vitest";
import { getLocaleDir } from "../server";

describe("getLocaleDir", () => {
	const locales = {
		en: { name: "English", dir: "ltr" },
		ar: { name: "Arabic", dir: "rtl" },
		he: { name: "Hebrew", dir: "rtl" },
		fr: { name: "French", dir: "ltr" },
	};

	it("returns 'ltr' for LTR locales", () => {
		expect(getLocaleDir("en", locales)).toBe("ltr");
		expect(getLocaleDir("fr", locales)).toBe("ltr");
	});

	it("returns 'rtl' for RTL locales", () => {
		expect(getLocaleDir("ar", locales)).toBe("rtl");
		expect(getLocaleDir("he", locales)).toBe("rtl");
	});

	it("returns 'ltr' when locale not in map", () => {
		expect(getLocaleDir("de", locales)).toBe("ltr");
	});

	it("returns 'ltr' when locales map is undefined", () => {
		expect(getLocaleDir("ar", undefined)).toBe("ltr");
	});

	it("returns 'ltr' when locales map is empty", () => {
		expect(getLocaleDir("ar", {})).toBe("ltr");
	});

	it("returns 'ltr' when locale entry has no dir property", () => {
		const noDir = { en: { name: "English" } };
		expect(getLocaleDir("en", noDir as any)).toBe("ltr");
	});
});
