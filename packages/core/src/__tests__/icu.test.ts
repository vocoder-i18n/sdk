import { describe, expect, it } from "vitest";
import { formatICU, rewriteSelectordinalInICU } from "../icu";
import type { OrdinalForms } from "../types";

describe("formatICU", () => {
	it("interpolates simple variables", () => {
		expect(formatICU("Hello {name}!", { name: "Alice" }, "en")).toBe("Hello Alice!");
	});

	it("returns original text when no values provided", () => {
		expect(formatICU("Hello world", {}, "en")).toBe("Hello world");
	});

	it("handles plural — one", () => {
		const icu = "{count, plural, one {# item} other {# items}}";
		expect(formatICU(icu, { count: 1 }, "en")).toBe("1 item");
	});

	it("handles plural — other", () => {
		const icu = "{count, plural, one {# item} other {# items}}";
		expect(formatICU(icu, { count: 5 }, "en")).toBe("5 items");
	});

	it("handles select", () => {
		const icu = "{gender, select, male {He} female {She} other {They}}";
		expect(formatICU(icu, { gender: "male" }, "en")).toBe("He");
		expect(formatICU(icu, { gender: "female" }, "en")).toBe("She");
		expect(formatICU(icu, { gender: "other" }, "en")).toBe("They");
	});

	it("handles plural with exact match (=0)", () => {
		const icu = "{count, plural, =0 {No items} one {# item} other {# items}}";
		expect(formatICU(icu, { count: 0 }, "en")).toBe("No items");
	});

	it("returns text unchanged on parse error", () => {
		const broken = "{bad icu string";
		const result = formatICU(broken, {}, "en");
		expect(result).toBe(broken);
	});

	it("defaults locale to 'en' when not provided", () => {
		const icu = "{count, plural, one {# item} other {# items}}";
		expect(formatICU(icu, { count: 1 })).toBe("1 item");
	});

	it("caches IntlMessageFormat instances (repeated calls don't throw)", () => {
		const icu = "Hello {name}!";
		expect(formatICU(icu, { name: "A" }, "en")).toBe("Hello A!");
		expect(formatICU(icu, { name: "B" }, "en")).toBe("Hello B!");
	});
});

describe("rewriteSelectordinalInICU", () => {
	const suffixForms: OrdinalForms = {
		type: "suffix",
		suffixes: { one: "#st", two: "#nd", few: "#rd", other: "#th" },
	};

	it("returns string unchanged when no selectordinal present (fast path)", () => {
		const icu = "Hello {name}!";
		expect(rewriteSelectordinalInICU(icu, suffixForms, { name: "Alice" })).toBe(icu);
	});

	it("rewrites standalone selectordinal using suffix forms", () => {
		const icu = "{count, selectordinal, one {#st} other {#th}}";
		const rewritten = rewriteSelectordinalInICU(icu, suffixForms, { count: 1 });
		// After rewrite, formatICU should produce correct suffix
		const result = formatICU(rewritten, { count: 1 }, "en");
		expect(result).toBe("1st");
	});

	it("rewrites embedded selectordinal in a larger string", () => {
		const icu = "Congrats on your {rank, selectordinal, one {#st} other {#th}} anniversary!";
		const rewritten = rewriteSelectordinalInICU(icu, suffixForms, { rank: 2 });
		const result = formatICU(rewritten, { rank: 2 }, "en");
		expect(result).toBe("Congrats on your 2nd anniversary!");
	});

	it("handles word-based ordinal forms (Arabic pattern)", () => {
		const wordForms: OrdinalForms = {
			type: "word",
			words: {
				masculine: { 1: "الأول", 2: "الثاني", 3: "الثالث" },
				feminine: { 1: "الأولى", 2: "الثانية", 3: "الثالثة" },
			},
		};
		const icu = "{rank, selectordinal, other {#}}";
		const rewritten = rewriteSelectordinalInICU(icu, wordForms, { rank: 1 });
		const result = formatICU(rewritten, {}, "ar");
		expect(result).toBe("الأول");
	});

	it("returns ICU unchanged when parsing fails", () => {
		const broken = "{bad selectordinal";
		const result = rewriteSelectordinalInICU(broken, suffixForms, {});
		expect(result).toBe(broken);
	});
});
