import { describe, expect, it } from "vitest";
import { DEFAULT_ORDINAL_ICU, buildPluralICU, buildSelectICU } from "../index";

describe("DEFAULT_ORDINAL_ICU", () => {
	it("is the expected constant string", () => {
		expect(DEFAULT_ORDINAL_ICU).toBe("{count, selectordinal, other {#}}");
	});
});

describe("buildPluralICU", () => {
	it("builds basic plural with one and other", () => {
		const result = buildPluralICU({ one: "# item", other: "# items" });
		expect(result).toBe("{count, plural, one {# item} other {# items}}");
	});

	it("builds plural with zero branch", () => {
		const result = buildPluralICU({ zero: "no items", one: "# item", other: "# items" });
		expect(result).toContain("zero {no items}");
		expect(result).toContain("one {# item}");
		expect(result).toContain("other {# items}");
	});

	it("puts exact matches (_0, _1) before CLDR categories", () => {
		const result = buildPluralICU({ _0: "no items", one: "# item", other: "# items" });
		const exactIdx = result.indexOf("=0");
		const cldrIdx = result.indexOf("one");
		expect(exactIdx).toBeLessThan(cldrIdx);
	});

	it("builds selectordinal when ordinal=true", () => {
		const result = buildPluralICU({ one: "#st", two: "#nd", few: "#rd", other: "#th" }, true);
		expect(result).toMatch(/^\{count, selectordinal,/);
	});

	it("ignores keys that are not CLDR categories or exact matches", () => {
		const result = buildPluralICU({ one: "# item", other: "# items", unknown: "nope" });
		expect(result).not.toContain("unknown");
	});

	it("uses internal variable name 'count'", () => {
		const result = buildPluralICU({ other: "items" });
		expect(result).toMatch(/^\{count,/);
	});
});

describe("buildSelectICU", () => {
	it("builds basic gender select", () => {
		const result = buildSelectICU({ _male: "He", _female: "She", other: "They" });
		expect(result).toContain("male {He}");
		expect(result).toContain("female {She}");
		expect(result).toContain("other {They}");
	});

	it("adds 'other {other}' fallback when other not provided", () => {
		const result = buildSelectICU({ _pending: "Pending", _shipped: "Shipped" });
		expect(result).toContain("other {other}");
	});

	it("uses internal variable name 'value'", () => {
		const result = buildSelectICU({ other: "fallback" });
		expect(result).toMatch(/^\{value, select,/);
	});

	it("strips leading underscore from keys", () => {
		const result = buildSelectICU({ _admin: "Admin", _user: "User", other: "Other" });
		expect(result).toContain("admin {Admin}");
		expect(result).toContain("user {User}");
		expect(result).not.toContain("_admin");
	});

	it("ignores keys without leading underscore that are not 'other'", () => {
		const result = buildSelectICU({ admin: "Admin", _user: "User", other: "Other" });
		expect(result).not.toContain("admin {Admin}");
		expect(result).toContain("user {User}");
	});
});
